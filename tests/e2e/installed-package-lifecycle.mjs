// Actual installed-runtime package lifecycle, confined to a fresh TEST_ONLY home.
// No credentials, user's profile, or user's projects are modified.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { chromium } from '@playwright/test'
import { digest } from '../../src/core/store/files.ts'

const packagePath = resolve(process.argv.find(arg => arg.startsWith('--package='))?.slice(10) ?? '.dsh-tmp/release/dsh-scholarflow-1.0.0.tgz')
const packageRelative = relative(resolve('.dsh-tmp/release'), packagePath)
assert.ok(!isAbsolute(packageRelative) && packageRelative.split(/[\\/]/u).every(part => part !== '..'))
await readFile(packagePath)
const root = resolve('.dsh-tmp/package-lifecycle', String(Date.now())), testHome = join(root, 'home')
const profileName = 'scholarflow-package-test', profile = join(testHome, 'profiles', profileName)
const projectRoot = join(root, 'TEST_ONLY 中文论文')
await mkdir(profile, { recursive: true }); await mkdir(projectRoot, { recursive: true })
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-package-TEST_ONLY', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await writeFile(join(projectRoot, '原始材料.txt'), 'TEST_ONLY 原资料，安装与卸载都不能改写。\r\n')
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness'), executable = join(install, 'DeepSeek Harness.exe')
const env = { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let host, page
async function command(args) {
  const child = spawn(executable, ['--expose-internals', join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    'plugin', '--profile', profileName, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.resume(); child.stderr.resume()
  const code = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', done) })
  assert.equal(code, 0, 'Installed DSH package operation failed; private package-manager log retained in TEST_ONLY home')
}
async function start() {
  host = spawn(executable, ['--expose-internals', join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
    profileName, '--no-open', '--port', '19351'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  host.stderr.resume()
  const url = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Lifecycle Host boot timed out')), 30000)
    let output = ''
    host.stdout.on('data', chunk => {
      output = (output + chunk).slice(-100000)
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/u)
      if (match) { clearTimeout(timer); done(match[1]) }
    })
    host.once('error', fail); host.once('exit', code => { clearTimeout(timer); fail(new Error(`Lifecycle Host exited ${code}`)) })
  })
  page = await (await browser.newContext({ viewport: { width: 1400, height: 960 } })).newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', () => { throw new Error('Lifecycle client error; authenticated address omitted') })
  try { await page.goto(url) } catch { throw new Error('Lifecycle navigation failed; authenticated address omitted') }
  await page.waitForTimeout(800)
  for (const name of ['继续', '稍后配置']) {
    const button = page.getByRole('dialog').getByRole('button', { name, exact: true })
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(800) }
  }
}
async function stop() {
  await page?.context().close(); page = undefined
  if (host?.exitCode === null) { const done = new Promise(resolve => host.once('exit', resolve)); host.kill(); await done }
}
async function rpc(method, args) {
  return page.evaluate(async ({ method, args }) => {
    const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()).result
  }, { method, args })
}
async function tree(directory, prefix = '') {
  const rows = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Fixture project must not follow links')
    const name = prefix + entry.name
    if (entry.isDirectory()) rows.push(...await tree(join(directory, entry.name), `${name}/`))
    else { assert.ok(entry.isFile()); rows.push([name, digest(await readFile(join(directory, entry.name)))]) }
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]))
}
try {
  const original = await tree(projectRoot)
  await command(['add', packagePath])
  assert.deepEqual(await tree(projectRoot), original)
  const manifest = JSON.parse(await readFile(join(profile, 'node_modules/dsh-scholarflow/package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-scholarflow')
  await readFile(join(profile, 'node_modules/dsh-scholarflow/docs/compatibility.md'))
  await start()
  await page.locator('button[aria-label="ScholarFlow"]').click()
  await page.getByRole('status').filter({ hasText: '已连接 Host' }).waitFor()
  const workspace = await rpc('workspace/create', { request: { path: projectRoot } })
  assert.equal(workspace.ok, true)
  const session = await rpc('session/create', { request: { workspaceId: workspace.value.workspace.workspaceId, agentPreset: 'scholarflow' } })
  assert.equal(session.ok, true)
  const context = { requestId: 'req_TEST_ONLY_lifecycle', workspaceId: workspace.value.workspace.workspaceId, sessionId: session.value.sessionId }
  const preview = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'TEST_ONLY 安装包项目', type: 'course-paper' } } })
  assert.equal(preview.value.ok, true)
  const initialized = await rpc('scholarflow.v1/project.initialize', { request: { context, planId: preview.value.data.planId, planHash: preview.value.data.planHash } })
  assert.equal(initialized.value.ok, true)
  const beforeUninstall = await tree(projectRoot)
  await stop(); await command(['remove', 'dsh-scholarflow'])
  assert.deepEqual(await tree(projectRoot), beforeUninstall)
  const after = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  assert.ok(!after.dependencies?.['dsh-scholarflow'])
  assert.ok(!after.dsh.profile.bundles.includes('dsh-scholarflow'))
  await start()
  assert.equal(await page.locator('button[aria-label="ScholarFlow"]').count(), 0)
  assert.deepEqual(await tree(projectRoot), beforeUninstall)
  await writeFile(resolve('.dsh-tmp/package-lifecycle-latest.json'), JSON.stringify({ date: new Date().toISOString(), testOnly: true,
    installedTarball: true, nativeClientBoot: true, pluginRemoved: true, postRemovalNativeBoot: true, preservedProjectFiles: beforeUninstall.length,
    allProjectBytesUnchanged: true, originalMaterialsUnchanged: true, packageHash: digest(await readFile(packagePath)) }, null, 2))
  console.log('PASS actual tarball install, native client boot, uninstall and unchanged complete project tree')
} finally { await stop(); await browser.close() }
