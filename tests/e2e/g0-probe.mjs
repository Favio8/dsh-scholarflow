// G0 prototype (SPEC v1.1 §2): isolated installed Host, no model calls, no paid usage.
// Probes only what can be observed without a browser session or provider request.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, symlink, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const testHome = resolve('.dsh-tmp/g0-probe', String(Date.now()))
const profile = join(testHome, 'profiles/scholarflow-probe')
const workspaceRoot = join(testHome, '工作区 TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspaceRoot, { recursive: true })
await writeFile(join(workspaceRoot, 'TEST_ONLY 原始资料.txt'), 'TEST_ONLY original source stays unchanged.\n')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-probe-TEST_ONLY', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-probe', '--no-open', '--port', '19361'], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const results = []
const record = (name, verdict, detail) => { results.push({ name, verdict, detail }); console.log(`${verdict === 'PASS' ? '✔' : '✖'} ${name} — ${detail}`) }
let page
try {
  const url = await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Host boot timed out')), 30000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timeout); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Host exited ${code}`)) })
  })
  page = await (await browser.newContext()).newPage()
  page.setDefaultTimeout(10000)
  await page.goto(url)
  await page.waitForTimeout(800)
  const dialogs = page.getByRole('dialog')
  if (await dialogs.count() && (await dialogs.first().innerText()).startsWith('预览版说明'))
    await dialogs.first().getByRole('button', { name: '继续', exact: true }).click()
  await page.waitForTimeout(600)
  if (await dialogs.count() && (await dialogs.first().innerText()).startsWith('添加一个 API Key'))
    await dialogs.first().getByRole('button', { name: '稍后配置', exact: true }).click()
  await page.waitForTimeout(600)
  const rpc = (method, args = {}) => page.evaluate(async ({ method, args }) => {
    const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 200) } }
    return { status: response.status, body }
  }, { method, args })

  // V3a — the real wire verbs are pick/list/createDirectory on the directoryPicker
  // namespace (found in dsh-api-workspace-controller). `list` is safe to call: it either
  // lists through the browse backend or refuses with the composed capability kind, which
  // is itself the answer to "which chooser does this host actually serve?".
  const listed = await rpc('directoryPicker/list', { path: workspaceRoot })
  const listing = listed.body?.result?.value ?? listed.body?.result ?? listed.body
  record('V3a directoryPicker/list', listed.status === 200 ? 'PASS' : 'OBSERVED',
    `${listed.status} ${JSON.stringify(listing).slice(0, 260)}`)

  // V6a — selecting the mode creates a conversation but no project files.
  const workspace = await rpc('workspace/create', { request: { path: workspaceRoot } })
  const workspaceId = workspace.body?.result?.value?.workspace?.workspaceId
  if (!workspaceId) record('V6a 工作区注册', 'FAIL', JSON.stringify(workspace.body).slice(0, 200))
  else {
    const before = (await readdir(workspaceRoot)).sort()
    const created = await rpc('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } })
    const sessionId = created.body?.result?.value?.sessionId
    const after = (await readdir(workspaceRoot)).sort()
    record('V6a 选模式不创建目录', created.status === 200 && JSON.stringify(before) === JSON.stringify(after) ? 'PASS' : 'FAIL',
      `会话 ${sessionId ?? '未创建'}；工作区前后一致=${JSON.stringify(before) === JSON.stringify(after)}`)

    // V6b — opening a session inspects the project and writes nothing.
    if (sessionId) {
      const inspect = await rpc('scholarflow.v1/project.inspect', { request: { context: { requestId: 'req_TEST_ONLY', workspaceId, sessionId } } })
      const value = inspect.body?.result?.value ?? inspect.body?.result ?? inspect.body
      const stillClean = JSON.stringify(before) === JSON.stringify((await readdir(workspaceRoot)).sort())
      record('V6b 打开不重新初始化', inspect.status === 200 && value?.initialized === false && stillClean ? 'PASS' : 'FAIL',
        `initialized=${value?.initialized}；工作区仍为空=${stillClean}`)
    }
  }

  // V3b — can the picker's browse backend reach a directory outside the workspace?
  const outsideRoot = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
  const outside = await rpc('directoryPicker/list', { path: outsideRoot })
  record('V3b 选择器列工作区外目录', outside.status === 200 ? 'OBSERVED' : 'REFUSED',
    `${outside.status} ${JSON.stringify(outside.body?.result?.value ?? outside.body).slice(0, 200)}`)

  await writeFile(resolve('.dsh-tmp/g0-probe/result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
} catch (error) {
  record('probe', 'FAIL', error.message)
} finally {
  await page?.context().close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)) }
  console.log('\n隔离目录：', testHome)
}
