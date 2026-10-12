// SF-175–178: real installed Host/client, isolated TEST_ONLY project. No paid model calls.
// Only live-task/model responses are controlled; project, rules, editing and recovery are real.
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
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
  // The Host replaces the preview dialog with the key dialog asynchronously.
  // Bind each action to its own dialog rather than a live first-dialog locator.
  const preview = page.getByRole('dialog').filter({ hasText: '预览版说明' })
  const key = page.getByRole('dialog').filter({ hasText: '添加一个 API Key' })
  await page.waitForTimeout(1000)
  if (await preview.count()) await preview.getByRole('button', { name: '继续', exact: true }).click({ timeout: 30000 })
  if (await key.count() || !await nav.count()) {
    await key.getByRole('button', { name: '稍后配置', exact: true }).click({ timeout: 10000 })
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
    await page.locator('.sf-paper-actions').getByRole('button', { name: '资料', exact: true }).click(); await expect(button('materials')).toHaveAttribute('aria-current', 'page')
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
  }
  if (['all', 'review'].includes(phase)) {
    let releaseModel, startedModel
    const modelStarted = new Promise(done => { startedModel = done })
    const heldModel = new Promise(done => { releaseModel = done })
    await page.route('**/api/scholarflow.v1/review.prepareModel', async route => { const response = await route.fetch(), envelope = await response.json(); envelope.result = { ok: true, value: { ok: true, data: { planId: 'plan_TEST_ONLY', planHash: 'sha256:' + '1'.repeat(64), runId: 'run_TEST_ONLY' } } }; await route.fulfill({ response, json: envelope }) })
    await page.route('**/api/scholarflow.v1/review.startModel', async route => { startedModel(); await heldModel; const current = await sf('review.inspect'), response = await route.fetch(), envelope = await response.json(); envelope.result = { ok: true, value: { ok: true, data: { run: { status: 'completed' }, report: current.report } } }; await route.fulfill({ response, json: envelope }) })
    await button('review').click(); await page.getByRole('button', { name: '检查全文', exact: true }).click(); await modelStarted
    await expect(state('review')).toHaveAttribute('data-state', 'running')
    await button('materials').click(); await expect(state('review')).toHaveAttribute('data-state', 'running')
    releaseModel(); await expect(state('review')).toHaveAttribute('data-state', 'attention', { timeout: 10000 })
    await record('checking runs in the background and actual unresolved rule checks stay amber')
    await page.unroute('**/api/scholarflow.v1/review.prepareModel'); await page.unroute('**/api/scholarflow.v1/review.startModel')
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
    await page.route('**/api/scholarflow.v1/review.prepareModel', async route => { const response = await route.fetch(), envelope = await response.json(); envelope.result = { ok: true, value: { ok: true, data: { planId: 'plan_TEST_ONLY', planHash: 'sha256:' + '1'.repeat(64), runId: 'run_TEST_ONLY' } } }; await route.fulfill({ response, json: envelope }) })
    await page.route('**/api/scholarflow.v1/review.startModel', async route => { started(); const current = await sf('review.inspect'); await pending; const response = await route.fetch(), envelope = await response.json(); envelope.result = { ok: true, value: { ok: true, data: { run: { status: 'failed' }, report: current.report } } }; await route.fulfill({ response, json: envelope }) })
    await button('review').click(); await page.getByRole('button', { name: '检查全文', exact: true }).click(); await begun
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
    await page.route('**/api/scholarflow.v1/review.prepareModel', async route => { const response = await route.fetch(), envelope = await response.json(); envelope.result = { ok: true, value: { ok: true, data: { planId: 'plan_TEST_ONLY', planHash: 'sha256:' + '1'.repeat(64), runId: 'run_TEST_ONLY' } } }; await route.fulfill({ response, json: envelope }) })
    await page.route('**/api/scholarflow.v1/review.startModel', async route => { const current = await sf('review.inspect'), response = await route.fetch(), envelope = await response.json(); envelope.result = { ok: true, value: { ok: true, data: { run: { status: outcome }, report: current.report } } }; await route.fulfill({ response, json: envelope }) })
    await button('review').click()
    for (const [status, label] of [['failed', '未完成'], ['paused', '已暂停'], ['cancelled', '已停止']]) {
      outcome = status
      await page.getByRole('button', { name: '检查全文', exact: true }).click()
      await expect(button('review')).toContainText(label)
      await expect(page.getByRole('button', { name: '检查全文', exact: true })).toBeEnabled()
    }
    await record('failed, paused and cancelled checks retain their terminal status even with a report')
  }
  if (['all', 'layout'].includes(phase)) {
    await button('draft').click(); await page.locator('.sf-paper-views button').last().click()
    const positions = () => page.locator('.sf-paper-toolbar').evaluate(toolbar => { const rect = selector => { const r = toolbar.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, center: r.y + r.height / 2 } }; return { views: rect('.sf-paper-views'), flow: rect('.sf-flow-nav'), actions: rect('.sf-paper-actions'), more: rect('.sf-paper-menu>summary'), width: toolbar.clientWidth, scrollWidth: toolbar.scrollWidth } })
    const wide = await positions(); assert(wide.flow.x > wide.views.right && wide.flow.right <= wide.actions.x + 1); assert(Math.abs(wide.actions.center - wide.more.center) < 1); assert(wide.more.x - wide.actions.right <= 12); assert(wide.scrollWidth <= wide.width + 1)
    await page.screenshot({ path: join(root, 'flow-wide.png') })
    await page.locator('.sf-paper-project').evaluate(node => { node.style.width = '740px'; node.style.flex = 'none' })
    const narrow = await positions(); assert(narrow.flow.y > narrow.views.y); assert(narrow.scrollWidth <= narrow.width + 1); assert(Math.abs(narrow.actions.center - narrow.more.center) < 1)
    await expect(nav.locator('button')).toHaveCount(5); await page.screenshot({ path: join(root, 'flow-narrow.png') })
    await page.locator('.sf-paper-project').evaluate(node => { node.style.width = '390px' })
    const compact = await positions(); assert(compact.scrollWidth <= compact.width + 1); await page.screenshot({ path: join(root, 'flow-compact.png') })
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', '')); await page.screenshot({ path: join(root, 'flow-dark.png') })
    await record('wide inline toolbar and 740px/390px wrapped flow preserve right tools without overflow', { wide, narrow, compact })
  }
  assert.deepEqual(errors, []); await report()
} catch (error) {
  await report(); await writeFile(join(root, 'failure.txt'), String(error.stack)); await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {}); await writeFile(join(root, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')); throw error
} finally { await browser.close(); host.kill() }
console.log(JSON.stringify({ checks: checks.length, root, phase }))
