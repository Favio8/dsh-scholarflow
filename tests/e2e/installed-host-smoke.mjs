// Opt-in, real installed Host smoke; no model requests and no desktop profile edits.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { prepareInit } from '../../src/core/project/project.ts'
import { commit } from '../../src/core/store/transactions.ts'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const fixture = resolve('.dsh-tmp/G0 中文工作区 TEST_ONLY')
await mkdir(fixture, { recursive: true })
const testHome = resolve('.dsh-tmp/g0-home')
const profile = join(testHome, 'profiles/scholarflow-g0')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-g0-TEST_ONLY', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (e) { if (e.code !== 'EEXIST') throw e }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let child, page, originalType
async function start(mode) {
  child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals', join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'), 'scholarflow-g0', '--no-open', '--port', '19348'], {
    env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', SCHOLARFLOW_G0_VERIFY: '1', DSH_PERMISSION_MODE: mode },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await new Promise((resolveURL, reject) => {
    const timeout = setTimeout(() => reject(new Error('G0 Host boot timed out')), 30000)
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timeout); resolveURL(match[1]) }
    })
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`G0 Host exited ${code}`)) })
  })
  page = await browser.newPage({ viewport: { width: 1500, height: 960 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url)
  await page.waitForTimeout(800)
  const dialogs = page.getByRole('dialog')
  if (await dialogs.count() && (await dialogs.first().innerText()).startsWith('预览版说明'))
    await dialogs.first().getByRole('button', { name: '继续', exact: true }).click()
  await page.waitForTimeout(800)
  if (await dialogs.count() && (await dialogs.first().innerText()).startsWith('添加一个 API Key'))
    await dialogs.first().getByRole('button', { name: '稍后配置', exact: true }).click()
  await page.locator('button[aria-label="ScholarFlow"]').click({ timeout: 20000 })
  await page.getByRole('status').filter({ hasText: '已连接 Host' }).waitFor({ timeout: 15000 })
  return errors
}
async function rpc(method, args = {}) {
  return page.evaluate(async ({ method, args }) => {
    const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`)
    return (await response.json()).result
  }, { method, args })
}
async function stop() {
  await page?.close()
  if (child && child.exitCode === null) {
    const exited = new Promise(done => child.once('exit', done))
    child.kill(); await exited
  }
}
try {
  let errors = await start('workspace-write')
  const diagnostics = await rpc('scholarflow.v1/diagnostics')
  assert.equal(diagnostics.ok, true, JSON.stringify(diagnostics))
  const settings = diagnostics.value.settings[0]
  assert.ok(settings, 'volatile Config must project into real Host settings')
  originalType = settings.value.defaultProjectType
  const settingsWrite = await rpc('settings/update', { ns: 'scholarflow', patch: { defaultProjectType: 'literature-review' }, expectedRevision: settings.revision })
  assert.equal(settingsWrite.ok, true, JSON.stringify(settingsWrite))
  const workspace = await rpc('workspace/create', { request: { path: fixture } })
  assert.equal(workspace.ok, true, JSON.stringify(workspace))
  assert.equal(resolve(workspace.value.workspace.path), fixture)
  assert.ok(workspace.value.workspace.workspaceId)
  const session = await rpc('session/create', { request: { workspaceId: workspace.value.workspace.workspaceId, agentPreset: 'scholarflow' } })
  assert.equal(session.ok, true, JSON.stringify(session))
  const sessionId = session.value.sessionId
  const verification = await rpc('scholarflow.v1/verifyGateway', { request: { sessionId } })
  assert.equal(verification.ok, true, JSON.stringify(verification))
  assert.equal(resolve(verification.value.root), fixture, JSON.stringify(verification.value))
  assert.equal(verification.value.recovered, true)
  assert.deepEqual(verification.value.allowedTools, [], 'ScholarFlow must not inherit shell / arbitrary fs tools')
  const ordinary = await rpc('session/create', { request: { workspaceId: workspace.value.workspace.workspaceId, agentPreset: 'standard' } })
  assert.equal(ordinary.ok, true, JSON.stringify(ordinary))
  const ordinaryTools = await rpc('scholarflow.v1/verifyGateway', { request: { sessionId: ordinary.value.sessionId } })
  assert.equal(ordinaryTools.ok, true, JSON.stringify(ordinaryTools))
  assert.ok(ordinaryTools.value.allowedTools.length > 0, 'ordinary modes retain their tools')
  const bytes = await readFile(join(fixture, verification.value.relativePath), 'utf8')
  assert.match(bytes, /authorized filesystem/)
  const projectRoot = resolve(`.dsh-tmp/M1 中文论文 TEST_ONLY ${Date.now()}`)
  await mkdir(projectRoot, { recursive: true })
  await writeFile(join(projectRoot, '原始材料.txt'), 'TEST_ONLY raw source: never overwrite this file.\r\n')
  const projectWorkspace = await rpc('workspace/create', { request: { path: projectRoot } })
  assert.equal(projectWorkspace.ok, true)
  await page.locator('.sf-project').getByRole('combobox', { name: 'DSH 工作区', exact: true }).selectOption(projectWorkspace.value.workspace.workspaceId)
  await page.getByRole('button', { name: '新建 ScholarFlow 会话', exact: true }).click()
  await page.getByText(`当前工作区：${projectWorkspace.value.workspace.title} · 尚未初始化`, { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '项目标题', exact: true }).fill('TEST_ONLY 原始资料保护项目')
  await page.getByRole('button', { name: '预览初始化计划', exact: true }).click()
  await page.getByRole('dialog', { name: '初始化确认' }).waitFor()
  await assert.rejects(stat(join(projectRoot, '.scholarflow')), { code: 'ENOENT' })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await assert.rejects(stat(join(projectRoot, '.scholarflow')), { code: 'ENOENT' })
  await page.getByRole('button', { name: '预览初始化计划', exact: true }).click()
  await page.getByRole('button', { name: '确认初始化', exact: true }).click()
  await page.getByText('项目已保存', { exact: false }).waitFor({ timeout: 15000 })
  assert.equal(await readFile(join(projectRoot, '原始材料.txt'), 'utf8'), 'TEST_ONLY raw source: never overwrite this file.\r\n')
  const projectConfig = await readFile(join(projectRoot, '.scholarflow/project.yaml'), 'utf8')
  const projectLedger = JSON.parse(await readFile(join(projectRoot, '.scholarflow/data/ledger.json'), 'utf8'))
  assert.ok(projectConfig.includes(projectLedger.projectId))
  const second = await rpc('session/create', { request: { workspaceId: projectWorkspace.value.workspace.workspaceId, agentPreset: 'scholarflow' } })
  const secondInspect = await rpc('scholarflow.v1/project.inspect', { request: { context: { requestId: 'req_TEST_ONLY', workspaceId: projectWorkspace.value.workspace.workspaceId, sessionId: second.value.sessionId, projectId: projectLedger.projectId } } })
  assert.equal(secondInspect.ok, true)
  assert.equal(secondInspect.value.ok, true, JSON.stringify(secondInspect.value))
  assert.equal(secondInspect.value.data.ledger.projectId, projectLedger.projectId)
  const mismatch = await rpc('scholarflow.v1/project.inspect', { request: { context: { requestId: 'req_TEST_ONLY_mismatch', workspaceId: projectWorkspace.value.workspace.workspaceId, sessionId, projectId: projectLedger.projectId } } })
  assert.equal(mismatch.value.ok, false)
  assert.equal(mismatch.value.error.code, 'SESSION_BINDING_CHANGED')
  // Reproduce an interrupted initialization using a TEST_ONLY durable journal,
  // then recover through the actual authenticated UI and sandboxed Host writer.
  const recoveryRoot = resolve(`.dsh-tmp/M1 中断恢复 TEST_ONLY ${Date.now()}`)
  await mkdir(recoveryRoot, { recursive: true })
  await writeFile(join(recoveryRoot, '原始资料.txt'), 'TEST_ONLY 原始资料保持只读\r\n')
  const crashed = new MemoryStore()
  const crashPlan = await prepareInit(crashed, { title: 'TEST_ONLY 待恢复项目', type: 'research-paper', manuscriptDir: '写作成果' })
  await assert.rejects(commit(crashed, crashPlan.files.map(file => ({ path: file.path, before: undefined, after: file.text })), point => {
    if (point === 'journal-published') throw new Error('TEST_ONLY simulated interruption')
  }))
  for (const [path, file] of crashed.files) {
    await mkdir(join(recoveryRoot, path, '..'), { recursive: true })
    await writeFile(join(recoveryRoot, path), file.text)
  }
  const recoveryWorkspace = await rpc('workspace/create', { request: { path: recoveryRoot } })
  await page.locator('.sf-project').getByRole('combobox', { name: 'DSH 工作区', exact: true }).selectOption(recoveryWorkspace.value.workspace.workspaceId)
  await page.getByRole('button', { name: '新建 ScholarFlow 会话', exact: true }).click()
  await page.getByRole('heading', { name: '检测到未完成的项目事务', exact: true }).waitFor()
  await assert.rejects(stat(join(recoveryRoot, '写作成果/paper.md')), { code: 'ENOENT' })
  await page.getByRole('button', { name: '确认恢复已记录事务', exact: true }).click()
  await page.getByText('项目已保存', { exact: false }).waitFor({ timeout: 15000 })
  const recoveredLedger = JSON.parse(await readFile(join(recoveryRoot, '.scholarflow/data/ledger.json'), 'utf8'))
  assert.equal(recoveredLedger.projectId, crashPlan.config.project.id)
  assert.equal(await readFile(join(recoveryRoot, '原始资料.txt'), 'utf8'), 'TEST_ONLY 原始资料保持只读\r\n')
  await page.locator('.sf-app').first().screenshot({ path: '.dsh-tmp/g0-three-columns.png' })
  assert.deepEqual(errors, [])
  await stop()
  errors = await start('read-only')
  const restored = await rpc('scholarflow.v1/diagnostics')
  assert.equal(restored.value.settings[0].value.defaultProjectType, 'literature-review')
  const cold = await rpc('scholarflow.v1/project.inspect', { request: { context: { requestId: 'req_TEST_ONLY_cold', workspaceId: projectWorkspace.value.workspace.workspaceId, sessionId: second.value.sessionId, projectId: projectLedger.projectId } } })
  assert.equal(cold.value.ok, true, JSON.stringify(cold.value))
  assert.equal(cold.value.data.ledger.projectId, projectLedger.projectId)
  const readOnlySession = await rpc('session/create', { request: { workspaceId: workspace.value.workspace.workspaceId, agentPreset: 'scholarflow' } })
  assert.equal(readOnlySession.ok, true, JSON.stringify(readOnlySession))
  const denied = await rpc('scholarflow.v1/verifyGateway', { request: { sessionId: readOnlySession.value.sessionId } })
  assert.equal(denied.ok, false)
  assert.match(denied.error.message, /read-only/)
  const reset = await rpc('settings/update', { ns: 'scholarflow', patch: { defaultProjectType: originalType }, expectedRevision: restored.value.settings[0].revision })
  assert.equal(reset.ok, true)
  assert.deepEqual(errors, [])
  await writeFile('.dsh-tmp/g0-smoke.json', JSON.stringify({ fixture: 'TEST_ONLY', installed: '0.2.0-rc.2',
    settingsProjection: true, settingsPersistAcrossRestart: true, chineseWorkspaceNoGit: true,
    scopedSessionCreated: true, sandboxedWriteRead: true, readOnlyDenial: true,
    nativeUiInitPreviewCancel: true, nativeUiInitConfirm: true, originalSourceBytesPreserved: true,
    twoSessionProjectRestore: true, coldProjectBindingRestore: true, mismatchedBindingRejected: true,
    nativeUiInterruptedInitRecovery: true,
    clientErrors: errors, desktopProfileTouched: false }, null, 2))
  console.log('Real DSH G0 smoke passed; evidence: .dsh-tmp/g0-smoke.json')
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: '.dsh-tmp/host-smoke-failure.png' })
    console.log('TEST_ONLY plugin status:', await page.locator('.sf-project').innerText().catch(() => 'not mounted'))
  }
  throw error
} finally { await stop(); await browser.close() }
