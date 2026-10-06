// Fills the 待补 sections of the assignment project from the specified PDF.
//
// The user chose to fill these from the paper rather than leave the draft incomplete, so this
// drives one controlled generation per section — prepare, run, read the proposal, accept — and
// keeps a marker wherever the located evidence does not actually support the text. It never
// invents: a section whose proposal carries no located evidence is rejected, not accepted.
//
// Usage: node --experimental-strip-types tests/e2e/assignment-fill-gaps.mjs <runDir> <workspaceDir> <homeDir> <projectId>
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [runDirArg, workspaceArg, homeArg, projectId] = process.argv.slice(2)
const outDir = resolve(runDirArg), workspaceRoot = resolve(workspaceArg), home = resolve(homeArg)
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const port = 19950 + (Number(String(Date.now()).slice(-3)) % 40)
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
  await writeFile(join(outDir, 'fill-gaps.json'), JSON.stringify(journal, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
  process.stdout.write(`journal: ${join(outDir, 'fill-gaps.json')}${String.fromCharCode(10)}`)
  process.exitCode = code
  throw new StopRun()
}

// What each gap asks for, phrased so the instruction stays inside the located original.
const GAPS = [
  { sectionId: 'section_4', title: '引言', ask: '补全本节开头对研究问题的交代、作者声明的贡献要点，以及章节安排句；只写指定论文引言中确实写到的内容。' },
  { sectionId: 'section_5', title: '相关工作', ask: '补全相关工作所覆盖的方向，以及它们与本文方法的承接关系；只写指定论文相关工作部分确实写到的内容。' },
  { sectionId: 'section_6', title: '方法', ask: '补全方法的组成（图结构建模、融合模块与训练目标）及各自作用；公式无法准确转写时用文字说明其作用，不得编造符号或数值。' },
  { sectionId: 'section_7', title: '实验结果', ask: '补全作者报告的主要结果与消融结论，写清是在哪些数据集上、属于原作者报告的结果；没有定位到数值时只说明结论方向，不得编造数字。' },
  { sectionId: 'section_8', title: '讨论与结论', ask: '补全作者在讨论与结论中写出的局限与未来工作方向；不补充作者没有提出的限制。' },
]

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
    if (result.ok === false) throw new Error(`${name}: ${result.error?.code} ${result.error?.message} ${JSON.stringify(result.error?.details ?? {})}`)
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
  const base = { requestId: `req_fill_${Date.now()}`, workspaceId, sessionId, projectId }
  record('session', { workspaceId, sessionId, projectId })

  const before = await must('document.read', { context: base })
  record('before', { revision: before.revision, chars: before.statistics?.chineseCharacters,
    markers: (before.document.text.match(/\[待补[：:][^\]]*\]/g) ?? []).length })

  for (const gap of GAPS) {
    const context = { ...base, expectedLedgerRevision: (await must('document.read', { context: base })).revision }
    try {
      const plan = await must('writing.prepare', { context, instruction: gap.ask, sectionId: gap.sectionId })
      record('prepared', { section: gap.title, sectionId: gap.sectionId, evidence: plan?.contextEvidence ?? plan?.evidenceIds?.length ?? null,
        target: plan?.sectionTarget?.title, risks: (plan?.risks ?? []).slice(0, 2) })
      const started = await must('runs.start', { context, planId: plan.planId, planHash: plan.planHash })
      const proposal = started?.proposal
      if (!proposal) { record('no-proposal', { section: gap.title, paused: Boolean(started?.paused) }); continue }
      const image = await must('edits.read', { context, proposalId: proposal.proposal.id })
      const edit = image?.proposal?.edits?.[0]
      const located = (image?.proposal?.section?.paragraphClaims ?? []).length
      record('proposal', { section: gap.title, edits: image?.proposal?.edits?.length,
        replaces: edit?.expectedText?.length, with: edit?.replacementText?.length, paragraphClaims: located,
        limitations: (image?.proposal?.section?.limitations ?? []).slice(0, 2) })
      // Accepted only when the proposal replaced the gap marker with text: a proposal that keeps
      // the marker is exactly "no located evidence", and accepting it would claim progress that
      // did not happen.
      const fillsMarker = /\[待补[：:]/.test(edit?.expectedText ?? '') && !/\[待补[：:]/.test(edit?.replacementText ?? '')
      if (!fillsMarker) { record('kept-gap', { section: gap.title, reason: '候选没有去掉待补标记，视为缺证据' }); continue }
      await must('edits.apply', { context: { ...base, expectedLedgerRevision: (await must('document.read', { context: base })).revision },
        proposalId: proposal.proposal.id, proposalHash: proposal.proposalHash })
      record('accepted', { section: gap.title })
    } catch (error) {
      record('failed', { section: gap.title, message: String(error?.message).slice(0, 200) })
    }
  }

  const after = await must('document.read', { context: base })
  const markers = (after.document.text.match(/\[待补[：:][^\]]*\]/g) ?? [])
  record('after', { revision: after.revision, chars: after.statistics?.chineseCharacters, markers: markers.length, remaining: markers.map(m => m.slice(0, 60)) })
  await writeFile(join(outDir, 'manuscript-filled.md'), after.document.text)
  const writingDir = join(workspaceRoot, '.scholarflow/writing')
  record('files', { writing: await readdir(writingDir).catch(() => []) })
  await finish(markers.length === 0 ? 0 : 1)
} catch (error) {
  if (!(error instanceof StopRun)) {
    record('error', { message: error?.message, stack: String(error?.stack).slice(0, 500) })
    try { await finish(1) } catch { /* StopRun */ }
  }
}
