// Real assignment end-to-end (AT-62 / AT-46 / AT-48 / AT-50 / AT-61).
//
// Runs the actual assignment material through the actual installed host and the actual model,
// in an isolated copy and an isolated DSH_HOME, so the source directory is never written to.
// Every step is recorded to a JSON journal plus a readable log, because a run this long has to
// be inspectable after the fact rather than trusted from a single exit code.
//
// Usage: node tests/e2e/assignment-e2e.mjs [--timeout-minutes 90] [--keep-home]
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, appendFile, readFile, copyFile, cp, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { creationSpec } from '../../src/shared/writing-task.ts'

const SOURCE = 'C:/Users/19949/Desktop/科技论文写作'
const PAPER = 'Graph_Convolution-Based_Decoupling_and_Consistency-Driven_Fusion_for_Multimodal_Emotion_Recognition.pdf'
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const stamp = String(Date.now())
const home = resolve('.dsh-tmp/assignment-home', stamp)
// A custom profile name: `desktop` is reserved for the Electron application itself.
const profile = join(home, 'profiles/scholarflow-assignment')
const workspaceRoot = join(resolve('.dsh-tmp/assignment-workspace'), stamp)
const outDir = resolve('.dsh-tmp/assignment-run', stamp)
const timeoutMinutes = Number(process.argv[process.argv.indexOf('--timeout-minutes') + 1]) || 90
// A port of its own per run: a leftover host from an earlier attempt must not make the next
// one fail to start, and the message would otherwise look like a hang.
const port = 19500 + (Number(stamp.slice(-3)) % 400)

const journal = []
let progressPath
const record = (phase, data) => {
  const line = `[${new Date().toISOString()}] [${phase}] ${JSON.stringify(data).slice(0, 600)}`
  journal.push({ at: new Date().toISOString(), phase, ...data })
  process.stdout.write(line + String.fromCharCode(10))
  // Also appended directly, so the run can be watched while it is still in flight.
  if (progressPath) appendFile(progressPath, line + String.fromCharCode(10)).catch(() => undefined)
}
const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex')

// ── 1. isolated copy; the source directory is only read ────────────────────────────────────
await mkdir(outDir, { recursive: true })
await cp(SOURCE, workspaceRoot, { recursive: true, filter: source => {
  const name = basename(source)
  return !['.scholarflow', 'manuscript', '.workbuddy'].includes(name) && !/科技论文写作_本次插件生成\.docx$/.test(name)
} })
await mkdir(join(profile, 'node_modules'), { recursive: true })
// The user's own credentials and model choices are reused (the task authorises real model
// testing); nothing is written back to the real DSH_HOME.
await copyFile(join(process.env.USERPROFILE ?? '', '.dsh/.credentials.yaml'), join(home, '.credentials.yaml'))

await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-assignment', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { const { symlink } = await import('node:fs/promises'); await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const before = {}
for (const relative of ['作业要求/1.jpg', '作业要求/2.jpg', '作业要求/3.jpg', PAPER, '报告笔记.md', '个人报告笔记.md',
  '.workbuddy/科技论文写作报告.docx', '科技论文写作_本次插件生成.docx']) {
  const path = join(SOURCE, relative)
  if (existsSync(path)) before[relative] = { sha256: await hashFile(path), mtimeMs: (await stat(path)).mtimeMs }
}
await writeFile(join(outDir, 'originals-before.json'), JSON.stringify(before, null, 2))
progressPath = join(outDir, 'progress.log')
record('setup', { home, profile, workspaceRoot, outDir, originals: Object.keys(before).length })

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-assignment', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write',
    SCHOLARFLOW_TRACE: join(outDir, 'stage-trace.log') },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let hostLog = ''
child.stdout.on('data', chunk => { hostLog += chunk.toString() })
child.stderr.on('data', chunk => { hostLog += chunk.toString() })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let page, contextBody
const finish = async (code) => {
  journal.push({ at: new Date().toISOString(), phase: 'done', code })
  await writeFile(join(outDir, 'journal.json'), JSON.stringify(journal, null, 2))
  await writeFile(join(outDir, 'host.log'), hostLog)
  child.kill()
  try { await browser.close() } catch { /* already closed */ }
  console.log(String.fromCharCode(10) + `journal: ${join(outDir, 'journal.json')}`)
  process.exitCode = code
  // Thrown so the run unwinds here instead of driving a browser that is already closed.
  throw new StopRun()
}
/** Sentinel used to unwind once `finish` has recorded its journal and cleaned up. */
class StopRun extends Error { constructor() { super('run finished') } }

