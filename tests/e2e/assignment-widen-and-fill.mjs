// Widens the evidence for the five 待补 sections, regenerates them, and accepts only what
// actually removes the marker. Fill order matters: the evidence pass comes first, because the
// section cannot be written from excerpts chosen for the paper as a whole.
//
// Usage: node --experimental-strip-types tests/e2e/assignment-widen-and-fill.mjs <runDir> <workspaceDir> <homeDir> <projectId>
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [runDirArg, workspaceArg, homeArg, projectId] = process.argv.slice(2)
const outDir = resolve(runDirArg), workspaceRoot = resolve(workspaceArg), home = resolve(homeArg)
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const port = 19910 + (Number(String(Date.now()).slice(-3)) % 70)
const journal = []
const record = (phase, data) => {
  journal.push({ at: new Date().toISOString(), phase, ...data })
  process.stdout.write(`[${phase}] ${JSON.stringify(data).slice(0, 400)}${String.fromCharCode(10)}`)
}
class StopRun extends Error {}
const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-assignment', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const finish = async code => {
  await writeFile(join(outDir, 'widen-fill.json'), JSON.stringify(journal, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
  process.stdout.write(`journal: ${join(outDir, 'widen-fill.json')}${String.fromCharCode(10)}`)
  process.exitCode = code
  throw new StopRun()
}

const GAPS = [
  { sectionId: 'section_4', title: '引言', ask: '补全本节开头对研究问题的交代、作者声明的贡献要点与章节安排句；只写指定论文引言中确实写到的内容。' },
  { sectionId: 'section_5', title: '相关工作', ask: '补全相关工作覆盖的方向及其与本文方法的承接；只写指定论文相关工作部分确实写到的内容。' },
  { sectionId: 'section_6', title: '方法', ask: '补全方法的组成与各自作用；公式无法准确转写时用文字说明其作用，不得编造符号或数值。' },
  { sectionId: 'section_7', title: '实验结果', ask: '补全作者报告的主要结果与消融结论；没有定位到数值时只说明结论方向，不得编造数字。' },
  { sectionId: 'section_8', title: '讨论与结论', ask: '补全作者写出的局限与未来工作方向；不补充作者没有提出的限制。' },
]
const MARKER = /\[待补[：:]/
const skipWiden = process.argv.includes('--skip-widen')

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
  const base = { requestId: `req_widen_${Date.now()}`, workspaceId, sessionId, projectId }
  const revision = () => must('document.read', { context: base }).then(read => read.revision)

  const before = await must('document.read', { context: base })
  record('before', { chars: before.statistics?.chineseCharacters, markers: (before.document.text.match(/\[待补[：:][^\]]*\]/g) ?? []).length })

  for (const gap of GAPS) {
    try {
      const widened = skipWiden ? { added: 0, notes: ['skipped: already widened'] }
        : await must('writing.locateSectionEvidence', { context: base, sectionId: gap.sectionId, limit: 8 })
      record('widened', { section: gap.title, added: widened?.added, notes: (widened?.notes ?? []).slice(0, 1) })
      const prepared = await must('writing.prepare', { context: { ...base, expectedLedgerRevision: await revision() }, instruction: gap.ask, sectionId: gap.sectionId })
      const started = await must('runs.start', { context: { ...base, expectedLedgerRevision: await revision() }, planId: prepared.planId, planHash: prepared.planHash })
      const row = started?.proposal
      if (!row) { record('no-proposal', { section: gap.title, paused: Boolean(started?.paused) }); continue }
      const image = await must('edits.read', { context: base, proposalId: row.id })
      const edit = image?.proposal?.edits?.[0]
      const holds = MARKER.test(edit?.expectedText ?? ''), fills = !MARKER.test(edit?.replacementText ?? '')
      record('regenerated', { section: gap.title, expected: edit?.expectedText?.length, replacement: edit?.replacementText?.length,
        holdsMarker: holds, fillsMarker: fills, paragraphClaims: (image?.proposal?.section?.paragraphClaims ?? []).length,
        limitations: (image?.proposal?.section?.limitations ?? []).slice(0, 1) })
      if (!holds || !fills) {
        await must('edits.reject', { context: base, proposalId: row.id }).catch(() => undefined)
        record('kept-gap', { section: gap.title })
        continue
      }
      await must('edits.apply', { context: { ...base, expectedLedgerRevision: await revision() }, proposalId: row.id, proposalHash: started?.proposalHash ?? row.proposalHash })
      record('accepted', { section: gap.title })
    } catch (error) {
      record('failed', { section: gap.title, message: String(error?.message).slice(0, 200) })
    }
  }

  const after = await must('document.read', { context: base })
  const markers = (after.document.text.match(/\[待补[：:][^\]]*\]/g) ?? [])
  record('after', { chars: after.statistics?.chineseCharacters, markers: markers.length, remaining: markers.map(marker => marker.slice(0, 70)) })
  await writeFile(join(outDir, 'manuscript-widened.md'), after.document.text)
  await finish(markers.length === 0 ? 0 : 1)
} catch (error) {
  if (!(error instanceof StopRun)) {
    record('error', { message: error?.message, stack: String(error?.stack).slice(0, 400) })
    try { await finish(1) } catch { /* StopRun */ }
  }
}
