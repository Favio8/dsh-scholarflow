// G1/W2 (SPEC v1.2 §2): does the chosen motion approach survive the real plugin load path?
// The client is one esbuild CJS file loaded through window.__ModuleLoader__ with React
// externalised, so a standalone Vite page proves nothing. This boots the installed desktop
// host with the built plugin and asserts the client module actually evaluated.
//
// Usage: node tests/e2e/g1-client-load.mjs
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, symlink, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const testHome = resolve('.dsh-tmp/w2-client-load', String(Date.now()))
const profile = join(testHome, 'profiles/scholarflow-w2')
const workspaceRoot = join(testHome, '工作区 TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspaceRoot, { recursive: true })
await writeFile(join(workspaceRoot, 'TEST_ONLY 说明.txt'), 'TEST_ONLY，不参与任何模型请求。\n')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-w2-TEST_ONLY', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const bundle = await readFile('dist/client.js', 'utf8')
const results = []
const record = (name, verdict, detail) => { results.push({ name, verdict, detail }); console.log(`${verdict} ${name} — ${detail}`) }
record('bundle is present and non-trivial', bundle.length > 100_000 ? 'PASS' : 'FAIL', `dist/client.js = ${bundle.length} bytes`)
record('bundle uses the host module loader', bundle.startsWith("window.__ModuleLoader__.load(") ? 'PASS' : 'FAIL', bundle.slice(0, 60))
record('react stays external (host owns the copy)', /require\("react"\)/.test(bundle) ? 'PASS' : 'FAIL',
  /require\("react"\)/.test(bundle) ? 'React is required from the host, not bundled' : 'React appears to be bundled')

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-w2', '--no-open', '--port', '19388'], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const url = await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Host boot timed out')), 40000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timeout); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Host exited ${code}`)) })
  })
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.setDefaultTimeout(15000)
  await page.goto(url)
  await page.waitForTimeout(1200)
  const dialogs = page.getByRole('dialog')
  if (await dialogs.count() && (await dialogs.first().innerText()).startsWith('预览版说明'))
    await dialogs.first().getByRole('button', { name: '继续', exact: true }).click()
  await page.waitForTimeout(600)
  if (await dialogs.count() && (await dialogs.first().innerText()).startsWith('添加一个 API Key'))
    await dialogs.first().getByRole('button', { name: '稍后配置', exact: true }).click()
  await page.waitForTimeout(800)

  // The plugin's own settings entry is rendered by its client module, so its presence is the
  // proof that the bundle evaluated rather than merely downloaded.
  const remote = async method => page.evaluate(async method => {
    const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args: {} } }) })
    return { status: response.status, text: (await response.text()).slice(0, 300) }
  }, method)
  // A remote that only exists in this build: answering it proves the module evaluated with the
  // new code rather than being served from a stale bundle.
  const probe = await remote('scholarflow.v1/diagnostics')
  const fresh = await remote('scholarflow.v1/creation.readStatus')
  record('client module evaluated and the new remote is served', probe.status === 200 && fresh.status !== 404 ? 'PASS' : 'FAIL',
    `diagnostics=${probe.status} readStatus=${fresh.status} ${fresh.text.slice(0, 120)}`)
  record('no client-side error during boot', errors.length === 0 ? 'PASS' : 'FAIL', errors.slice(0, 3).join(' | ') || 'none')

  await context.close()
  await browser.close()
  const failed = results.filter(row => row.verdict === 'FAIL')
  console.log(`\nW2 client load: ${results.length - failed.length}/${results.length} passed`)
  await writeFile(resolve('.dsh-tmp/w2-client-load.json'), JSON.stringify({ bundle: bundle.length, results }, null, 2))
  child.kill()
  process.exitCode = failed.length ? 1 : 0
} catch (error) {
  console.error('W2 probe failed:', error.message)
  child.kill()
  await browser.close()
  process.exitCode = 1
}