try {
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Host boot timed out')), 60000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timer); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  page = await (await browser.newContext()).newPage()
  page.setDefaultTimeout(30000)
  await page.goto(url)
  await page.waitForTimeout(1500)
  for (const [matcher, label] of [[/^预览版说明/, '继续'], [/^添加一个 API Key/, '稍后配置']]) {
    const dialogs = page.getByRole('dialog')
    if (await dialogs.count() && matcher.test(await dialogs.first().innerText().catch(() => '')))
      await dialogs.first().getByRole('button', { name: label, exact: true }).click().catch(() => undefined)
    await page.waitForTimeout(700)
  }
  // Plugin remotes answer with an application envelope: {ok, data} or {ok:false, error}.
  // Unwrapping it here keeps every call site readable and makes a refusal visible instead of
  // silently undefined.
  const remote = (name, request = {}) => page.evaluate(async ({ name, request }) => {
    const response = await fetch(`api/scholarflow.v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `scholarflow.v1/${name}`, payload: { args: { request } } }) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { return { ok: false, error: { code: 'NON_JSON', message: text.slice(0, 300) } } }
    const value = body?.result?.value ?? body
    return value?.ok === false ? { ok: false, error: value.error } : { ok: true, data: value?.data ?? value }
  }, { name, request })
  const call = async (method, args = {}) => {
    const value = await page.evaluate(async ({ method, args }) => {
      const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
      const text = await response.text()
      try { return JSON.parse(text)?.result?.value ?? JSON.parse(text) } catch { return { raw: text.slice(0, 300) } }
    }, { method, args })
    return value
  }
  /** Runs a remote and fails loudly with the plugin's own message. */
  const withTimeout = async (promise, label, ms = 10 * 60 * 1000) => {
    let timer
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' did not answer within ' + Math.round(ms / 1000) + 's')), ms) })]) }
    finally { clearTimeout(timer) }
  }
  const must = async (name, request, ms) => {
    record('call', { name })
    const result = await withTimeout(remote(name, request), name, ms)
    if (result.ok === false) throw new Error(`${name} refused: ${result.error?.code} ${result.error?.message} ${JSON.stringify(result.error?.details ?? {})}`)
    return result.data
  }

  const workspaceId = (await call('workspace/create', { request: { path: workspaceRoot } }))?.workspace?.workspaceId
  if (!workspaceId) throw new Error('workspace not created')
  const sessionId = (await call('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } }))?.sessionId
  if (!sessionId) throw new Error('session not created')
  contextBody = { requestId: `req_${stamp}`, workspaceId, sessionId }
  record('session', { workspaceId, sessionId })

  // ── 2. the capability the whole image path depends on ────────────────────────────────────
  const capabilityProbe = await withTimeout(remote('creation.imageCapability', { context: contextBody }), 'creation.imageCapability', 60000)
  record('image-capability', capabilityProbe)
  if (capabilityProbe.ok === false) { await finish(1) }
  const capability = capabilityProbe.data

  // ── 3. step 1: read every member of the requirement folder (real images) ─────────────────
  const spec = { title: '科技论文阅读分析报告：结构与承接关系', type: 'course-paper', language: 'zh-CN', format: 'docx',
    requirements: '对指定科技论文写一份阅读分析报告，重点分析结构与承接关系。',
    requirementSources: [{ resourceId: 'req_assignment', origin: 'workspace', kind: 'folder', path: '作业要求',
      members: [{ name: '作业要求/1.jpg' }, { name: '作业要求/2.jpg' }, { name: '作业要求/3.jpg' }], role: 'assignment', state: 'selected' }],
    materials: [], online: false, targetLength: 1500,
    countingPolicy: { scope: 'body', includeAbstract: false, algorithmVersion: 1 },
    sections: [{ id: 'section_1', title: '引言', purpose: '', targetLength: 1500, allocationMode: 'auto' }],
    manuscriptDir: 'manuscript', overrides: [] }
  // Validated with the same schema the host uses, so a malformed request is reported here
  // with the field that failed rather than as a generic refusal.
  const specCheck = creationSpec.safeParse(spec)
  if (!specCheck.success) { record('spec-invalid', specCheck.error.issues.slice(0, 5)); await finish(1) }

  const { readId } = await must('creation.readRequirements', { context: contextBody, spec }, 120000)
  if (!readId) throw new Error('read not started')
  record('read-started', { readId })
  let read, waited = 0
  while (waited < timeoutMinutes * 60000) {
    read = await must('creation.readStatus', { readId }, 60000)
    if (read.state && read.state !== 'reading') break
    console.log(`  reading… ${read.phase ?? ''} ${read.done ?? 0}/${read.total ?? '?'} ${Math.round((read.elapsedMs ?? 0) / 1000)}s`)
    await page.waitForTimeout(2000); waited += 2000
  }
  record('read-result', { state: read?.state, phase: read?.phase, done: read?.done, total: read?.total,
    members: (read?.members ?? []).map(member => ({ name: member.name, state: member.state, chars: member.chars, note: member.note })) })
  // Recover only failed members, using the same action as the UI. Partial assignment
  // reads cannot count as a complete acceptance of this three-image assignment.
  for (const member of (read?.members ?? []).filter(member => member.state === 'failed')) {
    const retried = await must('creation.retryMember', { context: contextBody, spec, readId, member: member.name })
    read = retried.read
    record('member-retry', { name: member.name, state: read.members.find(row => row.name === member.name)?.state })
  }
  if (!read || read.members.length !== 3 || read.members.some(member => member.state !== 'ready')) {
    record('blocked', { reason: 'all three assignment images must be read for this acceptance' }); await finish(1)
  }
  if (!read?.members?.some(member => member.state === 'ready')) { record('blocked', { reason: 'no member was read' }); await finish(1) }

  // ── 4. structure what was read into a requirement candidate ──────────────────────────────
  const structured = await must('creation.structure', { context: contextBody, spec, readId, presetLength: 4000 })
  const brief = structured?.candidate
  record('brief', { candidateId: brief?.candidateId, length: brief?.brief?.length, coverage: brief?.brief?.coverage?.map(row => row.text),
    typography: brief?.brief?.typography, conflicts: brief?.conflicts?.map(row => `${row.topic}: ${row.current} → ${row.candidate}`),
    decisions: brief?.brief?.decisions?.map(row => row.question) })
  if (!brief) { record('blocked', { reason: 'no requirement candidate' }); await finish(1) }

  // ── 5. adopt: the teacher's page and length requirement, then the PDF as a material ──────
  const adopted = (await must('candidates.adopt', { context: contextBody, candidateId: brief.candidateId, spec, all: true })).spec
  const withMaterials = { ...adopted, materials: [PAPER], targetLength: adopted.brief?.length?.value ?? adopted.targetLength,
    cover: { ...adopted.cover, enabled: true, title: '科技论文阅读分析报告', fields: [{ label: '姓名', value: '张三' }, { label: '学号', value: '23009200123' }] } }
  record('adopted', { targetLength: withMaterials.targetLength, typography: withMaterials.typography, cover: withMaterials.cover,
    overrides: withMaterials.overrides, coverage: withMaterials.brief?.coverage?.length })
  const adoptedCheck = creationSpec.safeParse(withMaterials)
  if (!adoptedCheck.success) { record('adopted-spec-invalid', adoptedCheck.error.issues.slice(0, 6)); await finish(1) }

  // ── 6. outline candidate with the coverage matrix ────────────────────────────────────────
  const outlined = await must('outline.suggest', { context: contextBody, spec: withMaterials })
  const outline = outlined?.candidate
  record('outline', { gaps: outline?.gaps, coverage: outline?.coverage?.map(row => ({ text: row.text, covered: row.covered, at: row.sectionIds })),
    sections: outline?.sections?.map(section => `${section.title}(${section.targetLength})`) })
  if (!outline) { record('blocked', { reason: 'no outline candidate' }); await finish(1) }
  const finalSpec = (await must('candidates.adopt', { context: contextBody, candidateId: outline.candidateId, spec: withMaterials, all: true })).spec
  await writeFile(join(outDir, 'final-spec.json'), JSON.stringify(finalSpec, null, 2))
  record('final-spec', { sections: finalSpec.sections.length, targetLength: finalSpec.targetLength,
    sum: finalSpec.sections.reduce((total, section) => total + section.targetLength, 0) })

  // ── 7. create the project and let the task run ───────────────────────────────────────────
  const plan = await must('creation.prepare', { context: contextBody, spec: finalSpec })
  if (!plan?.planId) throw new Error(`prepare failed: ${JSON.stringify(plan).slice(0, 200)}`)
  const started = await must('creation.start', { context: contextBody, planId: plan.planId, planHash: plan.planHash })
  const projectContext = { ...contextBody, projectId: started.projectId }
  record('created', started)

  let task, elapsed = 0
  while (elapsed < timeoutMinutes * 60000) {
    // A running task commits as it writes, so a poll can race its own writes and come back
    // stale. Retrying is what the client does too: the project simply moved on mid-read.
    try { task = (await must('writingTask.inspect', { context: projectContext })).task }
    catch (error) {
      if (/STALE_LEDGER_REVISION/.test(String(error && error.message))) { await page.waitForTimeout(2000); elapsed += 2000; continue }
      throw error
    }
    if (!task) break
    console.log(`  ${task.status}/${task.stage} · sections ${task.sectionIndex}/${finalSpec.sections.length} · calls ${task.usedModelCalls} · ${Math.round(task.elapsedMs / 1000)}s`)
    // The driver stands in for the user here. A question still has to be *asked* — that is the
    // behaviour under test — but this run has to reach the end, so it answers the way a user
    // continuing the work would: keep the draft and carry on, never invent a missing fact.
    const pending = (task.questions ?? []).find(row => row.answered === undefined)
    if (pending) {
      const answer = ['保留待补并继续', '已保存，继续', '已处理，继续', '继续', '先创建结构草稿']
        .find(option => (pending.options ?? []).includes(option)) ?? (pending.options ?? [])[0]
      record('answer', { question: String(pending.title).slice(0, 120), options: pending.options, answer })
      await must('writingTask.action', { context: projectContext, taskId: task.id, action: 'answer', questionId: pending.id, answer: String(answer) })
      await page.waitForTimeout(2000); elapsed += 2000; continue
    }
    if (['completed', 'cancelled', 'failed'].includes(task.status)) break
    await page.waitForTimeout(5000); elapsed += 5000
  }
  record('task', { status: task?.status, stage: task?.stage, usedModelCalls: task?.usedModelCalls, sectionIndex: task?.sectionIndex,
    notes: (task?.notes ?? []).slice(-12), issues: (task?.issues ?? []).map(row => `${row.group}: ${row.what}`) })

  const document = await must('document.read', { context: projectContext })
  await writeFile(join(outDir, 'manuscript.md'), document?.document?.text ?? '')
  const stats = document?.statistics
  record('manuscript', { chars: stats?.chineseCharacters, words: stats?.westernWords, detail: stats?.detail,
    headings: (document?.document?.text ?? '').split('\n').filter(line => /^#{1,2} /.test(line)).length })

  // ── 8. export the Word file and measure the real pages ───────────────────────────────────
  // A mutating call has to name the ledger revision it is based on; the driver reads it from
  // the document the same way the client does.
  projectContext.expectedLedgerRevision = document.revision
  const preflight = await must('export.preflight', { context: projectContext, format: 'docx' })
  if (!preflight?.planId) throw new Error(`preflight failed: ${JSON.stringify(preflight).slice(0, 200)}`)
  record('preflight', { format: preflight.format, reviewState: preflight.reviewState, notes: preflight.formatNotes })
  const delivery = await must('export.create', { context: projectContext, planId: preflight.planId, planHash: preflight.planHash, deliveryType: 'working-draft' })
  record('delivery', { deliveryId: delivery?.manifest?.id, files: delivery?.manifest?.files?.map(file => file.relativePath) })
  const exported = await must('export.read', { context: projectContext, deliveryId: delivery.manifest.id })
  const docx = exported.files.find(file => file.relativePath === 'paper.docx')
  if (docx?.base64) {
    await writeFile(join(outDir, 'paper.docx'), Buffer.from(docx.base64, 'base64'))
    record('docx', { path: join(outDir, 'paper.docx'), bytes: Buffer.from(docx.base64, 'base64').length })
  }
  for (const file of exported.files) if (file.text && file.relativePath.endsWith('.md')) await writeFile(join(outDir, file.relativePath), file.text)

  const after = {}
  for (const relative of Object.keys(before)) {
    const path = join(SOURCE, relative)
    after[relative] = { sha256: await hashFile(path), mtimeMs: (await stat(path)).mtimeMs }
  }
  await writeFile(join(outDir, 'originals-after.json'), JSON.stringify(after, null, 2))
  const changed = Object.keys(before).filter(key => before[key].sha256 !== after[key].sha256 || before[key].mtimeMs !== after[key].mtimeMs)
  record('originals', { checked: Object.keys(before).length, changed })
  if (docx) {
    const { spawnSync } = await import('node:child_process')
    const measured = spawnSync(process.execPath, ['scripts/measure-pagination.mjs', join(outDir, 'paper.docx'), '--json', join(outDir, 'pagination.json')],
      { encoding: 'utf8' })
    record('pagination', { exit: measured.status, out: (measured.stdout ?? '').slice(0, 900), err: (measured.stderr ?? '').slice(0, 300) })
  }
  await finish(docx ? 0 : 1)
} catch (error) {
  if (error instanceof StopRun) { /* already recorded and cleaned up */ }
  else {
    record('error', { message: error.message, stack: String(error.stack).slice(0, 600) })
    try { await finish(1) } catch { /* StopRun */ }
  }
}
