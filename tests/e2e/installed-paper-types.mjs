// Opt-in TEST_ONLY teaching examples against the installed Host and its actual
// provider. This is not a claim that the teaching material is a published paper.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink, stat, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from '@playwright/test'
import { stringify, parse as parseYaml } from 'yaml'
import { digest } from '../../src/core/store/files.ts'
import { semanticReviewChecks } from '../../src/shared/review.ts'

const legacyRecovery = process.argv.includes('--legacy-recovery')
const interruptModel = process.argv.includes('--interrupt-model')
const longSequence = process.argv.includes('--long-sequence')
const semanticFix = process.argv.includes('--semantic-fix')
const originalModelLimit = longSequence || semanticFix ? 12 : 8
const generatedSections = longSequence ? ['sec_TEST_ONLY_body', 'sec_TEST_ONLY_scope', 'sec_TEST_ONLY_limits', 'sec_TEST_ONLY_summary', 'sec_TEST_ONLY_conclusion'] : ['sec_TEST_ONLY_body', 'sec_TEST_ONLY_summary']
assert.ok(process.argv.includes('--live-model') || legacyRecovery, 'Explicit --live-model is required for bounded actual provider calls')
const tasks = JSON.parse(await readFile('examples/local-evidence/tasks.json', 'utf8'))
const raw = Object.fromEntries(await Promise.all(['requirements.md', 'source-notes.md'].map(async name =>
  [name, await readFile(join('examples/local-evidence', name), 'utf8')])))
