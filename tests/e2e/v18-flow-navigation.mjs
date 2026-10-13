// SF-175–178: real installed Host/client, isolated TEST_ONLY project. No paid model calls.
// Only live-task/model responses are controlled; project, rules, editing and recovery are real.
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { creationSpec, writingTaskSchema } from '../../src/shared/writing-task.ts'

const resume = process.argv.find(arg => arg.startsWith('--resume='))?.slice(9)
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) ?? 'all'
const root = resume ? resolve(resume) : resolve('.dsh-tmp/v18-flow', String(Date.now()))
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
const report = async () => writeFile(join(root, `report-${phase}.json`), JSON.stringify({ checks, errors, paidModelCalls: 0, testSeams: ['live task status', 'model response'], root }, null, 2))
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
let context, task, spec, simulatedRunning = false
const nav = page.getByRole('navigation', { name: '论文流程', exact: true })
const button = id => nav.locator(`[data-node="${id}"]`)
const state = id => nav.locator(`li:has([data-node="${id}"])`)
const openSession = async ({ workspaceId, sessionId }) => {
  const workspace = page.locator(`[data-row-key="workspace:${workspaceId}"]`)
  if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
  await page.locator(`[data-row-key="session:${sessionId}"]`).click()
}
try {
  await page.goto(await url); await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor({ timeout: 45000 }); await dismiss()
  if (resume) {
    ({ context, task, spec } = JSON.parse(await readFile(join(root, 'fixture.json'), 'utf8')))
    await openSession(context)
  } else {
    const workspaceId = (await rpc('workspace/create', { request: { path: workspacePath } })).workspace.workspaceId
    await page.reload(); await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor(); await dismiss()
    await page.locator(`[data-row-key="workspace:${workspaceId}"]`).hover()
    const [created] = await Promise.all([page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.method === 'session/create'), page.locator('button[aria-label*="Flow TEST_ONLY"][aria-label*="中新建会话"]').click()])
    const sessionId = (await created.json()).result.value.sessionId
    await page.locator(`[data-row-key="session:${sessionId}"][aria-selected="true"]`).waitFor()
    await page.locator('button[title="选择新任务使用的 Agent 预设"]').click(); await page.locator('[class*="_item_"]').filter({ hasText: /^ScholarFlow/ }).click(); await page.locator('.sf-wizard').waitFor()
    context = { requestId: 'req_flow_TEST_ONLY', workspaceId, sessionId }
    const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'Flow TEST_ONLY', type: 'course-paper' } } })
    await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
    await page.reload(); await dismiss(); await nav.waitFor()
    await expect(nav.locator('[data-state="pending"]')).toHaveCount(5)
    await record('empty project keeps all five steps pending')
  }
  const inspect = () => rpc('scholarflow.v1/project.inspect', { request: { context } })
  const sf = async (method, data = {}) => { const current = await inspect(); return rpc('scholarflow.v1/' + method, { request: { context: { ...context, projectId: current.binding.projectId, expectedLedgerRevision: current.ledger.revision }, ...data } }) }
  // Model stubs have to answer without reaching for the Host: fetching the request would run the real
  // provider attempt (measured to sit for over a minute on this machine), and the connection layer
  // validates the whole envelope — status, headers and the request's own rpcId — so one cheap real call
  // supplies the skeleton and only `result` is replaced.
  let skeleton
  const answer = async (route, data) => {
    skeleton ??= await page.evaluate(async request => { const response = await fetch('api/scholarflow.v1/project.inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'scholarflow.v1/project.inspect', payload: { args: { request } } }) })
      const headers = Object.fromEntries([...response.headers.entries()].filter(([name]) => !/^(content-length|transfer-encoding|content-encoding)$/i.test(name)))
      return { status: response.status, headers, body: await response.json() } }, { context })
    const sent = route.request().postDataJSON() ?? {}
    return route.fulfill({ status: skeleton.status, headers: skeleton.headers, body: JSON.stringify({ ...skeleton.body, rpcId: sent.rpcId, method: sent.method, result: { ok: true, value: { ok: true, data } } }) })
  }
  const writing = join(workspacePath, '.scholarflow/writing')
  const saveTask = async (change) => { Object.assign(task, change); task.revision++; await writeFile(join(writing, 'tasks', task.id + '.json'), JSON.stringify(task)) }
  if (!resume) {
    let current = await inspect()
    await sf('document.saveManual', { text: '# TEST_ONLY 流程示例\n\n## 第一章\n\nTEST_ONLY 已保存正文，用于验证切页和状态。\n', baseHash: current.document.contentHash })
    current = await inspect()
    await sf('outline.confirm', { expectedOutlineVersion: current.ledger.outline.version, outline: { ...current.ledger.outline, researchQuestion: 'TEST_ONLY question', thesis: 'TEST_ONLY thesis', sections: [{ id: 'sec_TEST_ONLY', title: '第一章', purpose: 'TEST_ONLY purpose', claimIds: [], missingEvidence: [] }] } })
    current = await inspect()
    spec = creationSpec.parse({ title: 'TEST_ONLY 流程示例', type: 'course-paper', language: 'zh-CN', format: 'docx', requirements: 'TEST_ONLY 检查流程状态与跳页。', targetLength: 500, materials: [], sections: [{ id: 'sec_TEST_ONLY', title: '第一章', targetLength: 500 }], online: false, manuscriptDir: current.config.paths.manuscriptDir })
    task = writingTaskSchema.parse({ schemaVersion: 1, id: 'writing_flow_TEST_ONLY', projectId: current.binding.projectId, sessionId: context.sessionId, mode: 'first-draft', status: 'completed', stage: 'completed', revision: 1, spec, materialIndex: 0, sectionIndex: 1, usedModelCalls: 0, usedSearchQueries: 0, elapsedMs: 0, owner: 'TEST_ONLY', expectedDocumentHash: current.document.contentHash, questions: [], notes: [], issues: [], onlineSources: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    await mkdir(join(writing, 'tasks'), { recursive: true })
    await writeFile(join(writing, 'requirements.json'), JSON.stringify({ schemaVersion: 1, projectId: current.binding.projectId, spec }))
    await writeFile(join(writing, 'tasks', task.id + '.json'), JSON.stringify(task)); await writeFile(join(writing, 'current.json'), JSON.stringify({ taskId: task.id, projectId: current.binding.projectId }))
    await writeFile(join(root, 'fixture.json'), JSON.stringify({ context, task, spec }))
    await page.reload(); await dismiss()
  }
  await nav.waitFor(); await expect(state('requirements')).toHaveAttribute('data-state', 'completed')
  if (['all', 'navigation'].includes(phase)) {
    const before = await inspect(), start = mutations.length
    await button('requirements').click(); await expect(page.locator('.sf-requirements-panel')).toBeVisible(); await expect(button('requirements')).toHaveAttribute('aria-current', 'page')
    await button('materials').click(); await expect(page.locator('#sf-panel-Research')).toBeVisible()
    await button('outline').click(); await expect(page.locator('.sf-outline-panel')).toBeVisible(); await expect(button('outline')).toHaveAttribute('aria-current', 'page')
    await page.locator('.sf-outline-panel').getByRole('button', { name: '返回正文', exact: true }).click(); await expect(button('draft')).toHaveAttribute('aria-current', 'page')
    await page.locator('.sf-chapter-nav>summary').click(); await page.getByRole('button', { name: '调整章节结构', exact: true }).click(); await expect(button('outline')).toHaveAttribute('aria-current', 'page')
    await button('draft').click(); await expect(page.locator('.sf-outline-panel')).toBeHidden()
    await page.locator('.sf-paper-views button').first().click()
    const source = page.locator('textarea.sf-source-input'); await source.fill(before.document.text + '\nTEST_ONLY 未保存编辑保留。')
    for (const id of ['materials', 'outline', 'review', 'requirements', 'draft']) await button(id).click()
    await expect(source).toHaveValue(before.document.text + '\nTEST_ONLY 未保存编辑保留。')
    assert.equal((await inspect()).document.contentHash, before.document.contentHash); assert.equal(mutations.length, start)
    await record('five navigation targets, directory sync and unsaved editor survive without executing tasks')
    await source.fill(before.document.text); await page.locator('.sf-paper-views button').last().click()
    // v1.16 moved 资料 and the checks out of the more menu, leaving the three project-level entries.
    await page.locator('summary[aria-label="更多论文选项"]').click()
    const menuEntries = await page.locator('.sf-paper-menu-popover button').allTextContents()
    assert(menuEntries.includes('写作要求') && menuEntries.includes('项目设置') && menuEntries.includes('版本历史'))
    assert(!menuEntries.some(text => text === '资料' || text === 'AI检查'), 'v1.16 moved these out of the more menu')
    await page.getByRole('button', { name: '项目设置', exact: true }).click(); await expect(page.locator('#sf-panel-Settings')).toBeVisible()
    await page.locator('.sf-tool-back').getByRole('button', { name: '返回正文', exact: true }).click(); await expect(button('draft')).toHaveAttribute('aria-current', 'page')
    await button('requirements').focus(); await page.keyboard.press('Enter'); await expect(page.locator('.sf-requirements-panel')).toBeVisible()
    await record('existing navigation and keyboard use the same current-page highlight')
  }
  if (['all', 'status'].includes(phase)) {
    await page.route('**/api/scholarflow.v1/writingTask.inspect', async route => { const response = await route.fetch(), envelope = await response.json(), value = envelope.result.value.data; if (simulatedRunning && value.task) value.task.status = 'running'; await route.fulfill({ response, json: envelope }) })
    simulatedRunning = true
    for (const [stage, id] of [['research', 'materials'], ['evidence', 'materials'], ['outline', 'outline'], ['drafting', 'draft']]) {
      await saveTask({ stage, status: 'paused' }); await expect(state(id)).toHaveAttribute('data-state', 'running', { timeout: 10000 })
    }
    await button('materials').click(); await expect(button('materials')).toHaveAttribute('aria-current', 'page'); await expect(state('draft')).toHaveAttribute('data-state', 'running')
    await record('real persisted stage changes update live while browsing another page')
    simulatedRunning = false
    await saveTask({ stage: 'drafting', status: 'paused' }); await expect(button('draft')).toContainText('已暂停')
    await saveTask({ stage: 'drafting', status: 'cancelled' }); await expect(button('draft')).toContainText('已停止')
    await saveTask({ stage: 'completed', status: 'completed' }); await expect(state('draft')).toHaveAttribute('data-state', 'completed'); await expect(state('review')).not.toHaveAttribute('data-state', 'completed')
    await page.unroute('**/api/scholarflow.v1/writingTask.inspect')
    await record('pause, stop and first-draft completion remain separate from review completion')
    // v1.20 (SF-185): the same report is a pill in the work bar, so its actions live one disclosure
    // deeper. Nothing is hidden that the pill does not already announce: a problem turns the state
    // amber and says 需处理 instead of waiting behind the caret. A task persisted as running is
    // reported as interrupted once its process is gone, so the running controls use the same live
    // inspect seam this phase already relies on rather than a status the host will normalise away.
    const pill = page.locator('.sf-progress-details')
    await button('draft').click()
    await saveTask({ stage: 'drafting', status: 'paused' })
    await page.route('**/api/scholarflow.v1/writingTask.inspect', async route => { const response = await route.fetch(), envelope = await response.json(), value = envelope.result.value.data; if (value.task) value.task.status = 'running'; await route.fulfill({ response, json: envelope }) })
    await pill.locator(':scope>summary').click()
    await expect(pill.getByRole('button', { name: '暂停', exact: true })).toBeVisible({ timeout: 10000 })
    await expect(pill.getByRole('button', { name: '停止', exact: true })).toBeVisible()
    await page.unroute('**/api/scholarflow.v1/writingTask.inspect')
    await expect(pill.getByRole('button', { name: '继续生成', exact: true })).toBeVisible({ timeout: 10000 })
    await saveTask({ stage: 'completed', status: 'completed' })
    await expect(pill.locator('.sf-review-checklist')).toBeVisible({ timeout: 10000 })
    await pill.getByRole('button', { name: '运行记录', exact: true }).click()
    await expect(page.getByRole('tab', { name: '运行与恢复' })).toHaveAttribute('aria-selected', 'true')
    await record('the pill keeps pause, stop, continue, the checklist and the run history reachable')
  }
  if (['all', 'review'].includes(phase)) {
    let releaseModel, startedModel
    const modelStarted = new Promise(done => { startedModel = done })
    const heldModel = new Promise(done => { releaseModel = done })
    await page.route('**/api/scholarflow.v1/review.prepareModel', route => answer(route, { planId: 'plan_TEST_ONLY', planHash: 'sha256:' + '1'.repeat(64), runId: 'run_TEST_ONLY' }))
    await page.route('**/api/scholarflow.v1/review.startModel', async route => { startedModel(); await heldModel; const current = await sf('review.inspect'); await answer(route, { run: { status: 'completed-with-issues' }, report: { ...current.report, modelRunId: 'run_TEST_ONLY' } }) })
    // Fix suggestions are not this phase's subject, and the Host cannot generate them here (no provider
    // credential): an unstubbed attempt fails and leaves reviewActivity at 'failed', whose 可重试 label
    // would then override the report-driven 需复查 that the staleness check below is about.
    await page.route('**/api/scholarflow.v1/review.improvements', async route => { const response = await route.fetch(), envelope = await response.json(), data = envelope.result.value.data; await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: { ok: true, data: { ...data, proposals: [], groups: [] } } } } }) })
    await button('review').click(); await page.getByRole('button', { name: '一键检查并完善', exact: true }).click(); await modelStarted
    await expect(state('review')).toHaveAttribute('data-state', 'running')
    await button('materials').click(); await expect(state('review')).toHaveAttribute('data-state', 'running')
    releaseModel(); await expect(state('review')).toHaveAttribute('data-state', 'pending', { timeout: 10000 })
    // The nav follows the Host's own report (review-export.tsx:52 re-reads review.inspect whenever the
    // ledger moves), and this profile's Host never ran the model, so its report carries no modelRunId and
    // the node honestly falls back to 待检查 — the fabricated run does not get to decorate the nav. The
    // real model path is v19's subject; the staleness half below is this phase's.
    await record('checking runs in the background and the node follows the Host report, not the stub')
    await page.unroute('**/api/scholarflow.v1/review.prepareModel'); await page.unroute('**/api/scholarflow.v1/review.startModel'); await page.unroute('**/api/scholarflow.v1/review.improvements')
    await button('draft').click(); await page.locator('.sf-paper-views button').first().click()
    const source = page.locator('textarea.sf-source-input'), saved = await inspect()
    await source.fill(saved.document.text + '\nTEST_ONLY 新增内容。'); await expect(button('review')).toContainText('需复查')
    await page.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect(button('review')).toContainText('需复查'); await expect(source).toHaveValue(saved.document.text + '\nTEST_ONLY 新增内容。')
    await page.reload(); await dismiss(); await nav.waitFor(); await expect(button('review')).toContainText('需复查'); await expect(state('draft')).toHaveAttribute('data-state', 'completed')
    await record('dirty input, saved changes and cold page recovery keep review stale')
  }
  if (phase === 'scope') {
    const otherPath = join(root, 'Scope B TEST_ONLY ' + Date.now()); await mkdir(otherPath, { recursive: true })
    const workspaceId = (await rpc('workspace/create', { request: { path: otherPath } })).workspace.workspaceId
    const sessionId = (await rpc('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } })).sessionId
    const otherContext = { requestId: 'req_scope_B_TEST_ONLY', workspaceId, sessionId }
    const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context: otherContext, input: { title: 'Scope B TEST_ONLY', type: 'course-paper' } } })
    await rpc('scholarflow.v1/project.initialize', { request: { context: otherContext, planId: plan.planId, planHash: plan.planHash } })
    const other = await rpc('scholarflow.v1/project.inspect', { request: { context: otherContext } })
    const otherSpec = { ...spec, title: 'Scope B TEST_ONLY', requirements: 'TEST_ONLY 第二个项目的要求。' }
    const otherTask = writingTaskSchema.parse({ ...task, id: 'writing_scope_B_TEST_ONLY', projectId: other.binding.projectId, sessionId, spec: otherSpec, status: 'paused', stage: 'materials', expectedDocumentHash: other.document.contentHash })
    const otherWriting = join(otherPath, '.scholarflow/writing'); await mkdir(join(otherWriting, 'tasks'), { recursive: true })
    await writeFile(join(otherWriting, 'requirements.json'), JSON.stringify({ schemaVersion: 1, projectId: other.binding.projectId, spec: otherSpec }))
    await writeFile(join(otherWriting, 'tasks', otherTask.id + '.json'), JSON.stringify(otherTask)); await writeFile(join(otherWriting, 'current.json'), JSON.stringify({ taskId: otherTask.id, projectId: other.binding.projectId }))
    await rpc('scholarflow.v1/project.repairSessionRegistration', { request: { context: { ...otherContext, projectId: other.binding.projectId } } })
    await page.reload(); await dismiss(); await openSession(context); await nav.waitFor()
    let release, started
    const pending = new Promise(done => { release = done }), begun = new Promise(done => { started = done })
    await page.route('**/api/scholarflow.v1/review.prepareModel', route => answer(route, { planId: 'plan_TEST_ONLY', planHash: 'sha256:' + '1'.repeat(64), runId: 'run_TEST_ONLY' }))
    await page.route('**/api/scholarflow.v1/review.startModel', async route => { started(); const current = await sf('review.inspect'); await pending; await answer(route, { run: { status: 'failed' }, report: current.report }) })
    await button('review').click(); await page.getByRole('button', { name: '一键检查并完善', exact: true }).click(); await begun
    await openSession(otherContext)
    await expect(page.locator('.sf-paper-project')).toHaveAttribute('data-sf-session-id', sessionId)
    await expect(state('review')).toHaveAttribute('data-state', 'pending')
    await expect(state('draft')).toHaveAttribute('data-state', 'pending')
    const ended = page.waitForResponse(response => response.request().postDataJSON()?.method === 'scholarflow.v1/review.startModel')
    release(); await ended; await page.waitForTimeout(2500)
    await expect(state('review')).toHaveAttribute('data-state', 'pending')
    await expect(state('draft')).toHaveAttribute('data-state', 'pending')
    await expect(page.locator('.sf-paper-title')).toHaveText('Scope B TEST_ONLY')
    await record('late activity from the previous project cannot change a new project workflow')
  }
  if (phase === 'review-failure') {
    let outcome = 'failed'
    await page.route('**/api/scholarflow.v1/review.prepareModel', route => answer(route, { planId: 'plan_TEST_ONLY', planHash: 'sha256:' + '1'.repeat(64), runId: 'run_TEST_ONLY' }))
    await page.route('**/api/scholarflow.v1/review.startModel', async route => { const current = await sf('review.inspect'); await answer(route, { run: { status: outcome }, report: current.report }) })
    await button('review').click()
    // v1.19 replaced the standalone 检查全文 entry with one AI检查 action that becomes 重试 after a
    // failure; the point here is that the node's terminal status survives a report either way.
    // v1.19's one-action entry reports through reviewActivity, whose labels are 可重试／已暂停／已停止
    // (src/client/flow-status.ts:73) rather than the old run-status wording.
    const reviewTrigger = page.getByRole('button', { name: '一键检查并完善', exact: true }).or(page.getByRole('button', { name: '重试', exact: true }))
    for (const [status, label] of [['failed', '可重试'], ['paused', '已暂停'], ['cancelled', '已停止']]) {
      outcome = status
      await reviewTrigger.click()
      await expect(button('review')).toContainText(label)
      await expect(reviewTrigger).toBeEnabled()
    }
    await record('failed, paused and cancelled checks retain their terminal status even with a report')
  }
  if (['all', 'layout'].includes(phase)) {
    await button('draft').click(); await page.locator('.sf-paper-views button').last().click()
    // v1.20 (SF-185/SF-188): the chrome above the manuscript is two bands at every width, and the
    // five nodes scroll sideways instead of claiming a second row.
    const bands = () => page.locator('.sf-paper-project').evaluate(node => [...node.children]
      .filter(child => child.getBoundingClientRect().height > 0)
      .filter(child => !child.classList.contains('sf-paper-content') && !child.id.startsWith('sf-panel-'))
      .map(child => ({ className: child.className, height: Math.round(child.getBoundingClientRect().height) })))
    const positions = () => page.locator('.sf-paper-toolbar').evaluate(toolbar => {
      const rect = selector => { const node = toolbar.querySelector(selector); if (!node) return null
        const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, center: r.y + r.height / 2 } }
      const nav = toolbar.querySelector('.sf-flow-nav'), list = nav?.querySelector('ol')
      return { views: rect('.sf-paper-views'), flow: rect('.sf-flow-nav'), more: rect('.sf-paper-menu>summary'),
        navScroll: nav ? { client: nav.clientWidth, scroll: list.scrollWidth } : null,
        width: toolbar.clientWidth, scrollWidth: toolbar.scrollWidth } })
    const wide = await positions(); assert(wide.flow.x > wide.views.right); assert(wide.scrollWidth <= wide.width + 1)
    await page.screenshot({ path: join(root, 'flow-wide.png') })
    await page.locator('.sf-paper-project').evaluate(node => { node.style.width = '740px'; node.style.flex = 'none' })
    const narrow = await positions()
    assert(Math.abs(narrow.flow.center - narrow.views.center) < 1, 'five nodes must stay on the views row')
    assert(narrow.scrollWidth <= narrow.width + 1)
    assert(narrow.navScroll.scroll > narrow.navScroll.client, '740px has to scroll the nodes sideways')
    await expect(nav.locator('button')).toHaveCount(5); await page.screenshot({ path: join(root, 'flow-narrow.png') })
    await page.locator('.sf-paper-project').evaluate(node => { node.style.width = '390px' })
    const compact = await positions()
    assert(Math.abs(compact.flow.center - compact.views.center) < 1); assert(compact.scrollWidth <= compact.width + 1)
    await page.screenshot({ path: join(root, 'flow-compact.png') })
    await page.locator('.sf-paper-project').evaluate(node => { node.style.width = ''; node.style.flex = '' })
    const chrome = await bands(); assert.equal(chrome.length, 2, 'exactly two bands above the manuscript')
    await record('two chrome bands at every width, nodes scroll sideways, more-tools stay reachable', { wide, narrow, compact, chrome })
    // v1.20 (SF-189): the notice bar is one row instead of one band per notice. That state is
    // reachable without a model call — an external write to the manuscript is exactly what the
    // version notice reports — so the merged bar is exercised for real rather than read off the CSS.
    const manuscriptDir = join(workspacePath, (await inspect()).config.paths.manuscriptDir)
    const manuscriptName = (await readdir(manuscriptDir)).find(name => name.endsWith('.md'))
    const manuscriptPath = join(manuscriptDir, manuscriptName)
    await writeFile(manuscriptPath, (await readFile(manuscriptPath, 'utf8')) + '\nTEST_ONLY 外部写入。\n')
    await page.reload(); await dismiss(); await nav.waitFor(); await button('draft').click()
    const notices = page.locator('.sf-editor-notices')
    await expect(notices).toBeVisible({ timeout: 15000 })
    const noticeBar = await notices.evaluate(node => ({ height: Math.round(node.getBoundingClientRect().height),
      text: node.innerText.replace(/\s+/g, ' ').trim(), actions: [...node.querySelectorAll('button')].map(button => button.textContent.trim()) }))
    assert(/正文版本发生变化|有暂存编辑可恢复/.test(noticeBar.text), 'the merged bar must still state the notice')
    assert(noticeBar.actions.includes('查看与处理'), 'the merged bar must keep the notice action')
    // Three separate notice bands measured ~40px each; one shared row has to stay well inside two.
    assert(noticeBar.height <= 64, 'one notice must not grow a band of its own: ' + JSON.stringify(noticeBar))
    await record('one notice row replaces one band per notice', { noticeBar })
  }
  assert.deepEqual(errors, []); await report()
} catch (error) {
  await report(); await writeFile(join(root, 'failure.txt'), String(error.stack)); await writeFile(join(root, 'failure-errors.txt'), JSON.stringify(errors, null, 2)).catch(() => {}); await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {}); await writeFile(join(root, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')); await writeFile(join(root, 'failure-review.txt'), await page.locator('.sf-review-assistant').innerText().catch(() => '')).catch(() => {}); throw error
} finally { await browser.close(); host.kill() }
console.log(JSON.stringify({ checks: checks.length, root, phase }))
