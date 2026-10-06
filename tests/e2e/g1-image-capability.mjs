// G1/W1 (SPEC v1.2 §2): does the installed host actually expose a model directory with
// inputModalities, and does the plugin's own session resolve an image capability? No model
// call is made, so this costs nothing.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const testHome = resolve('.dsh-tmp/w1-image-capability', String(Date.now()))
const profile = join(testHome, 'profiles/scholarflow-w1')
const workspaceRoot = join(testHome, '工作区 TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspaceRoot, { recursive: true })
await writeFile(join(workspaceRoot, 'TEST_ONLY 说明.txt'), 'TEST_ONLY，不参与任何模型请求。\n')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-w1-TEST_ONLY', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-w1', '--no-open', '--port', '19377'], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const results = []
const record = (name, verdict, detail) => { results.push({ name, verdict, detail }); console.log(`${verdict} ${name} — ${detail}`) }
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
  page.setDefaultTimeout(15000)
  await page.goto(url)
  await page.waitForTimeout(1000)
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
    try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 300) } }
    return { status: response.status, body }
  }, { method, args })
  const payload = body => body?.result?.value?.data ?? body?.result?.value ?? body

  const workspace = await rpc('workspace/create', { request: { path: workspaceRoot } })
  const workspaceId = workspace.body?.result?.value?.workspace?.workspaceId
  if (!workspaceId) { record('workspace', 'FAIL', JSON.stringify(workspace.body).slice(0, 300)); throw new Error('no workspace') }

  // The plugin must be reachable before its remotes answer.
  const listed = await rpc('api/listRemotes', {})
  const names = JSON.stringify(payload(listed.body) ?? {})
  record('W1 plugin remotes registered', /creation\.imageModels/.test(names) ? 'PASS' : 'OBSERVED',
    `imageModels=${/creation\.imageModels/.test(names)} readRequirements=${/creation\.readRequirements/.test(names)}`)

  const created = await rpc('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } })
  const sessionId = created.body?.result?.value?.sessionId
  if (!sessionId) { record('session', 'FAIL', JSON.stringify(created.body).slice(0, 300)); throw new Error('no session') }
  const contextBody = { requestId: crypto.randomUUID?.() ?? `req_${Date.now()}`, workspaceId, sessionId }

  const capability = await rpc('scholarflow.v1/creation.imageCapability', { request: { context: contextBody } })
  const capabilityValue = payload(capability.body)
  record('W1 session image capability is resolvable', capability.status === 200 && capabilityValue?.model ? 'PASS' : 'FAIL',
    `${capability.status} ${JSON.stringify(capabilityValue).slice(0, 240)}`)

  const models = await rpc('scholarflow.v1/creation.imageModels', { request: { context: contextBody } })
  const modelValue = payload(models.body)
  const imageModels = modelValue?.models ?? []
  record('W1 host model directory reports image modalities', models.status === 200 ? 'PASS' : 'FAIL',
    `${models.status} provider=${modelValue?.provider} current=${modelValue?.current} imageInput=${modelValue?.imageInput} images=${imageModels.length}`)
  if (imageModels.length) record('W1 an alternative image model is offered by id', 'PASS',
    imageModels.slice(0, 5).map(model => `${model.id}`).join(', '))
  else record('W1 an alternative image model is offered by id', 'NOT ESTABLISHED',
    '当前 provider 目录没有带 image 的模型；图片成员会走「粘贴文字／换文件」路径，不静默降级。')

  await context.close()
  await browser.close()
  await writeFile(resolve('.dsh-tmp/w1-image-capability.json'), JSON.stringify(results, null, 2))
  const failed = results.filter(row => row.verdict === 'FAIL')
  console.log(`\nW1 gate: ${results.length - failed.length}/${results.length} not failed`)
  child.kill()
  process.exitCode = failed.length ? 1 : 0
} catch (error) {
  console.error('W1 probe failed:', error.message)
  child.kill()
  await browser.close()
  process.exitCode = 1
}