raw['unselected.txt'] = 'TEST_ONLY_UNSELECTED_NATIVE_PAPER_TYPES'
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const credentialPath = join(homedir(), '.dsh/.credentials.yaml')
const credentialHash = digest(await readFile(credentialPath))
const privateCredentialValues = []
function credentialValues(value, key = '') {
  if (typeof value === 'string' && /key|token|password|secret/iu.test(key) && value.length >= 12) privateCredentialValues.push(value)
  else if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) credentialValues(child, name)
}
credentialValues(parseYaml(await readFile(credentialPath, 'utf8')))
const resume = process.argv.find(arg => arg.startsWith('--resume='))?.slice('--resume='.length)
assert.ok(!resume || /^\.dsh-tmp[\\/]paper-types[\\/]\d+$/.test(resume), 'Resume is confined to an explicit teaching-test directory')
assert.ok(!legacyRecovery || resume, 'Legacy recovery requires an explicit existing teaching-test directory')
assert.ok(!interruptModel || !resume && !legacyRecovery, 'Interruption verification requires its own fresh teaching-test goal')
assert.ok(!interruptModel || !longSequence && !semanticFix, 'The interruption case retains its separate original eight-call goal')
const root = resume ? resolve(resume) : resolve('.dsh-tmp/paper-types', String(Date.now())), testHome = join(root, 'home')
const profileName = 'scholarflow-paper-types', profile = join(testHome, 'profiles', profileName)
if (!resume) {
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-paper-types-TEST_ONLY', private: true,
    dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
  await writeFile(join(profile, 'cordis.yml'), '[]\n')
  await writeFile(join(profile, 'cordis.patch.yml'), stringify([
    { id: 'credentials', name: '@deepseek-ai/dsh-credentials-local', config: { path: credentialPath, watch: false } },
  ]))
  await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
}
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let child, page
const errors = [], evidence = resume ? await readFile(join(root, 'native-evidence.json'), 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error; return []
}) : []
const exists = async path => stat(path).then(() => true).catch(error => { if (error.code !== 'ENOENT') throw error; return false })
async function start() {
  child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
    join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'), profileName, '--no-open', '--port', interruptModel ? '19353' : '19350'], {
    env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.resume() // Consume without printing authentication or request logs.
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Paper-types Host boot timed out')), 30000)
    let output = ''
    child.stdout.on('data', chunk => {
      output = (output + chunk.toString()).slice(-100000)
      const found = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (found) { clearTimeout(timer); done(found[1]) }
    })
    child.once('exit', code => { clearTimeout(timer); fail(new Error(`Paper-types Host exited ${code}`)) })
  })
  const context = await browser.newContext({ viewport: { width: 1500, height: 960 } })
  page = await context.newPage(); page.setDefaultTimeout(15000)
  page.on('pageerror', () => errors.push('PAGE_ERROR'))
  try { await page.goto(url) } catch { throw new Error('Paper-types client navigation failed; authenticated address omitted') }
  await page.waitForTimeout(800)
  let dialog = page.getByRole('dialog').first()
  if (await dialog.count() && (await dialog.innerText()).startsWith('预览版说明')) await dialog.getByRole('button', { name: '继续', exact: true }).click()
  await page.waitForTimeout(800)
  dialog = page.getByRole('dialog').first()
  if (await dialog.count() && (await dialog.innerText()).startsWith('添加一个 API Key')) await dialog.getByRole('button', { name: '稍后配置', exact: true }).click()
  await page.locator('button[aria-label="ScholarFlow"]').click({ timeout: 20000 })
  await page.getByRole('status').filter({ hasText: '已连接 Host' }).waitFor()
}
async function stop() {
  await page?.context().close(); page = undefined
  if (child && child.exitCode === null) { const exited = new Promise(done => child.once('exit', done)); child.kill(); await exited }
}
async function rpc(method, args) {
  return page.evaluate(async ({ method, args }) => {
    const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }), signal: AbortSignal.timeout(180000) })
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
    return (await response.json()).result
  }, { method, args })
}
async function call(method, request) {
  const result = await rpc(`scholarflow.v1/${method}`, { request })
  assert.equal(result.ok, true, `${method}: Host transport failed`)
  assert.equal(result.value.ok, true, `${method}: ${result.value.error?.code ?? 'failed'}`)
  return result.value.data
}
async function auditSavedExample(task, row) {
  // Recheck frozen native inputs without dispatching a model or modifying any
  // project artifact. This also runs when resuming already completed examples.
  const projectRoot = join(root, 'projects', task.type)
  const readJson = async path => JSON.parse(await readFile(join(projectRoot, path), 'utf8'))
  const saved = await readJson('.scholarflow/data/ledger.json')
  const pointer = await readJson('.scholarflow/drafting/current.json')
  const sequence = await readJson(`.scholarflow/runs/${pointer.sequenceId}/checkpoint.json`)
  const body = sequence.steps.find(step => step.sectionId === 'sec_TEST_ONLY_body')
  const summary = sequence.steps.find(step => step.sectionId === 'sec_TEST_ONLY_summary')
  assert.equal(body.state, 'accepted'); assert.equal(summary.state, 'accepted')
  assert.equal(sequence.status, 'completed-with-issues')
  const summaryPlan = await readJson(`.scholarflow/runs/${summary.childRunId}/plan.json`)
  const orderedAccepted = sequence.steps.filter(step => step.state === 'accepted')
  for (let index = 1; index < orderedAccepted.length; index++) {
    const plan = await readJson(`.scholarflow/runs/${orderedAccepted[index].childRunId}/plan.json`)
    assert.equal(plan.snapshot.documentHash, orderedAccepted[index - 1].acceptedDocumentHash)
    assert.equal(digest(plan.context.manuscript.actualSavedManuscriptForConsistency), orderedAccepted[index - 1].acceptedDocumentHash)
  }
  const previousSummary = orderedAccepted[orderedAccepted.indexOf(summary) - 1]
  assert.equal(summaryPlan.snapshot.documentHash, previousSummary.acceptedDocumentHash)
  assert.equal(digest(summaryPlan.context.manuscript.actualSavedManuscriptForConsistency), previousSummary.acceptedDocumentHash)
  const currentBody = await readFile(join(projectRoot, 'manuscript/paper.md'), 'utf8')
  if (!row.semanticFixAccepted) assert.equal(digest(currentBody), orderedAccepted.at(-1).acceptedDocumentHash)
  assert.equal(digest(currentBody), row.documentHash)
  const originalInput = await readJson(`.scholarflow/runs/${row.workflowId}/input.json`)
  assert.equal(originalInput.budget.maxModelCalls, originalModelLimit)
  const checkpoint = await readJson(`.scholarflow/runs/${row.workflowId}/checkpoint.json`)
  assert.equal(checkpoint.status, 'completed-with-issues')
  assert.equal(checkpoint.budget.calls.length, row.paidCalls)
  assert.ok(checkpoint.budget.calls.every(call => call.state !== 'pending'))
  let failedReviewCalls = 0
  for (const runId of new Set(checkpoint.budget.calls.map(call => call.runId))) {
    const plan = await readJson(`.scholarflow/runs/${runId}/plan.json`)
    assert.ok(!JSON.stringify(plan.context).includes(raw['unselected.txt']))
    if (plan.context.semanticScope) {
      assert.equal(plan.context.semanticScope, 'sf-cross-section-v1')
      if (!row.semanticFixAccepted) assert.equal(plan.snapshot.documentHash, row.documentHash)
      const run = await readJson(`.scholarflow/runs/${runId}/run.json`)
      if (run.status === 'failed') failedReviewCalls += checkpoint.budget.calls.filter(call => call.runId === runId).length
    }
  }
  const reviewPointer = await readJson('.scholarflow/reviews/current.json')
  const report = await readJson(`.scholarflow/reviews/${reviewPointer.reviewId}/report.json`)
  assert.equal(report.documentHash, row.documentHash)
  assert.ok(semanticReviewChecks.every(id => report.checks.some(check => check.id === id && check.method === 'model-assisted')))
  assert.ok(Object.values(saved.sources).every(source => source.identity.status === 'unverified' && !source.identifiers.doi))
  assert.ok(Object.values(saved.evidence).every(item => item.kind === 'quotation'))
  for (const [name, text] of Object.entries(raw)) assert.equal(await readFile(join(projectRoot, name), 'utf8'), text)
  row.summaryUsesExactlyAcceptedBody = true
  if (longSequence) row.conclusionUsesExactlyAcceptedBody = true
  row.unselectedMaterialAbsentFromEveryFrozenModelInput = true
  row.originalGoalModelLimit = originalModelLimit
  row.failedReviewCallsPreserved = failedReviewCalls
}
async function verifyLegacyRecovery() {
  // Uses the genuine pre-fix native fixture. Its refused Session archive is
  // preserved; only the public UI creates a new Session for the same project.
  const projectRoot = join(root, 'projects/course-paper')
  const saved = JSON.parse(await readFile(join(projectRoot, '.scholarflow/data/ledger.json'), 'utf8'))
  assert.equal(saved.outline.title, tasks[0].title)
  const registry = JSON.parse(await readFile(join(testHome, 'storages/workspace.json'), 'utf8'))
  const match = Object.entries(registry.tables.workspaces).find(([, row]) => resolve(row.path).toLowerCase() === projectRoot.toLowerCase())
  assert.ok(match)
  const workspaceId = match[0]
  const workflow = JSON.parse(await readFile(join(projectRoot, '.scholarflow/workflows/current.json'), 'utf8'))
  const prefix = join(projectRoot, '.scholarflow/runs', workflow.workflowId)
  const originalInput = JSON.parse(await readFile(join(prefix, 'input.json'), 'utf8'))
  const oldSessionId = originalInput.sessionId
  let oldLog
  for (const directory of await readdir(join(testHome, 'sessions'))) {
    const candidate = join(testHome, 'sessions', directory, oldSessionId, 'session.v4.jsonl.zstd')
    if (await exists(candidate)) { assert.equal(oldLog, undefined); oldLog = candidate }
  }
  assert.ok(oldLog)
  const oldLogHash = digest(await readFile(oldLog)), projectHashes = new Map()
  async function capture(directory, relativePath = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), 'Legacy teaching fixture must not follow links')
      const name = relativePath ? `${relativePath}/${entry.name}` : entry.name
      if (entry.isDirectory()) await capture(join(directory, entry.name), name)
      else { assert.ok(entry.isFile()); assert.ok(projectHashes.size < 5000); projectHashes.set(name, digest(await readFile(join(directory, entry.name)))) }
    }
  }
  await capture(projectRoot)
  await start()
  const oldContext = { requestId: 'req_native_legacy', workspaceId, sessionId: oldSessionId, projectId: saved.projectId, expectedLedgerRevision: saved.revision }
  const refused = await rpc('scholarflow.v1/project.inspect', { request: { context: oldContext } })
  assert.equal(refused.value.ok, false)
  assert.equal(refused.value.error.code, 'SESSION_FORMAT_UNSUPPORTED')
  assert.ok(!JSON.stringify(refused.value.error).includes(oldLog))
  await page.locator('.sf-project').getByRole('combobox', { name: 'DSH 工作区', exact: true }).selectOption(workspaceId)
  await page.getByRole('button', { name: '新建 ScholarFlow 会话', exact: true }).click()
  await page.waitForFunction(previous => { const current = document.querySelector('.sf-project')?.dataset.sfSessionId; return current && current !== previous }, oldSessionId)
  const sessionId = await page.locator('.sf-project').getAttribute('data-sf-session-id')
  const context = { ...oldContext, sessionId }
  const restored = await call('project.inspect', { context })
  assert.equal(restored.ledger.projectId, saved.projectId)
  assert.equal(restored.document.text, await readFile(join(projectRoot, 'manuscript/paper.md'), 'utf8'))
  const sequence = await call('draftSequence.inspect', { context })
  assert.equal(sequence.sequence.diagnostics.length, 0)
  assert.equal(sequence.sequence.checkpoint.steps.find(step => step.sectionId === 'sec_TEST_ONLY_body').state, 'accepted')
  const preview = await call('draftSequence.prepareAction', { context, sequenceId: sequence.sequence.input.sequenceId, action: 'next' })
  assert.equal(preview.sectionTarget.sectionId, 'sec_TEST_ONLY_summary')
  assert.equal(preview.structuralGap, false)
  await call('writing.dismiss', { planId: preview.planId })
  for (const [name, hash] of projectHashes) assert.equal(digest(await readFile(join(projectRoot, name))), hash)
  const afterHashes = new Map(projectHashes); projectHashes.clear(); await capture(projectRoot)
  assert.deepEqual(projectHashes, afterHashes, 'Recovery viewing cannot add or remove project artifacts')
  assert.equal(digest(await readFile(oldLog)), oldLogHash)
  assert.equal(digest(await readFile(credentialPath)), credentialHash)
  const checkpoint = JSON.parse(await readFile(join(prefix, 'checkpoint.json'), 'utf8'))
  assert.equal(checkpoint.budget.calls.length, 1); assert.ok(checkpoint.budget.calls.every(call => call.state !== 'pending'))
  assert.deepEqual(errors, [])
  await writeFile(resolve('.dsh-tmp/legacy-session-recovery.json'), JSON.stringify({ date: new Date().toISOString(), testOnly: true,
    actualLegacySessionRefused: true, publicUiNewSessionSameWorkspace: true, oldLogUnchanged: true, allProjectBytesUnchanged: true,
    acceptedChapterRestored: true, nextSummaryPreviewValid: true, newProviderCalls: 0, originalPaidCalls: 1, credentialsUnchanged: true }, null, 2))
  console.log('PASS TEST_ONLY legacy Session refusal, same-workspace UI recovery and next-chapter preview; all project bytes and original call preserved')
}
async function verifyModelInterruption({ projectRoot, context, act, confirm, workflow, sequence, plan, before }) {
  const prefix = join(projectRoot, '.scholarflow/runs', workflow.workflowId)
  const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
  const rootFile = join(prefix, 'checkpoint.json')
  const childFile = join(projectRoot, '.scholarflow/runs', plan.runId, 'run.json')
  const rootInput = await readFile(join(prefix, 'input.json'), 'utf8')
  const sequenceInputPath = join(projectRoot, '.scholarflow/runs', sequence.sequenceId, 'input.json')
  const sequenceInput = await readFile(sequenceInputPath, 'utf8')
  const lost = confirm('runs.start', plan).then(() => 'settled', () => 'lost')
  let pendingCall
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const checkpoint = await readJson(rootFile)
    pendingCall = checkpoint.budget.calls.find(call => call.runId === plan.runId && call.state === 'pending')
    if (pendingCall && await exists(childFile)) break
    await page.waitForTimeout(40)
  }
  assert.ok(pendingCall, 'A real native request must be registered before terminating the test-owned Host')
  await page.waitForTimeout(300)
  const inFlight = await readJson(rootFile), executing = await readJson(childFile)
  assert.equal(inFlight.budget.calls.length, 1); assert.equal(inFlight.budget.calls[0].state, 'pending')
  assert.equal(executing.status, 'running'); assert.equal(executing.usedModelCalls, 1)
  assert.equal(executing.owner.pid, child.pid, 'Terminate only the exact test-owned executor process')
  const liveDenied = await rpc('scholarflow.v1/runs.prepareAction', { request: { context: await context(), runId: plan.runId, action: 'close' } })
  assert.equal(liveDenied.value.ok, false); assert.equal(liveDenied.value.error.code, 'RUN_IN_PROGRESS')
  // Kill before closing the HTTP client. Closing its browser first would test
  // cancellation settlement rather than an unanswered request after process loss.
  const exited = new Promise(done => child.once('exit', done))
  child.kill(); await exited
  await page.context().close(); page = undefined
  assert.equal(await lost, 'lost', 'The old browser must not receive a completed artifact')
  const checkpointBeforeBoot = await readFile(rootFile, 'utf8')
  await start()
  assert.equal(await readFile(rootFile, 'utf8'), checkpointBeforeBoot)
  assert.equal((await act('document.read')).document.text, before)
  assert.equal((await act('edits.list')).states.length, 0)
  const replayDenied = await rpc('scholarflow.v1/runs.start', { request: { context: await context(), planId: plan.planId, planHash: plan.planHash } })
  assert.equal(replayDenied.value.ok, false); assert.equal(replayDenied.value.error.code, 'INVALID_APPROVAL')
  const nextDenied = await rpc('scholarflow.v1/draftSequence.prepareAction', { request: { context: await context(), sequenceId: sequence.sequenceId, action: 'next' } })
  assert.equal(nextDenied.value.ok, false); assert.equal(nextDenied.value.error.code, 'DRAFT_SEQUENCE_AWAITING_ACCEPTANCE')
  assert.equal((await readJson(rootFile)).budget.calls.length, 1)
  const closedRequest = await act('workflow.prepareAction', { workflowId: workflow.workflowId, action: 'close-unknown-call', callId: pendingCall.callId,
    reason: 'TEST_ONLY 已确认原执行进程退出，保留未知请求及全部原额度，不把失联视为未发送，也不重放。' })
  await confirm('workflow.confirm', closedRequest)
  await confirm('runs.confirmAction', await act('runs.prepareAction', { runId: plan.runId, action: 'close' }))
  assert.equal((await readJson(childFile)).usedModelCalls, 1)
  await confirm('draftSequence.confirm', await act('draftSequence.prepareAction', { sequenceId: sequence.sequenceId, action: 'cancel',
    reason: 'TEST_ONLY 结束未知章节顺序，保留原登记和收费请求，只重新预览当前未改变正文，不恢复旧调用。' }))
  const nextSequence = await confirm('draftSequence.confirm', await act('draftSequence.prepare', {
    instruction: 'TEST_ONLY 依据当前真实保存资料保留范围、引用、人工备注和未实施限制，只生成待审阅候选。', summarySectionIds: ['sec_TEST_ONLY_summary'],
  }))
  const preview = await act('draftSequence.prepareAction', { sequenceId: nextSequence.sequenceId, action: 'next' })
  assert.equal(preview.sectionTarget.sectionId, 'sec_TEST_ONLY_body'); assert.notEqual(preview.runId, plan.runId)
  await call('writing.dismiss', { planId: preview.planId })
  const final = await readJson(rootFile)
  assert.equal(final.budget.calls.length, 1); assert.equal(final.budget.calls[0].callId, pendingCall.callId)
  assert.equal(final.budget.calls[0].state, 'interrupted')
  assert.equal(await readFile(join(prefix, 'input.json'), 'utf8'), rootInput)
  assert.equal(await readFile(sequenceInputPath, 'utf8'), sequenceInput)
  assert.equal(JSON.parse(rootInput).budget.maxModelCalls, 8)
  assert.equal((await act('document.read')).document.text, before)
  assert.equal((await act('edits.list')).states.length, 0)
  for (const [name, text] of Object.entries(raw)) assert.equal(await readFile(join(projectRoot, name), 'utf8'), text)
  assert.equal(digest(await readFile(credentialPath)), credentialHash)
  assert.deepEqual(errors, [])
  await writeFile(resolve('.dsh-tmp/interrupted-model-recovery.json'), JSON.stringify({ date: new Date().toISOString(), testOnly: true,
    nativeRequestRegisteredBeforeProcessLoss: true, originalPaidCalls: 1, originalGoalModelLimit: 8, bootDidNotReplayOrRefund: true,
    liveOwnerCloseRefused: true, oldApprovalRefusedAfterBoot: true, unknownChapterNotRedispatched: true,
    explicitUnknownClosurePreservesCall: true, nextFreshPreviewUsesSameOriginalBudget: true, originalInputsUnchanged: true,
    bodyAndRawMaterialsUnchanged: true, noProposalsAutoPublished: true, credentialsUnchanged: true }, null, 2))
  console.log('PASS TEST_ONLY in-flight native process loss, cold observation, explicit unknown closure and fresh preview; original request remains charged (1/8)')
}
try {
  if (legacyRecovery) await verifyLegacyRecovery()
  else {
  await start()
  for (const task of tasks) {
    if (evidence.some(row => row.type === task.type)) continue
    const projectRoot = join(root, 'projects', task.type)
    const ledgerPath = join(projectRoot, '.scholarflow/data/ledger.json')
    let workspace, sessionId, source, workflow, sequence
    const existing = resume && await exists(ledgerPath)
    if (existing) {
      const registry = JSON.parse(await readFile(join(testHome, 'storages/workspace.json'), 'utf8'))
      const match = Object.entries(registry.tables.workspaces).find(([, row]) => resolve(row.path).toLowerCase() === projectRoot.toLowerCase())
      assert.ok(match, 'The actual persisted Host workspace must still own this test project')
      workspace = { ...match[1], workspaceId: match[0] }
      workflow = JSON.parse(await readFile(join(projectRoot, '.scholarflow/workflows/current.json'), 'utf8'))
      const input = JSON.parse(await readFile(join(projectRoot, '.scholarflow/runs', workflow.workflowId, 'input.json'), 'utf8'))
      sessionId = input.sessionId
      sequence = JSON.parse(await readFile(join(projectRoot, '.scholarflow/drafting/current.json'), 'utf8'))
      const saved = JSON.parse(await readFile(ledgerPath, 'utf8'))
      source = Object.values(saved.sources).find(row => row.title === 'TEST_ONLY 本地证据层次练习说明')
      assert.ok(source); assert.equal(saved.outline.title, task.title)
      for (const [name, text] of Object.entries(raw)) assert.equal(await readFile(join(projectRoot, name), 'utf8'), text)
    } else {
      await mkdir(projectRoot, { recursive: true })
      for (const [name, text] of Object.entries(raw)) await writeFile(join(projectRoot, name), text)
      const created = await rpc('workspace/create', { request: { path: projectRoot } })
      assert.equal(created.ok, true)
      workspace = created.value.workspace
      if (!await page.locator('.sf-project').isVisible()) await page.locator('button[aria-label="ScholarFlow"]').click()
      await page.locator('.sf-project').getByRole('combobox', { name: 'DSH 工作区', exact: true }).selectOption(workspace.workspaceId)
      await page.getByRole('button', { name: '新建 ScholarFlow 会话', exact: true }).click()
      await page.getByText(`当前工作区：${workspace.title} · 尚未初始化`, { exact: true }).waitFor()
      await page.getByRole('combobox', { name: '论文类型', exact: true }).selectOption(task.type)
      await page.getByRole('combobox', { name: '论文语言', exact: true }).selectOption('zh-CN')
      await page.getByRole('spinbutton', { name: '每次运行模型调用上限', exact: true }).fill(String(originalModelLimit))
      await page.getByRole('textbox', { name: '项目标题', exact: true }).fill(task.title)
      await page.getByRole('button', { name: '预览初始化计划', exact: true }).click()
      await page.getByRole('dialog', { name: '初始化确认' }).waitFor()
      await page.getByRole('button', { name: '确认初始化', exact: true }).click()
      await page.getByText('项目已保存', { exact: false }).waitFor()
      sessionId = await page.locator('.sf-project').getAttribute('data-sf-session-id')
    }
    const ledger = async () => JSON.parse(await readFile(ledgerPath, 'utf8'))
    const context = async () => { const saved = await ledger(); return { requestId: `req_native_${crypto.randomUUID().replaceAll('-', '_')}`,
      workspaceId: workspace.workspaceId, sessionId, projectId: saved.projectId, expectedLedgerRevision: saved.revision } }
    const act = async (method, input = {}) => call(method, { context: await context(), ...input })
    const confirm = async (method, plan) => act(method, { planId: plan.planId, planHash: plan.planHash })
    const register = async (relativePath, role) => {
      const registered = await act('materials.register', { relativePath, role, confirmExcludedFile: false })
      return { registered, parsed: await act('materials.parse', { materialId: registered.material.id }) }
    }
    const human = 'TEST_ONLY 人工备注 😀：保留原文，不把教学资料当作正式论文与实验记录。'
    if (!existing) {
      const teacher = await register('requirements.md', 'assignment')
      const requirements = await act('requirements.extract', { materialId: teacher.registered.material.id })
      assert.ok(requirements.requirements.some(row => row.kind === 'length'))
      for (const row of requirements.requirements) await act('requirements.confirm', { requirementId: row.id,
        ...(row.kind === 'length' ? { countingPolicyId: 'sf-body-han-western-v1' } : {}) })
      const notes = await register('source-notes.md', 'notes')
      source = (await confirm('sources.confirmRegistration', await act('sources.prepareRegistration', { source: {
        kind: 'other', title: 'TEST_ONLY 本地证据层次练习说明', authors: [], identifiers: {}, materialId: notes.registered.material.id,
      } }))).source
      assert.equal(source.identity.status, 'unverified'); assert.equal(source.identifiers.doi, undefined)
      const block = notes.parsed.parsed.blocks.find(row => row.text.includes('资料身份核验'))
      assert.ok(block)
      const located = await act('evidence.confirm', { sourceId: source.id, sourceContentHash: notes.parsed.parsed.sourceContentHash,
        locator: block.locator, excerpt: block.text, kind: 'quotation' })
      const claim = (await act('claims.upsert', { claim: { text: '本地教学说明将身份、定位与支持范围分开记录。', kind: 'author-inference',
        scope: '仅限这份 TEST_ONLY 教学说明，不能推广为实测研究结论。', limitations: [task.limitation],
        evidenceLinks: [{ evidenceId: located.evidence.id, relation: 'supports', rationale: '所选原文直接列出这三层，仅确认教学说明自身的表述。' }],
      } })).claim
      const document = (await act('document.read')).document
      const repeated = semanticFix && task.type === 'course-paper' ? `\n\nTEST_ONLY 原文描述了身份、定位与支持范围，身份一致不能替代论点支持。[@${source.citeKey}]\n\nTEST_ONLY 原文描述了身份、定位与支持范围，身份一致不能替代论点支持。[@${source.citeKey}]` : ''
      await act('document.saveManual', { text: `# ${task.title}\n\n## 人工备注\n\n${human}${repeated}\n`, baseHash: document.contentHash })
      await act('outline.confirm', { expectedOutlineVersion: 0, outline: { version: 0, title: task.title, researchQuestion: task.question,
        thesis: '区分证据层次并保留任务限制。', confirmation: 'confirmed', sections: [
          { id: 'sec_TEST_ONLY_summary', title: '摘要', purpose: '总结实际已接受讨论', claimIds: [claim.id], missingEvidence: [task.limitation] },
          { id: 'sec_TEST_ONLY_body', title: '证据讨论', purpose: '依据定位原文保留范围', claimIds: [claim.id], missingEvidence: task.type === 'research-paper' ? ['真实实验与结果'] : [] },
          ...(longSequence ? [
            { id: 'sec_TEST_ONLY_scope', title: '适用范围比较', purpose: '区分资料表述、作者推论和不能推广的范围', claimIds: [claim.id], missingEvidence: [task.limitation] },
            { id: 'sec_TEST_ONLY_limits', title: '反例与限制', purpose: '讨论身份一致但仍不足以支持具体推论的边界，不编造来源', claimIds: [claim.id], missingEvidence: [task.limitation] },
          ] : []),
          { id: 'sec_TEST_ONLY_human', title: '人工备注', purpose: '保留人工原文', claimIds: [], missingEvidence: [] },
          ...(longSequence ? [{ id: 'sec_TEST_ONLY_conclusion', title: '结论', purpose: '只归纳实际已接受正文，不扩大证据和完成状态', claimIds: [claim.id], missingEvidence: [task.limitation] }] : []),
        ] } })
      workflow = await confirm('workflow.confirm', await act('workflow.prepare', { goal: { researchQuestion: task.question, minimumSources: 1, minimumLocatedEvidence: 1 } }))
      sequence = await confirm('draftSequence.confirm', await act('draftSequence.prepare', {
        instruction: longSequence ? 'TEST_ONLY 多节教学练习：依本节用途，仅依定位原文和实际已接受正文展开三个简短段落，每节约300–450汉字，区分资料表述与作者推论，保留未核验与未实施实验限制。不要虚称系统检索、出版资料或实测结果，不增添未提供的实验与数值。摘要和结论只能总结实际保存正文。' : 'TEST_ONLY 教学练习：仅依定位原文讨论三层证据边界，180字以内，保留未核验与未实施实验限制。不要声称系统检索、出版资料或实测结果。摘要只总结实际保存正文。',
        summarySectionIds: longSequence ? ['sec_TEST_ONLY_summary', 'sec_TEST_ONLY_conclusion'] : ['sec_TEST_ONLY_summary'],
      }))
    }
    const checkpointPath = join(projectRoot, '.scholarflow/runs', workflow.workflowId, 'checkpoint.json')
    const checkpoint = async () => JSON.parse(await readFile(checkpointPath, 'utf8'))
    const childIds = []
    for (const sectionId of generatedSections) {
      const observed = await act('draftSequence.inspect')
      assert.equal(observed.sequence.diagnostics.length, 0)
      const prior = observed.sequence.checkpoint.steps.find(row => row.sectionId === sectionId)
      if (prior.state === 'accepted') { childIds.push(prior.childRunId); continue }
      assert.equal(prior.state, 'pending', 'An unknown or unaccepted old call must not be automatically replayed')
      const before = (await act('document.read')).document.text
      const plan = await act('draftSequence.prepareAction', { sequenceId: sequence.sequenceId, action: 'next' })
      assert.equal(plan.sectionTarget.sectionId, sectionId); assert.equal(plan.structuralGap, false)
      console.log(`START TEST_ONLY ${task.type}: actual ${sectionId === 'sec_TEST_ONLY_body' ? 'discussion' : 'summary'} candidate`)
      if (interruptModel) {
        await verifyModelInterruption({ projectRoot, context, act, confirm, workflow, sequence, plan, before })
        break
      }
      // Long cases exercise the actual newly integrated stage scheduler, while
      // still explicitly accepting every candidate through the operator API.
      let generated
      if (longSequence) {
        await call('writing.dismiss', { planId: plan.planId })
        const stage = await act('automatic.prepare', { workflowId: workflow.workflowId, draftSequenceId: sequence.sequenceId,
          policy: { ruleReview: true, insufficientResearchReason: 'TEST_ONLY 保留教学资料不足，绝不编造出版与实测结果。' } })
        const result = await confirm('automatic.confirm', stage)
        assert.equal(result.state.code, 'AUTOMATIC_STAGE_REVIEW_REQUIRED')
        const childRun = JSON.parse(await readFile(join(projectRoot, '.scholarflow/runs', stage.input.work.runId, 'run.json'), 'utf8'))
        generated = { run: childRun, ...await act('edits.read', { proposalId: childRun.proposalId }) }
      } else generated = await confirm('runs.start', plan)
      assert.ok(generated.proposal, `Actual ${task.type} ${sectionId} did not produce a candidate`)
      childIds.push(generated.run.runId)
      assert.equal((await act('document.read')).document.text, before, 'Provider output cannot accept itself')
      await act('edits.apply', { proposalId: generated.proposal.id, proposalHash: generated.proposalHash })
      const accepted = (await act('document.read')).document.text
      assert.ok(accepted.includes(human)); assert.ok(accepted.includes(`[@${source.citeKey}]`))
      assert.ok(!accepted.includes(raw['unselected.txt']))
      if (sectionId === 'sec_TEST_ONLY_body') {
        const checkpointBefore = await readFile(checkpointPath, 'utf8')
        await stop(); await start() // Actual process death and native Session restoration.
        assert.equal(await readFile(checkpointPath, 'utf8'), checkpointBefore, 'Boot cannot replay or refund a paid child')
        assert.equal((await act('document.read')).document.text, accepted)
        const restored = await act('draftSequence.inspect')
        assert.equal(restored.sequence.pendingProposalIds.length, 0)
        assert.equal(restored.sequence.diagnostics.length, 0)
      }
    }
    if (interruptModel) break
    if ((await act('draftSequence.inspect')).sequence.checkpoint.status !== 'completed-with-issues')
      await confirm('draftSequence.confirm', await act('draftSequence.prepareAction', { sequenceId: sequence.sequenceId, action: 'next' }))
    let accepted = (await act('document.read')).document.text
    console.log(`START TEST_ONLY ${task.type}: actual five-check review within original remaining quota`)
    const needsFix = semanticFix && task.type === 'course-paper'
    let review = await act('review.inspect')
    const reusableReview = existing && !review.stale && review.report?.documentHash === digest(accepted) &&
      semanticReviewChecks.every(id => review.report.checks.some(row => row.id === id && row.method === 'model-assisted'))
    const previousAuto = reusableReview ? (await act('automatic.inspect', { workflowId: workflow.workflowId })).automatic : undefined
    let auto = reusableReview ? { automaticId: previousAuto.input.automaticId, state: previousAuto.state } : await confirm('automatic.confirm', await act('automatic.prepare', { workflowId: workflow.workflowId, modelReview: true,
      policy: { ruleReview: true, workingDraftDelivery: !needsFix, ...(!needsFix && { stopRevisionReason: 'TEST_ONLY 练习结束，保留未知、未核验与未开展实验的限制，只交付工作草稿，不冒充正式学术成果。' }) } }))
    if (!reusableReview) assert.equal(auto.state.status, needsFix ? 'waiting-input' : 'completed-with-issues')
    assert.equal((await act('document.read')).document.text, accepted)
    review = await act('review.inspect')
    assert.equal(review.stale, false)
    assert.ok(semanticReviewChecks.every(id => review.report.checks.some(row => row.id === id && row.method === 'model-assisted')))
    assert.ok(review.report.checks.some(row => row.status === 'unknown'))
    assert.equal(review.report.checks.find(row => row.id === 'own_research_results')?.status, task.type === 'research-paper' ? 'fail' : undefined)
    if (task.type === 'research-paper') assert.ok(review.report.issues.some(row => row.severity === 'B0' && row.state === 'open'))
    let fixedIssueId, semanticRecheckResolved
    if (needsFix) {
      const restoredFix = existing ? (await act('review.fixes')).fixes.find(row => row.state === 'accepted') : undefined
      if (restoredFix && reusableReview) {
        fixedIssueId = restoredFix.issueId
      } else {
      const issue = review.report.issues.find(row => row.location && row.checkMethod === 'model-assisted' && row.category === 'style') ??
        review.report.issues.find(row => row.location && row.checkMethod === 'model-assisted')
      assert.ok(issue, 'The genuine report must identify a positioned semantic issue; a fixture cannot invent one')
      fixedIssueId = issue.id
      const before = accepted, parentReportId = review.report.id
      // A completed review step can stop waiting at the revision gate. Closing
      // the scheduler leaves the original whole-goal allowance unchanged.
      if (auto.state.status === 'waiting-input') await confirm('automatic.confirm', await act('automatic.prepareAction', { workflowId: workflow.workflowId, automaticId: auto.automaticId,
        action: 'close', reason: 'TEST_ONLY 明确转入当前问题修订，保留原审查和整体目标额度。' }))
      const fixPreview = await act('automatic.prepare', { workflowId: workflow.workflowId, revision: { issueId: issue.id,
        instruction: 'TEST_ONLY 修复此真实审查问题，把目标完整段落压缩为一两句具体、有边界的表述；不能删除整个段落，不能添加标题或章节字段。保留原段全部 [@sf_...] 引用 token 原样，只返回严格 JSON replacementText 和 limitations；不添加来源或实测结果。' }, policy: { ruleReview: true } })
      const fixed = await confirm('automatic.confirm', fixPreview)
      assert.equal(fixed.state.code, 'AUTOMATIC_STAGE_REVIEW_REQUIRED')
      const run = JSON.parse(await readFile(join(projectRoot, '.scholarflow/runs', fixPreview.input.work.runId, 'run.json'), 'utf8'))
      const candidate = await act('edits.read', { proposalId: run.proposalId })
      assert.equal((await act('document.read')).document.text, before)
      const applied = await act('edits.apply', { proposalId: candidate.proposal.id, proposalHash: candidate.proposalHash })
      assert.equal(applied.recheck.status, 'completed')
      accepted = (await act('document.read')).document.text
      assert.notEqual(accepted, before); assert.ok(accepted.includes(human))
      assert.notEqual((await ledger()).reviewIssues[issue.id].state, 'resolved', 'Acceptance plus rule review cannot close a semantic finding')
      const recheck = await act('review.prepareModel', { assessmentScope: 'cross-section' })
      await confirm('review.startModel', recheck)
      review = await act('review.inspect')
      assert.equal(review.stale, false); assert.equal(review.report.documentHash, digest(accepted))
      assert.ok(await exists(join(projectRoot, '.scholarflow/reviews', parentReportId, 'report.json')))
      }
      // Recheck is an assessment, not a promise of success: a local correction
      // cannot silently close a genuine cross-section repetition finding.
      let assessment
      for (const runId of new Set((await checkpoint()).budget.calls.map(row => row.runId))) {
        const run = JSON.parse(await readFile(join(projectRoot, '.scholarflow/runs', runId, 'run.json'), 'utf8'))
        if (run.reviewId !== review.report.id) continue
        const childCheckpoint = JSON.parse(await readFile(join(projectRoot, '.scholarflow/runs', runId, 'checkpoint.json'), 'utf8'))
        assessment = childCheckpoint.output?.rechecks.find(row => row.issueId === fixedIssueId)
      }
      assert.ok(assessment, 'The actual provider report must explicitly reassess the accepted correction')
      semanticRecheckResolved = assessment.status === 'pass'
      const issueState = (await ledger()).reviewIssues[fixedIssueId].state
      if (semanticRecheckResolved) assert.equal(issueState, 'resolved')
      else assert.notEqual(issueState, 'resolved', 'A failed or unknown provider reassessment must retain the genuine finding')
      auto = await confirm('automatic.confirm', await act('automatic.prepare', { workflowId: workflow.workflowId, policy: {
        ruleReview: true, workingDraftDelivery: true, stopRevisionReason: 'TEST_ONLY 修复复查已完成，保留其他未知与未核验限制，仅交付工作草稿。' } }))
      assert.equal(auto.state.status, 'completed-with-issues')
    }
    const current = await ledger(), delivery = Object.values(current.deliveries)[0]
    assert.ok(delivery); assert.equal(delivery.reviewState, 'draft-incomplete')
    const exported = await act('export.read', { deliveryId: delivery.id })
    assert.equal(exported.files.length, 3)
    assert.equal(exported.files.find(row => row.relativePath === 'paper.md').text, accepted)
    assert.equal(delivery.documentHash, digest(accepted))
    assert.ok(exported.files.find(row => row.relativePath === 'references.bib').text.includes(source.citeKey))
    assert.ok(!JSON.stringify(exported).includes(raw['unselected.txt']))
    const published = JSON.stringify(exported)
    for (const secret of privateCredentialValues) assert.ok(!published.includes(secret), 'Export must not contain credential values')
    for (const path of [projectRoot, credentialPath]) {
      assert.ok(!published.includes(path))
      assert.ok(!published.includes(path.replaceAll('\\', '/')))
      assert.ok(!published.includes(JSON.stringify(path).slice(1, -1)))
    }
    const preflight = await act('export.preflight'); assert.equal(preflight.reviewedAllowed, false)
    const refused = await rpc('scholarflow.v1/export.create', { request: { context: await context(), planId: preflight.planId, planHash: preflight.planHash, deliveryType: 'reviewed-draft' } })
    assert.equal(refused.value.ok, false); assert.equal(refused.value.error.code, 'REVIEW_NOT_READY')
    const rootCheckpoint = await checkpoint()
    assert.ok(rootCheckpoint.budget.calls.length >= generatedSections.length + 1 && rootCheckpoint.budget.calls.length <= originalModelLimit)
    assert.ok(rootCheckpoint.budget.calls.every(row => row.kind === 'model' && row.state !== 'pending'))
    const uniqueChildRuns = new Set(rootCheckpoint.budget.calls.map(row => row.runId)).size
    assert.ok(uniqueChildRuns >= generatedSections.length + 1 && uniqueChildRuns <= originalModelLimit, 'All review attempts and explicit repairs remain in the original goal')
    assert.ok(childIds.every(id => rootCheckpoint.budget.calls.some(row => row.runId === id)))
    for (const [name, text] of Object.entries(raw)) assert.equal(await readFile(join(projectRoot, name), 'utf8'), text)
    assert.equal(digest(await readFile(credentialPath)), credentialHash)
    evidence.push({ type: task.type, workflowId: workflow.workflowId, paidCalls: rootCheckpoint.budget.calls.length,
      uniqueChildRuns, actualHostColdRestore: true, candidateAcceptanceExplicit: true, originalMaterialsUnchanged: true,
      sourceUnverified: true, reviewedDraftRefused: true, sameVersionThreeFiles: true, documentHash: digest(accepted),
      automaticStatus: auto.state.status, unknownAndLimitationsPreserved: true })
    Object.assign(evidence.at(-1), { generatedSectionCount: generatedSections.length, longSequence, semanticFixAccepted: !!fixedIssueId, fixedIssueId, semanticRecheckResolved })
    await writeFile(join(root, 'native-evidence.json'), JSON.stringify(evidence, null, 2))
    console.log(`PASS TEST_ONLY ${task.type}: native chapters, cold restore, five-check review, honest delivery (${rootCheckpoint.budget.calls.length}/${originalModelLimit} calls)`)
  }
  assert.deepEqual(errors, [])
  if (!interruptModel) {
  for (const task of tasks) await auditSavedExample(task, evidence.find(row => row.type === task.type))
  await writeFile(join(root, 'native-evidence.json'), JSON.stringify(evidence, null, 2))
  await writeFile(resolve('.dsh-tmp/paper-types-latest.json'), JSON.stringify({ date: new Date().toISOString(), testOnly: true, actualProvider: true,
    credentialsUnchanged: digest(await readFile(credentialPath)) === credentialHash, examples: evidence }, null, 2))
  }
  }
} finally { await stop(); await browser.close() }
