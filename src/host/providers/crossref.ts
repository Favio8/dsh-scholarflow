import { z } from 'zod'
import { doi, searchInput, candidateSchema, type ResearchProvider, type SourceCandidate } from '../../shared/online-research.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { digest } from '../../core/store/files.ts'

// The Host owns DNS/proxy/redirect/response-size policy and cancellation. No
// standalone fetch, API key, paid pool, full-text download or arbitrary URL.
export type HostWeb = { fetch(request: { url: string }, signal: AbortSignal): Promise<{ url: string; statusCode: number;
  body: { kind: string; content: string }; truncated: boolean }> }
const work = z.object({ DOI: doi, title: z.array(z.string().max(4000)).max(20),
  author: z.array(z.object({ family: z.string().max(500).optional(), given: z.string().max(500).optional(), name: z.string().max(1000).optional() })).max(100).optional(),
  'container-title': z.array(z.string().max(2000)).max(20).optional(), type: z.string().max(200).optional(),
  issued: z.object({ 'date-parts': z.array(z.array(z.number().int()).max(3)).max(3) }).optional() })
const SELECT = 'DOI,title,author,container-title,type,issued'
const warnings = ['Crossref 提供出版元数据；未取得摘要或全文，也未验证正文对论点的支持。']

export function crossrefProvider(web: HostWeb): ResearchProvider {
  let inFlight = false
  const retrieve = async (url: URL, signal: AbortSignal) => {
    invariant(!inFlight, 'RESEARCH_PROVIDER_BUSY', '当前 Crossref 请求尚未结束，请稍后重试。')
    inFlight = true
    try {
      signal.throwIfAborted()
      const result = await web.fetch({ url: url.toString() }, signal)
      signal.throwIfAborted()
      const final = new URL(result.url)
      invariant(final.origin === 'https://api.crossref.org', 'RESEARCH_REDIRECT_BLOCKED', '提供方返回了未批准的地址。')
      if (result.statusCode === 404) return null
      if (result.statusCode === 429) throw new ScholarError('RESEARCH_RATE_LIMITED', 'Crossref 限流，本次停止；请稍后明确重试。')
      invariant(result.statusCode !== 401 && result.statusCode !== 403, 'RESEARCH_ACCESS_DENIED', 'Crossref 拒绝访问，本次停止，不自动重试。')
      invariant(result.statusCode >= 200 && result.statusCode < 300, 'RESEARCH_PROVIDER_FAILED', 'Crossref 暂时不可用，本次停止。')
      invariant(!result.truncated && result.body.kind === 'text' && Buffer.byteLength(result.body.content) <= 1024 * 1024,
        'RESEARCH_RESPONSE_INVALID', '元数据响应过大、不完整或不是 JSON 文本。')
      let raw: unknown
      try { raw = JSON.parse(result.body.content) } catch { throw new ScholarError('RESEARCH_RESPONSE_INVALID', '元数据响应不是有效 JSON。') }
      return raw
    } finally { inFlight = false }
  }
  const candidate = (raw: unknown): SourceCandidate => {
    const record = work.parse(raw), title = record.title.find(value => value.trim())
    invariant(title, 'RESEARCH_RESPONSE_INVALID', '提供方记录缺少标题，未将其纳入候选。')
    const year = record.issued?.['date-parts'][0]?.[0]
    const url = `https://doi.org/${encodeURI(record.DOI).replaceAll('#', '%23').replaceAll('?', '%3F')}`
    return candidateSchema.parse({ candidateId: `candidate_${digest(record.DOI).slice(7, 39)}`, provider: 'crossref', recordId: record.DOI,
      sourceUrl: `https://api.crossref.org/works/${encodeURIComponent(record.DOI)}`, retrievedAt: new Date().toISOString(),
      title, authors: (record.author ?? []).map(author => ({ literal: author.name || [author.given, author.family].filter(Boolean).join(' '),
        ...(author.family && { family: author.family }), ...(author.given && { given: author.given }) })).filter(author => author.literal),
      ...(year && year >= 1 && year <= 9999 && { year }), ...(record['container-title']?.[0] && { venue: record['container-title'][0] }),
      identifiers: { doi: record.DOI, url }, textAccess: 'metadata', kind: record.type === 'dataset' ? 'dataset' : /book|monograph/.test(record.type ?? '') ? 'book' : 'paper', warnings })
  }
  return { id: 'crossref', capabilities: { search: true, lookupIdentifier: true, fullText: false },
    async search(input, signal) {
      input = searchInput.parse(input)
      const url = new URL('https://api.crossref.org/works')
      url.searchParams.set('query.bibliographic', input.query); url.searchParams.set('rows', String(input.limit)); url.searchParams.set('select', SELECT)
      const filters = [input.yearFrom && `from-pub-date:${String(input.yearFrom).padStart(4, '0')}-01-01`, input.yearTo && `until-pub-date:${String(input.yearTo).padStart(4, '0')}-12-31`].filter(Boolean)
      if (filters.length) url.searchParams.set('filter', filters.join(','))
      const raw = await retrieve(url, signal)
      const decoded = z.object({ status: z.literal('ok'), message: z.object({ items: z.array(z.unknown()).max(100) }) }).safeParse(raw)
      invariant(decoded.success, 'RESEARCH_RESPONSE_INVALID', '提供方检索响应结构无效。')
      const envelope = decoded.data
      const records: SourceCandidate[] = [], resultWarnings = [...warnings]
      let rejected = 0
      for (const item of envelope.message.items.slice(0, input.limit)) {
        try { const row = candidate(item); if (!records.some(previous => previous.recordId === row.recordId)) records.push(row) }
        catch { rejected++ }
      }
      if (rejected) resultWarnings.push(`${rejected} 条提供方记录未通过元数据校验，未纳入候选。`)
      if (envelope.message.items.length > input.limit) resultWarnings.push('提供方超出请求数量的记录未纳入本次候选。')
      return { records, warnings: resultWarnings }
    },
    async lookup(identifier, signal) {
      const normalized = doi.parse(identifier), raw = await retrieve(new URL(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`), signal)
      if (raw === null) return null
      const decoded = z.object({ status: z.literal('ok'), message: z.unknown() }).safeParse(raw)
      invariant(decoded.success, 'RESEARCH_RESPONSE_INVALID', '提供方 DOI 响应结构无效。')
      let found: SourceCandidate
      try { found = candidate(decoded.data.message) }
      catch { throw new ScholarError('RESEARCH_RESPONSE_INVALID', '提供方 DOI 元数据无效。') }
      invariant(found.recordId === normalized, 'RESEARCH_IDENTIFIER_MISMATCH', '提供方返回的 DOI 与请求不符。')
      return found
    },
  }
}
