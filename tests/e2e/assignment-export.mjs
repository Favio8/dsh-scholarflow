// Exports the Word file for a project that a previous assignment run already wrote, then
// measures its real pages. Kept separate from the generation run so a failure in export does
// not mean paying for generation again.
//
// Usage: node tests/e2e/assignment-export.mjs <runDir> <workspaceDir> <homeDir> <projectId>
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const [runDirArg, workspaceArg, homeArg, projectId] = process.argv.slice(2)
const outDir = resolve(runDirArg), workspaceRoot = resolve(workspaceArg), home = resolve(homeArg)
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const port = 19600 + (Number(String(Date.now()).slice(-3)) % 300)
const stamp = String(Date.now())
const journal = []
const record = (phase, data) => {
  const line = `[${phase}] ${JSON.stringify(data).slice(0, 500)}`
  journal.push({ at: new Date().toISOString(), phase, ...data })
  process.stdout.write(line + String.fromCharCode(10))
}
const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex')
class StopRun extends Error {}
const finish = async code => {
  await writeFile(join(outDir, 'export-journal.json'), JSON.stringify(journal, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
  process.exitCode = code
  throw new StopRun()
}

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-assignment', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let hostLog = ''
child.stdout.on('data', chunk => { hostLog += chunk.toString() })
child.stderr.on('data', chunk => { hostLog += chunk.toString() })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Host boot timed out')), 60000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timer); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  const page = await (await browser.newContext()).newPage()
  page.setDefaultTimeout(30000)
  await page.goto(url)
  await page.waitForTimeout(1500)
  for (const [matcher, label] of [[/^预览版说明/, '继续'], [/^添加一个 API Key/, '稍后配置']]) {
    const dialogs = page.getByRole('dialog')
    if (await dialogs.count() && matcher.test(await dialogs.first().innerText().catch(() => '')))
      await dialogs.first().getByRole('button', { name: label, exact: true }).click().catch(() => undefined)
    await page.waitForTimeout(600)
  }
  const remote = (name, request = {}) => page.evaluate(async ({ name, request }) => {
    const response = await fetch(`api/scholarflow.v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `scholarflow.v1/${name}`, payload: { args: { request } } }) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { return { ok: false, error: { code: 'NON_JSON', message: text.slice(0, 300) } } }
    const value = body?.result?.value ?? body
    return value?.ok === false ? { ok: false, error: value.error } : { ok: true, data: value?.data ?? value }
  }, { name, request })
  const must = async (name, request) => {
    const result = await remote(name, request)
    if (result.ok === false) throw new Error(`${name} refused: ${result.error?.code} ${result.error?.message} ${JSON.stringify(result.error?.details ?? {})}`)
    return result.data
  }
  const workspaceId = (await page.evaluate(async path => {
    const response = await fetch('api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace/create', payload: { args: { request: { path } } } }) })
    const body = JSON.parse(await response.text())
    return body?.result?.value?.workspace?.workspaceId
  }, workspaceRoot))
  const sessionId = (await page.evaluate(async workspaceId => {
    const response = await fetch('api/session/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/create', payload: { args: { request: { workspaceId, agentPreset: 'scholarflow' } } } }) })
    const body = JSON.parse(await response.text())
    return body?.result?.value?.sessionId
  }, workspaceId))
  record('session', { workspaceId, sessionId, projectId })

  const base = { requestId: `req_${stamp}`, workspaceId, sessionId }
  const document = await must('document.read', { context: { ...base, projectId } })
  const context = { ...base, projectId, expectedLedgerRevision: document.revision }
  record('document', { revision: document.revision, chars: document.statistics?.chineseCharacters, words: document.statistics?.westernWords,
    headings: (document.document?.text ?? '').split('\n').filter(line => /^##? /.test(line)).length })
  await writeFile(join(outDir, 'manuscript.md'), document.document?.text ?? '')

  const preflight = await must('export.preflight', { context, format: 'docx' })
  record('preflight', { plan: preflight.planId, reviewState: preflight.reviewState, notes: preflight.formatNotes })
  const delivery = await must('export.create', { context, planId: preflight.planId, planHash: preflight.planHash, deliveryType: 'working-draft' })
  record('delivery', { id: delivery?.manifest?.id, files: delivery?.manifest?.files?.map(f => f.relativePath) })
  const exported = await must('export.read', { context: { ...base, projectId }, deliveryId: delivery.manifest.id })
  const docx = exported.files.find(f => f.relativePath === 'paper.docx')
  if (!docx?.base64) { record('blocked', { reason: 'no paper.docx in the delivery' }); await finish(1) }
  const bytes = Buffer.from(docx.base64, 'base64')
  await writeFile(join(outDir, 'paper.docx'), bytes)
  record('docx', { path: join(outDir, 'paper.docx'), bytes: bytes.length, sha256: await hashFile(join(outDir, 'paper.docx')) })
  for (const file of exported.files) if (file.text && !file.relativePath.endsWith('.docx')) await writeFile(join(outDir, file.relativePath.replace(/\//g, '_')), file.text)
  await finish(0)
} catch (error) {
  if (!(error instanceof StopRun)) {
    record('error', { message: error?.message, stack: String(error?.stack).slice(0, 500) })
    await writeFile(join(outDir, 'export-host.log'), hostLog)
    try { await finish(1) } catch { /* StopRun */ }
  }
}
