// Exercise native mouse navigation with the Desktop's bundle set and isolated data.
import assert from 'node:assert/strict'
import { chromium, _electron as electron } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/native-navigation', String(Date.now()))
const nativeDesktop = process.argv.includes('--desktop')
const profile = join(root, 'profiles', nativeDesktop ? 'desktop' : 'navigation-test')
const workspacePath = join(root, 'Navigation TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspacePath, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
if (nativeDesktop) await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 19389\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
const host = nativeDesktop ? undefined : spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'navigation-test', '--no-open', '--port', '19389'], {
  env: { ...process.env, DSH_HOME: root, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let boot = ''
const url = nativeDesktop ? undefined : new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Host boot timed out')), 30000)
  host.stdout.on('data', chunk => {
    boot += chunk.toString()
    const match = boot.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timer); done(match[1]) }
  })
  host.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
})
let desktopApp, browser, page
if (nativeDesktop) {
  const env = { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write' }
  delete env.ELECTRON_RUN_AS_NODE
  desktopApp = await electron.launch({ executablePath: join(install, 'DeepSeek Harness.exe'), args: [`--user-data-dir=${join(root, 'electron')}`], env, timeout: 30000 })
  page = await desktopApp.firstWindow()
  console.log('Desktop page:', page.url())
} else {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
}
page.setDefaultTimeout(12000)
const errors = [], requests = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('request', request => {
  if (request.method() !== 'POST') return
  const payload = request.postDataJSON()
  if (/session\/create|agentPresets\/select|agent-presets\/select/.test(payload?.method ?? '')) requests.push(payload.method)
})
const rpc = (method, args = {}) => page.evaluate(async ({ method, args }) => {
  const result = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
  return result.json()
}, { method, args })
const dismiss = async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const dialog = page.getByRole('dialog').first()
    if (!await dialog.count()) break
    const body = await dialog.innerText()
    if (body.startsWith('预览版说明')) await dialog.getByRole('button', { name: '继续', exact: true }).click()
    else if (body.startsWith('添加一个 API Key')) await dialog.getByRole('button', { name: '稍后配置', exact: true }).click()
    else break
    await page.waitForTimeout(400)
  }
}
const createFrom = async button => {
  const finished = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.method === 'session/create')
  await button.click()
  const body = await (await finished).json()
  assert.equal(body.result?.ok, true, JSON.stringify(body))
  return body.result.value.sessionId
}
try {
  if (!nativeDesktop) await page.goto(await url)
  await page.locator('button[aria-label="新建会话"]').first().waitFor({ timeout: 45000 })
  if (nativeDesktop) await desktopApp.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.hide()
  })
  errors.length = 0
  await dismiss()
  const created = await rpc('workspace/create', { request: { path: workspacePath } })
  assert.ok(created.result?.ok, JSON.stringify(created))
  await page.reload()
  await page.locator('button[aria-label="新建会话"]').first().waitFor({ timeout: 45000 })
  await dismiss()
  const workspaceNew = page.locator('button[aria-label*="Navigation TEST_ONLY"][aria-label*="中新建会话"]')
  const workspaceRow = page.locator('[role="treeitem"][data-row-key^="workspace:"]').filter({ hasText: 'Navigation TEST_ONLY' })
  await workspaceRow.hover()
  await createFrom(workspaceNew)
  console.log('PASS workspace native new button completes session/create')
  const globalNew = page.getByRole('button', { name: '新建会话', exact: true }).filter({ hasText: '新会话' })
  await createFrom(globalNew)
  console.log('PASS global native new button completes session/create')
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
  await page.locator('[class*="_item_"]').filter({ hasText: /^ScholarFlow/ }).click()
  await page.locator('.sf-wizard').waitFor()
  console.log('PASS real mode click opens creation wizard')
  const sessionId = await page.locator('.sf-project').getAttribute('data-sf-session-id')
  await page.locator('#sf-field-title').fill('TEST_ONLY retained wizard draft')
  await page.screenshot({ path: join(root, 'wizard.png') })
  await workspaceRow.hover()
  assert.equal(await createFrom(workspaceNew), sessionId, 'DSH reuses its current empty session')
  await page.locator('.sf-wizard').waitFor()
  assert.equal(await page.locator('#sf-field-title').inputValue(), 'TEST_ONLY retained wizard draft')
  await createFrom(globalNew)
  await page.locator('.sf-wizard').waitFor()
  console.log('PASS both native new buttons complete while ScholarFlow is active')
  // DSH hides non-current blank sessions. A global panel keeps the same session
  // retained, so its sidebar row remains available for this restoration check.
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.locator('.sf-wizard').waitFor({ state: 'detached' })
  await page.locator(`[data-row-key="session:${sessionId}"]`).click()
  await page.locator('.sf-wizard').waitFor()
  assert.equal(await page.locator('#sf-field-title').inputValue(), 'TEST_ONLY retained wizard draft')
  console.log('PASS reopening the same blank session restores the wizard and its draft')
  await page.reload()
  await page.locator('.sf-wizard').waitFor({ timeout: 30000 })
  assert.equal(await page.locator('#sf-field-title').inputValue(), 'TEST_ONLY retained wizard draft')
  console.log('PASS reloading an existing ScholarFlow session restores the wizard')
  // Fresh isolated profiles masked the production crash: the user's existing
  // localStorage contained drafts written before requirementSources was added.
  await page.evaluate(sessionId => {
    const key = Object.keys(localStorage).find(key => key.startsWith('scholarflow:creation:') && key.endsWith(`:${sessionId}`))
    const saved = JSON.parse(localStorage.getItem(key))
    delete saved.spec.requirementSources
    delete saved.spec.countingPolicy
    delete saved.spec.preset
    saved.spec.sections.forEach(section => { delete section.allocationMode; delete section.allocationWeight })
    saved.step = 2
    localStorage.setItem(key, JSON.stringify(saved))
  }, sessionId)
  await page.reload()
  await page.locator('.sf-wizard').waitFor({ timeout: 30000 })
  assert.match(await page.locator('.sf-wizard-step-compact').textContent(), /第 3 步/)
  const migrated = await page.evaluate(sessionId => JSON.parse(localStorage.getItem(Object.keys(localStorage)
    .find(key => key.startsWith('scholarflow:creation:') && key.endsWith(`:${sessionId}`)))), sessionId)
  assert.equal(migrated.spec.title, 'TEST_ONLY retained wizard draft')
  assert.deepEqual(migrated.spec.requirementSources, [])
  assert.equal(migrated.spec.countingPolicy.scope, 'body')
  assert.ok(migrated.spec.sections.every(section => section.allocationMode === 'manual'))
  await workspaceRow.hover()
  await createFrom(workspaceNew)
  await createFrom(globalNew)
  await page.locator('.sf-wizard').waitFor()
  assert.equal(await page.locator('[data-slot-error="scholarflow.project"]').count(), 0)
  console.log('PASS pre-upgrade wizard draft survives reload and both native new buttons')
  const ordinaryRow = page.locator('[role="treeitem"][data-row-key^="workspace:"]').filter({ hasText: '默认工作区' })
  await ordinaryRow.hover()
  await createFrom(page.getByRole('button', { name: '在“默认工作区”中新建会话', exact: true }))
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').waitFor()
  assert.equal(await page.locator('.sf-wizard').count(), 0)
  console.log('PASS an ordinary workspace retains its native conversation surface')
  assert.deepEqual(errors, [])
} catch (error) {
  console.error('Navigation failed:', error.message)
  throw error
} finally {
  if (!page.isClosed()) await page.screenshot({ path: join(root, 'final.png') })
  console.log('Navigation requests:', requests, 'Client errors:', errors)
  console.log('Artifacts:', root)
  await writeFile(join(root, 'result.json'), JSON.stringify({ nativeDesktop, errors, requests }, null, 2))
  await browser?.close()
  await desktopApp?.close()
  if (host && host.exitCode === null) { host.kill(); await new Promise(done => host.once('exit', done)) }
}
