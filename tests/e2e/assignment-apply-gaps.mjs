// Applies the proposals the previous run already generated for the five 待补 sections, then
// re-exports and re-measures. Nothing is regenerated: the requests were already paid for, and
// re-running them would be paying twice for the same text.
//
// Usage: node --experimental-strip-types tests/e2e/assignment-apply-gaps.mjs <runDir> <workspaceDir> <homeDir> <projectId>
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [runDirArg, workspaceArg, homeArg, projectId] = process.argv.slice(2)
const outDir = resolve(runDirArg), workspaceRoot = resolve(workspaceArg), home = resolve(homeArg)
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const port = 19980 + (Number(String(Date.now()).slice(-3)) % 15)
const journal = []
const record = (phase, data) => {
  journal.push({ at: new Date().toISOString(), phase, ...data })
  process.stdout.write(`[${phase}] ${JSON.stringify(data).slice(0, 420)}${String.fromCharCode(10)}`)
}
class StopRun extends Error {}
const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-assignment', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const finish = async code => {
  await writeFile(join(outDir, 'apply-gaps.json'), JSON.stringify(journal, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
  process.stdout.write(`journal: ${join(outDir, 'apply-gaps.json')}${String.fromCharCode(10)}`)
  process.exitCode = code
  throw new StopRun()
}

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
    await page.waitForTimeout(700)
  }
  const remote = (name, request) => page.evaluate(async ({ name, request }) => {
    const response = await fetch(`api/scholarflow.v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `scholarflow.v1/${name}`, payload: { args: { request } } }) })
    const text = await response.text()
    let value
    try { value = JSON.parse(text)?.result?.value } catch { return { ok: false, error: { code: 'NON_JSON', message: text.slice(0, 200) } } }
    return value?.ok === false ? { ok: false, error: value.error } : { ok: true, data: value?.data ?? value }
  }, { name, request })
  const must = async (name, request) => {
    const result = await remote(name, request)
    if (result.ok === false) throw new Error(`${name}: ${result.error?.code} ${result.error?.message}`)
    return result.data
  }
  const workspaceId = await page.evaluate(async path => {
    const response = await fetch('api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace/create', payload: { args: { request: { path } } } }) })
    return JSON.parse(await response.text())?.result?.value?.workspace?.workspaceId
  }, workspaceRoot)
  const sessionId = await page.evaluate(async workspaceId => {
    const response = await fetch('api/session/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/create', payload: { args: { request: { workspaceId, agentPreset: 'scholarflow' } } } }) })
    return JSON.parse(await response.text())?.result?.value?.sessionId
  }, workspaceId)
  const base = { requestId: `req_apply_${Date.now()}`, workspaceId, sessionId, projectId }
  const revision = () => must('document.read', { context: base }).then(read => read.revision)

  const list = await must('edits.list', { context: base })
  const pending = (list?.proposals ?? list?.states ?? []).filter(row => (row.state ?? row.proposalState) === 'pending')
  record('pending', { count: pending.length, ids: pending.map(row => row.proposalId ?? row.id) })

  for (const row of pending) {
    const proposalId = row.proposalId ?? row.id
    const image = await must('edits.read', { context: base, proposalId })
    const edit = image?.proposal?.edits?.[0]
    const section = image?.proposal?.section?.sectionId
    const holds = /\[待补[：:]/.test(edit?.expectedText ?? ''), fills = !/\[待补[：:]/.test(edit?.replacementText ?? '')
    record('read', { proposalId, section, edits: image?.proposal?.edits?.length, expected: edit?.expectedText?.length,
      replacement: edit?.replacementText?.length, holdsMarker: holds, fillsMarker: fills,
      paragraphClaims: (image?.proposal?.section?.paragraphClaims ?? []).length,
      limitations: (image?.proposal?.section?.limitations ?? []).slice(0, 1) })
    // Accepted only when it replaces a gap with real text; anything else keeps the marker, which
    // is the honest outcome when the located evidence does not support more.
    if (!holds || !fills) { record('kept-gap', { proposalId, section }); continue }
    try {
      await must('edits.apply', { context: { ...base, expectedLedgerRevision: await revision() }, proposalId, proposalHash: row.proposalHash ?? image.proposalHash })
      record('accepted', { proposalId, section })
    } catch (error) { record('apply-failed', { proposalId, section, message: String(error?.message).slice(0, 160) }) }
  }

  const after = await must('document.read', { context: base })
  const markers = (after.document.text.match(/\[待补[：:][^\]]*\]/g) ?? [])
  record('after', { revision: after.revision, chars: after.statistics?.chineseCharacters, markers: markers.length,
    remaining: markers.map(marker => marker.slice(0, 70)) })
  await writeFile(join(outDir, 'manuscript-filled.md'), after.document.text)
  await finish(0)
} catch (error) {
  if (!(error instanceof StopRun)) {
    record('error', { message: error?.message, stack: String(error?.stack).slice(0, 400) })
    try { await finish(1) } catch { /* StopRun */ }
  }
}
