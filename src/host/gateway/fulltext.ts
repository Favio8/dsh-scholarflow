// DSH source-mode RPC reflects the emitted `request` parameter name. Keep this
// transport import distinct so bundling does not rename the Remote parameters.
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { invariant, ScholarError } from '../../shared/errors.ts'

function publicAddress(address: string) {
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address)
  const [a, b] = address.split('.').map(Number)
  return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127)
}
// Anonymous, read-only OA download transport. DNS is pinned for each hop; no
// credentials, browser cookies, private hosts or publisher authentication.
export async function fetchPublicFulltext(input: string, signal: AbortSignal, hops = 0): Promise<{ bytes: Uint8Array; url: string; mediaType: string }> {
  const url = new URL(input)
  invariant(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && hops <= 5,
    'FULLTEXT_URL_UNSUPPORTED', '全文地址需要公开 HTTPS 链接。')
  const hosts = await lookup(url.hostname, { all: true })
  invariant(hosts.length && hosts.every(host => publicAddress(host.address)), 'FULLTEXT_PRIVATE_HOST', '全文地址不是公开网络地址。')
  const host = hosts[0], bounded = AbortSignal.any([signal, AbortSignal.timeout(30000)])
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { signal: bounded, headers: { 'User-Agent': 'ScholarFlow/1.0 (open-access research)', Accept: 'application/pdf,text/html,application/xhtml+xml' },
      lookup: ((_name: string, options: any, done: any) => options.all ? done(null, [host]) : done(null, host.address, host.family)) as any }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume(); fetchPublicFulltext(new URL(response.headers.location, url).href, bounded, hops + 1).then(resolve, reject); return
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume(); reject(new ScholarError('FULLTEXT_UNAVAILABLE', '该公开版本暂时无法下载。')); return
      }
      const mediaType = String(response.headers['content-type'] ?? '').split(';')[0].trim()
      const chunks: Uint8Array[] = []; let size = 0
      response.on('data', (chunk: Buffer) => { size += chunk.length
        if (size > 20 * 1024 * 1024) response.destroy(new ScholarError('CONTENT_TOO_LARGE', '全文超过单次缓存限额。'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => { const bytes = Buffer.concat(chunks); resolve({ bytes, url: url.href, mediaType: bytes.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : mediaType }) })
    })
    req.on('error', reject); req.end()
  })
}
