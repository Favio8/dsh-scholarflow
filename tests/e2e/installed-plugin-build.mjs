// Verify installed Harness serves the local production bundle; no models or user profile.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { chromium } from '@playwright/test'

const out = resolve('.dsh-tmp/installed-plugin-build', String(Date.now()))
const profile = join(out, 'profiles/p'), repo = resolve('.')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, dependencies: { 'dsh-scholarflow': 'link:' + repo.replaceAll('\\', '/') }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(repo, join(profile, 'node_modules/dsh-scholarflow'), 'junction')
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const host = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals', join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'), 'p', '--no-open', '--port', '0'],
  { env: { ...process.env, DSH_HOME: out, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const ready = new Promise((done, reject) => {
  const timer = setTimeout(() => reject(Error('TEST_ONLY installed boot timeout')), 30000)
  let text = ''
  host.stdout.on('data', chunk => {
    text += chunk.toString()
    const match = text.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timer); done(match[1]) }
  })
  host.stderr.resume()
  host.once('exit', code => { clearTimeout(timer); reject(Error('TEST_ONLY installed boot exit ' + code)) })
})
let browser
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage()
  await page.goto(await ready)
  const entry = await page.evaluate(() => window.__DSH_BOOT__.entries.find(row => row.id === 'dsh-scholarflow'))
  assert(entry, 'production ScholarFlow must be in the installed boot graph')
  const response = await page.request.get(new URL(entry.url, page.url()).href)
  assert.equal(response.status(), 200)
  const served = await response.body(), local = await readFile('dist/client.js')
  // Installed DSH strips/stamps debugger trailers and uses a metadata build revision.
  // Compare the actual factory registered by the browser loader, without executing it.
  const registered = bytes => {
    const rows = []
    runInNewContext(bytes.toString('utf8'), { window: { __ModuleLoader__: { load: row => rows.push({ id: row.id, factory: row.factory.toString() }) } } }, { timeout: 1000 })
    return rows
  }
  const expected = registered(local), actual = registered(served)
  assert.equal(expected.length, 1); assert.equal(expected[0].id, 'dsh-scholarflow')
  assert.deepEqual(actual, expected, 'installed executable module factory must match production build exactly')
  const report = { matchesProductionFactory: true, bytes: local.length, servedBytes: served.length, rev: entry.rev, sha256: createHash('sha256').update(local).digest('hex'), paidModelCalls: 0, out }
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close(); host.kill()
}
