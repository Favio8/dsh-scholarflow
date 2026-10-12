// SF-179–184: real Host/client and core execution with a fixed TEST_ONLY model adapter.
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { creationSpec, writingTaskSchema } from '../../src/shared/writing-task.ts'
import { DirectoryStore } from '../fixtures/directory-store.ts'
import { snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { sourceSchema } from '../../src/shared/schema.ts'
import { json } from '../../src/core/store/files.ts'
import { prepareModelReview } from '../../src/core/review/model.ts'
import { executeModelReview } from '../../src/core/review/model-run.ts'
import { prepareGeneration, executeGeneration } from '../../src/core/pipeline/generation.ts'
import { issueFixSelection } from '../../src/core/review/issue-fixes.ts'
import { runStateSchema } from '../../src/shared/runs.ts'
import { applicationResult } from '../../src/host/bridge/project-api.ts'
import { firstParagraph, secondParagraph, improvementOutput, improvementText } from '../fixtures/review-improvement-output.ts'

const resume = process.argv.find(arg => arg.startsWith('--resume='))?.slice(9)
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) ?? 'all'
const root = resume ? resolve(resume) : resolve('.dsh-tmp/v19-ai-review', String(Date.now()))
const profile = join(root, 'profiles/flow-test'), workspacePath = join(root, 'Flow TEST_ONLY')
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
if (!resume) {
  await mkdir(join(profile, 'node_modules'), { recursive: true }); await mkdir(workspacePath, { recursive: true })
  const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
  await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
  await writeFile(join(profile, 'cordis.yml'), '[]\n'); await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
}
const host = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals', join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'), 'flow-test', '--no-open', '--port', '0'], {
  env: { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write', ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
})
const url = new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Host boot timed out')), 30000); let output = ''
  host.stdout.on('data', chunk => { output += chunk; const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/); if (match) { clearTimeout(timer); done(match[1]) } })
  host.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
})
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } }), checks = [], errors = [], mutations = []
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { if (request.method() === 'POST') { const method = request.postDataJSON()?.method; if (/document\/saveManual|document\.saveManual|writingTask\.action|review\.(run|startModel)|outline\.confirm/.test(method ?? '')) mutations.push(method) } })
const report = async () => writeFile(join(root, `report-${phase}.json`), JSON.stringify({ checks, errors, paidModelCalls: 0, testSeams: ['fixed model adapter; real core terminal states'], modelCalls: calls, root }, null, 2))
const record = async (name, detail = {}) => { checks.push({ name, passed: true, detail }); console.log('PASS ' + name + ' ' + JSON.stringify(detail)); await report() }
const rpc = (method, args) => page.evaluate(async ({ method, args }) => {
  const response = await fetch('api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
  const result = (await response.json()).result
  if (!result.ok || result.value?.ok === false) throw new Error(JSON.stringify(result.error ?? result.value.error))
  return result.value?.data ?? result.value
}, { method, args })
const dismiss = async () => {
  // Both onboarding dialogs are optional, and a dismissal is asynchronous: the host keeps the node
  // mounted with its button disabled until it finishes taking it away. So wait for a dialog to
  // appear, click only while the button is enabled, then wait for the node to actually go.
  // Checking once and clicking blind raced the mount (the dialog arrived after the shell painted
  // and covered the sidebar); re-clicking the closing node only burned the click timeout.
  for (let attempt = 0; attempt < 6; attempt++) {
    const dialog = page.getByRole('dialog').first()
    const appeared = await dialog.waitFor({ state: 'visible', timeout: attempt === 0 ? 5000 : 3000 }).then(() => true).catch(() => false)
    if (!appeared) return
    const text = (await dialog.innerText().catch(() => '')).trimStart()
    const name = text.startsWith('预览版说明') ? '继续' : text.startsWith('添加一个 API Key') ? '稍后配置' : undefined
    if (!name) throw new Error('unexpected dialog: ' + text.slice(0, 80))
    const button = dialog.getByRole('button', { name, exact: true })
    if (await button.isEnabled()) await button.click({ timeout: 15000 })
    await button.waitFor({ state: 'hidden', timeout: 45000 }).catch(() => {})
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
let context
const nav = page.getByRole('navigation', { name: '论文流程', exact: true })
const reviewButton = nav.locator('[data-node="review"]'), assistant = page.locator('.sf-review-assistant')
const openSession = async target => { const workspace = page.locator(`[data-row-key="workspace:${target.workspaceId}"]`); if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click(); await page.locator(`[data-row-key="session:${target.sessionId}"]`).click() }
const io = new DirectoryStore(workspacePath), plans = new Map(), calls = []
const owner = { pid: process.pid, bootInstance: 'TEST_ONLY-ai-review' }, controller = { current: undefined }
let mode = 'normal', held, releaseReview
const waitForAbort = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('TEST_ONLY cancelled model')), { once: true }))
try {
  await page.goto(await url); await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor({ timeout: 45000 }); await dismiss()
  if (resume) { ({ context } = JSON.parse(await readFile(join(root, 'fixture.json'), 'utf8'))); await openSession(context) }
  else {
    const workspaceId = (await rpc('workspace/create', { request: { path: workspacePath } })).workspace.workspaceId
    await page.reload(); await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor(); await dismiss()
    await page.locator(`[data-row-key="workspace:${workspaceId}"]`).hover()
    const [created] = await Promise.all([page.waitForResponse(response => response.request().postDataJSON()?.method === 'session/create'), page.locator('button[aria-label*="Flow TEST_ONLY"][aria-label*="中新建会话"]').click()])
    const sessionId = (await created.json()).result.value.sessionId
    await page.locator(`[data-row-key="session:${sessionId}"][aria-selected="true"]`).waitFor()
    await page.locator('button[title="选择新任务使用的 Agent 预设"]').click(); await page.locator('[class*="_item_"]').filter({ hasText: /^ScholarFlow/ }).click(); await page.locator('.sf-wizard').waitFor()
    context = { requestId: 'req_review_TEST_ONLY', workspaceId, sessionId }
    const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'AI检查 TEST_ONLY', type: 'course-paper' } } })
    await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
    let current = await snapshot(io)
    await mutateLedger(io, current.ledger.revision, ledger => { ledger.sources.src_TEST_ONLY = sourceSchema.parse({ id: 'src_TEST_ONLY', citeKey: 'sf_TEST_ONLY', kind: 'paper', title: 'TEST_ONLY 来源', authors: [], year: 2025, identifiers: {}, identity: { status: 'unverified', method: 'none' }, textAccess: 'metadata', provenance: [] }) })
    current = await snapshot(io)
    await rpc('scholarflow.v1/document.saveManual', { request: { context: { ...context, projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision }, text: `# TEST_ONLY 文稿\n\n${firstParagraph}\n\n${secondParagraph}\n`, baseHash: current.document.contentHash } })
    current = await snapshot(io)
    const spec = creationSpec.parse({ title: 'AI检查 TEST_ONLY', type: 'course-paper', language: 'zh-CN', format: 'docx', requirements: 'TEST_ONLY 检查并准备修订。', targetLength: 500, materials: [], sections: [{ id: 'sec_TEST_ONLY', title: '正文', targetLength: 500 }], online: false, manuscriptDir: 'manuscript' })
    const task = writingTaskSchema.parse({ schemaVersion: 1, id: 'writing_AI_TEST_ONLY', projectId: current.ledger.projectId, sessionId, mode: 'guided', status: 'completed', stage: 'completed', revision: 1, spec, materialIndex: 0, sectionIndex: 1, usedModelCalls: 0, usedSearchQueries: 0, elapsedMs: 0, owner: 'TEST_ONLY', expectedDocumentHash: current.document.contentHash, questions: [], notes: [], issues: [], onlineSources: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    const writing = join(workspacePath, '.scholarflow/writing'); await mkdir(join(writing, 'tasks'), { recursive: true })
    await writeFile(join(writing, 'requirements.json'), JSON.stringify({ schemaVersion: 1, projectId: current.ledger.projectId, spec }))
    await writeFile(join(writing, 'tasks', task.id + '.json'), JSON.stringify(task)); await writeFile(join(writing, 'current.json'), JSON.stringify({ projectId: current.ledger.projectId, taskId: task.id }))
    await rpc('scholarflow.v1/project.repairSessionRegistration', { request: { context: { ...context, projectId: current.ledger.projectId } } })
    await writeFile(join(root, 'fixture.json'), JSON.stringify({ context }))
    await page.reload(); await dismiss()
  }
  await nav.waitFor(); await reviewButton.click()
  const sf = async (method, data = {}) => { const current = await snapshot(io); return rpc('scholarflow.v1/' + method, { request: { context: { ...context, projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision }, ...data } }) }
  await page.route('**/api/**', async route => {
    const payload = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined
    const method = payload?.method, request = payload?.payload?.args?.request
    let data, response, envelope
    const modelMethod = ['scholarflow.v1/review.prepareModel', 'scholarflow.v1/review.prepareFix', 'scholarflow.v1/review.startModel', 'scholarflow.v1/runs.start', 'scholarflow.v1/runs.cancel'].includes(method)
    if (!modelMethod) { await route.continue(); return }
    response = await route.fetch(); envelope = await response.json()
    const outcome = await applicationResult(async () => {
    if (method === 'scholarflow.v1/review.prepareModel') {
      const plan = await prepareModelReview(io, { context: request.context, assessmentScope: 'cross-section' }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' })
      plans.set(plan.id, { type: 'review', plan }); data = { planId: plan.id, planHash: plan.contentHash, runId: plan.snapshot.runId }
    } else if (method === 'scholarflow.v1/review.prepareFix') {
      const current = await snapshot(io), plan = await prepareGeneration(io, { context: request.context, instruction: request.instruction, reviewIssueId: request.issueId, selection: issueFixSelection(current, request.issueId) }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' })
      plans.set(plan.id, { type: 'fix', plan }); data = { planId: plan.id, planHash: plan.contentHash, runId: plan.snapshot.runId }
    } else if (method === 'scholarflow.v1/review.startModel' || method === 'scholarflow.v1/runs.start') {
      const entry = plans.get(request.planId); assert(entry); assert.equal(request.planHash, entry.plan.contentHash)
      controller.current = new AbortController()
      const model = async call => {
        calls.push({ kind: entry.type, runId: call.runId })
        if (mode === 'hold-review' && entry.type === 'review') { held?.(); await new Promise(done => { releaseReview = done }) }
        if (mode === 'fail-review' && entry.type === 'review') throw new Error('TEST_ONLY model unavailable')
        if (mode === 'stop-second' && entry.type === 'fix' && entry.plan.input.selection.sourceText.includes(secondParagraph)) { held?.(); return waitForAbort(call.signal) }
        return entry.type === 'review' ? json(improvementOutput(entry.plan)) : json({ replacementText: improvementText(entry.plan.input.selection.sourceText), limitations: ['TEST_ONLY fixed response'] })
      }
      try { data = entry.type === 'review' ? await executeModelReview(io, entry.plan, owner, controller.current.signal, model, () => true) : await executeGeneration(io, entry.plan, owner, controller.current.signal, model, () => true)
        runStateSchema.parse(data.run) } finally { controller.current = undefined }
    } else if (method === 'scholarflow.v1/runs.cancel') { controller.current?.abort('cancelled'); data = { requested: true } }
    return data
    })
    envelope.result = { ok: true, value: outcome }
    await route.fulfill({ response, json: envelope })
  })
  if (['all', 'apply'].includes(phase)) {
    await expect(assistant.getByRole('button', { name: '一键检查并完善', exact: true })).toBeEnabled()
    assert.equal(await page.locator('.sf-paper-actions').count(), 0); assert.equal(await assistant.getByRole('button').count(), 1)
    await expect(page.locator('.sf-review-details')).not.toHaveAttribute('open', '')
    assert(!/规则检查|项检查已通过|运行详情/.test(await assistant.innerText()))
    await page.locator('#sf-panel-Review').screenshot({ path: join(root, 'default.png') }); await record('default screen has one AI action, short purpose and collapsed details without duplicate navigation')
    const before = await snapshot(io)
    await assistant.getByRole('button', { name: '一键检查并完善', exact: true }).click()
    await expect(assistant.locator('.sf-review-edit')).toHaveCount(2, { timeout: 20000 })
    await expect(assistant.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled({ timeout: 20000 })
    await expect(reviewButton).toContainText('有修改建议'); assert(!/未完成|sf_TEST_ONLY/.test(await assistant.innerText()))
    assert.equal(calls.filter(row => row.kind === 'review').length, 1); assert.equal(calls.filter(row => row.kind === 'fix').length, 2)
    assert.equal((await snapshot(io)).document.contentHash, before.document.contentHash)
    assert.equal(await assistant.getByRole('button').filter({ hasText: '一键检查' }).count(), 0)
    await page.locator('#sf-panel-Review').screenshot({ path: join(root, 'preview.png') }); await record('one click uses true completed-with-issues, groups three findings into two previews and keeps manuscript unchanged')
    const count = calls.length
    await page.reload(); await dismiss(); await reviewButton.click(); await expect(assistant.locator('.sf-review-edit')).toHaveCount(2); assert.equal(calls.length, count)
    await assistant.getByRole('button', { name: '采用修改', exact: true }).click(); await expect(assistant).toContainText('修改已采用并保存', { timeout: 20000 })
    const after = await snapshot(io), proposals = Object.values(after.ledger.proposalStates).filter(row => row.state === 'accepted')
    assert.equal(after.document.text, improvementText(before.document.text).replace(secondParagraph, improvementText(secondParagraph)))
    assert.equal(new Set(proposals.map(row => row.acceptedRevisionId)).size, 1); assert(after.document.text.includes('[@sf_TEST_ONLY]'))
    await record('reload restores previews without model replay; one UI adoption saves both paragraphs atomically')
  }
  if (['all', 'keep'].includes(phase)) {
    const before = await snapshot(io), savedText = `# TEST_ONLY 文稿\n\n${firstParagraph}\n\n${secondParagraph}\n`
    await sf('document.saveManual', { text: savedText, baseHash: before.document.contentHash }); await page.reload(); await dismiss(); await reviewButton.click()
    await assistant.getByRole('button', { name: '一键检查并完善', exact: true }).click(); await expect(assistant.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled({ timeout: 20000 })
    // These confirmations wait for two host round trips plus a refresh. The matcher default of 5s was
    // the only wait in this script below the 20s used everywhere else, and it flaked under load.
    await assistant.getByRole('button', { name: '保留原稿', exact: true }).click(); await expect(assistant).toContainText('已保留原稿', { timeout: 20000 }); assert.equal((await snapshot(io)).document.text, savedText)
    await record('keep original rejects the batch with one action and does not write manuscript')
  }
  if (['all', 'stop'].includes(phase)) {
    mode = 'stop-second'; const blocked = new Promise(done => { held = done })
    await assistant.getByRole('button', { name: '一键检查并完善', exact: true }).click(); await blocked
    await assistant.getByRole('button', { name: '停止', exact: true }).click(); await expect(assistant.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled({ timeout: 20000 }); await expect(assistant.locator('.sf-review-edit')).toHaveCount(1)
    const count = calls.length
    await page.reload(); await dismiss(); await reviewButton.click(); await expect(assistant.locator('.sf-review-edit')).toHaveCount(1); assert.equal(calls.length, count)
    mode = 'normal'; await assistant.getByRole('button', { name: '继续完善', exact: true }).click(); await expect(assistant.locator('.sf-review-edit')).toHaveCount(2); await expect(assistant.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled({ timeout: 20000 })
    assert.equal(calls.length, count + 1, 'Continue generates only the missing paragraph')
    await assistant.getByRole('button', { name: '保留原稿', exact: true }).click(); await expect(assistant).toContainText('已保留原稿', { timeout: 20000 })
    await record('stop cancels real core signal, retains a preview, reload is quiet and continue skips completed work')
  }
  if (phase === 'continue') {
    await expect(assistant.locator('.sf-review-edit')).toHaveCount(1)
    assert.equal(calls.length, 0)
    await assistant.getByRole('button', { name: '继续完善', exact: true }).click()
    await expect(assistant.locator('.sf-review-edit')).toHaveCount(2, { timeout: 20000 })
    await expect(assistant.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled()
    assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'fix')
    await assistant.getByRole('button', { name: '保留原稿', exact: true }).click(); await expect(assistant).toContainText('已保留原稿', { timeout: 20000 })
    await expect(assistant.getByRole('button', { name: '一键检查并完善', exact: true })).toBeEnabled()
    await record('a stopped core run restores its saved preview, continues only the missing paragraph and clears transient read failures')
  }
  if (phase === 'guard') {
    const before = await snapshot(io)
    await assistant.getByRole('button', { name: '一键检查并完善', exact: true }).click()
    await expect(assistant.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled({ timeout: 20000 })
    const ranges = await assistant.locator('.sf-review-after .sf-prose').allTextContents()
    assert(ranges[0].includes('第一段') && ranges[1].includes('第二段'))
    await page.locator('.sf-paper-project').evaluate(node => { node.style.width = '390px'; node.style.flex = 'none' })
    assert(await assistant.evaluate(node => node.scrollWidth <= node.clientWidth + 1))
    const columns = await assistant.locator('.sf-review-edit').first().evaluate(node => getComputedStyle(node).gridTemplateColumns)
    assert(!columns.includes(' '))
    await page.locator('#sf-panel-Review').screenshot({ path: join(root, 'preview-narrow.png') })
    await page.locator('.sf-paper-project').evaluate(node => { node.style.width = ''; node.style.flex = '' })
    await nav.locator('[data-node="draft"]').click(); await page.locator('.sf-paper-views button').first().click()
    const source = page.locator('textarea.sf-source-input'), edited = before.document.text + '\nTEST_ONLY 未保存人工编辑。'
    await source.fill(edited); await reviewButton.click()
    await expect(assistant.getByRole('button', { name: '采用修改', exact: true })).toBeDisabled()
    await expect(assistant).toContainText('正文有新修改')
    assert.equal((await snapshot(io)).document.contentHash, before.document.contentHash)
    await nav.locator('[data-node="draft"]').click(); await expect(source).toHaveValue(edited); await source.fill(before.document.text)
    await reviewButton.click(); await assistant.getByRole('button', { name: '保留原稿', exact: true }).click(); await expect(assistant).toContainText('已保留原稿', { timeout: 20000 })
    await record('previews follow manuscript order, stack without overflow and cannot overwrite unsaved editing')
  }
  if (phase === 'scope') {
    const otherPath = join(root, 'Other TEST_ONLY ' + Date.now()); await mkdir(otherPath, { recursive: true })
    const workspaceId = (await rpc('workspace/create', { request: { path: otherPath } })).workspace.workspaceId
    const sessionId = (await rpc('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } })).sessionId
    const otherContext = { requestId: 'req_other_TEST_ONLY', workspaceId, sessionId }
    const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context: otherContext, input: { title: 'Other TEST_ONLY', type: 'course-paper' } } })
    await rpc('scholarflow.v1/project.initialize', { request: { context: otherContext, planId: plan.planId, planHash: plan.planHash } })
    const other = new DirectoryStore(otherPath), current = await snapshot(other)
    const spec = creationSpec.parse({ title: 'Other TEST_ONLY', type: 'course-paper', language: 'zh-CN', format: 'docx', requirements: 'TEST_ONLY 第二个项目。', targetLength: 500, materials: [], sections: [{ id: 'sec_other_TEST_ONLY', title: '正文', targetLength: 500 }], online: false, manuscriptDir: 'manuscript' })
    const task = writingTaskSchema.parse({ schemaVersion: 1, id: 'writing_other_TEST_ONLY', projectId: current.ledger.projectId, sessionId, mode: 'guided', status: 'completed', stage: 'completed', revision: 1, spec, materialIndex: 0, sectionIndex: 0, usedModelCalls: 0, usedSearchQueries: 0, elapsedMs: 0, owner: 'TEST_ONLY', expectedDocumentHash: current.document.contentHash, questions: [], notes: [], issues: [], onlineSources: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    const writing = join(otherPath, '.scholarflow/writing'); await mkdir(join(writing, 'tasks'), { recursive: true })
    await writeFile(join(writing, 'requirements.json'), JSON.stringify({ schemaVersion: 1, projectId: current.ledger.projectId, spec })); await writeFile(join(writing, 'tasks', task.id + '.json'), JSON.stringify(task)); await writeFile(join(writing, 'current.json'), JSON.stringify({ projectId: current.ledger.projectId, taskId: task.id }))
    await rpc('scholarflow.v1/project.repairSessionRegistration', { request: { context: { ...otherContext, projectId: current.ledger.projectId } } })
    await page.reload(); await dismiss(); await openSession(context); await reviewButton.click()
    mode = 'hold-review'; const begun = new Promise(done => { held = done })
    await assistant.getByRole('button', { name: '一键检查并完善', exact: true }).click(); await begun
    await openSession(otherContext); await reviewButton.click(); await expect(assistant.getByRole('button', { name: '一键检查并完善', exact: true })).toBeEnabled()
    const ended = page.waitForResponse(response => response.request().postDataJSON()?.method === 'scholarflow.v1/review.startModel')
    releaseReview(); await ended; await page.waitForTimeout(2500)
    assert.equal(calls.length, 1); await expect(assistant.locator('.sf-review-edit')).toHaveCount(0)
    await expect(page.locator('.sf-paper-title')).toHaveText('Other TEST_ONLY'); await expect(reviewButton).toContainText('待检查')
    assert.equal((await snapshot(other)).document.initialPlaceholder, true)
    await record('late real review results do not generate fixes or populate a different project')
  }
  if (['all', 'failure'].includes(phase)) {
    mode = 'fail-review'; await assistant.getByRole('button', { name: '一键检查并完善', exact: true }).click(); await expect(assistant.getByRole('button', { name: '重试', exact: true })).toBeEnabled({ timeout: 20000 }); await expect(reviewButton).toContainText('可重试')
    await record('true failed review exposes retry in the current screen and preserves rule results')
  }
  if (['all', 'layout'].includes(phase)) {
    await page.locator('.sf-paper-project').evaluate(node => { node.style.width = '390px'; node.style.flex = 'none' })
    const dimensions = await page.locator('.sf-paper-toolbar').evaluate(node => ({ available: node.clientWidth, actual: node.scrollWidth })); assert(dimensions.actual <= dimensions.available + 1); assert(await assistant.evaluate(node => node.scrollWidth <= node.clientWidth + 1))
    await page.screenshot({ path: join(root, 'narrow.png') }); await record('simple action and five-node toolbar remain usable at 390px content width', dimensions)
  }
  assert.deepEqual(errors, []); await report()
} catch (error) { await report(); await writeFile(join(root, 'failure.txt'), String(error.stack)); await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {}); await writeFile(join(root, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')); await writeFile(join(root, 'failure-detail.txt'), await assistant.textContent().catch(() => '')); throw error }
finally { await browser.close(); host.kill() }
console.log(JSON.stringify({ checks: checks.length, root, phase }))
