// AT-64 · the three paper types create, and each one restores afterwards.
//
// Full generation for all three types would cost three real reports; what AT-64 asks for is that
// each type goes through creation and comes back, and that an existing ScholarFlow project is
// recovered rather than re-initialised. Each type is therefore created and cancelled, then
// re-opened from disk in a fresh session and from a page reload, which is the same path a person
// takes when they come back to work.
//
// Usage: node --experimental-strip-types tests/e2e/paper-types-regression.mjs
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const stamp = String(Date.now())
const testHome = resolve('.dsh-tmp/paper-types-home', stamp)
const profile = join(testHome, 'profiles/scholarflow-types')
const roots = resolve('.dsh-tmp/paper-types-workspaces', stamp)
const outDir = resolve('.dsh-tmp/paper-types-run', stamp)
const port = 19800 + (Number(stamp.slice(-3)) % 150)
const TYPES = [['course-paper', '课程论文'], ['literature-review', '文献综述'], ['research-paper', '研究论文']]

await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(roots, { recursive: true })
await mkdir(outDir, { recursive: true })
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-types', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { const { symlink } = await import('node:fs/promises'); await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const rows = []
const record = (name, ok, detail) => {
  rows.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name} — ${detail}${String.fromCharCode(10)}`)
}
class StopRun extends Error {}
const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-types', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const finish = async code => {
  await writeFile(join(outDir, 'paper-types.json'), JSON.stringify(rows, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
  process.stdout.write(`journal: ${join(outDir, 'paper-types.json')}` + String.fromCharCode(10))
  process.exitCode = code
  throw new StopRun()
}

const specOf = (type, title) => ({ title, type, language: 'zh-CN', format: 'markdown',
  requirements: `TEST_ONLY ${type} 创建与恢复回归。`, requirementSources: [], materials: [], online: false, targetLength: 2000,
  countingPolicy: { scope: 'body', includeAbstract: false, algorithmVersion: 1 },
  sections: [{ id: 'section_1', title: '第一节', purpose: '', targetLength: 2000, allocationMode: 'auto' }],
  manuscriptDir: 'manuscript', overrides: [] })

try {
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Host boot timed out')), 60000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timer); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const clientErrors = []
  page.on('pageerror', error => clientErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') clientErrors.push(message.text()) })
  page.setDefaultTimeout(25000)
  await page.goto(url)
  await page.waitForTimeout(1500)
  for (const [matcher, label] of [[/^预览版说明/, '继续'], [/^添加一个 API Key/, '稍后配置']]) {
    const dialogs = page.getByRole('dialog')
    if (await dialogs.count() && matcher.test(await dialogs.first().innerText().catch(() => '')))
      await dialogs.first().getByRole('button', { name: label, exact: true }).click().catch(() => undefined)
    await page.waitForTimeout(700)
  }
  const rpc = (method, args) => page.evaluate(async ({ method, args }) => {
    const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    const value = JSON.parse(await response.text())?.result?.value
    // Plugin remotes answer with an application envelope; unwrap it so callers see the payload.
    return value?.ok === false ? { error: value.error } : (value?.data ?? value)
  }, { method, args })

  for (const [type, label] of TYPES) {
    const root = join(roots, type)
    await mkdir(root, { recursive: true })
    const workspaceId = (await rpc('workspace/create', { request: { path: root } }))?.workspace?.workspaceId
    const base = { requestId: `req_${type}_${Date.now()}`, workspaceId, sessionId: (await rpc('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } }))?.sessionId }
    const plan = await rpc('scholarflow.v1/creation.prepare', { request: { context: base, spec: specOf(type, `${label} TEST_ONLY`) } })
    record(`AT-64 ${label} prepare 结果`, Boolean(plan?.planId), JSON.stringify(plan).slice(0, 220))
    const started = await rpc('scholarflow.v1/creation.start', { request: { context: base, planId: plan?.planId, planHash: plan?.planHash } })
    record(`AT-64 ${label} 创建`, Boolean(started?.taskId), 'task=' + String(started?.taskId) + ' project=' + String(started?.projectId))
    if (!started?.taskId) continue
    const scoped = { ...base, projectId: started.projectId }
    const task = (await rpc('scholarflow.v1/writingTask.inspect', { request: { context: scoped } }))?.task
    record(`AT-64 ${label} 任务已登记`, Boolean(task), 'status=' + String(task?.status) + ' stage=' + String(task?.stage))
    // Cancelled so no generation is paid for; what is under test is creation and recovery.
    await rpc('scholarflow.v1/writingTask.action', { request: { context: scoped, taskId: started.taskId, action: 'cancel' } })
    await page.waitForTimeout(800)

    // Restore: a different conversation in the same workspace has to find the project on disk.
    const fresh = (await rpc('session/create', { request: { workspaceId, agentPreset: 'scholarflow' } }))?.sessionId
    const inspected = await rpc('scholarflow.v1/project.inspect', { request: { context: { ...base, sessionId: fresh } } })
    record(`AT-64 ${label} 冷恢复读到同一项目`,
      inspected?.initialized === true && inspected?.binding?.projectId === started.projectId && inspected?.config?.project?.type === type,
      JSON.stringify({ initialized: inspected?.initialized, projectId: String(inspected?.binding?.projectId).slice(0, 16),
        type: inspected?.config?.project?.type, same: inspected?.binding?.projectId === started.projectId }))
    const document = await rpc('scholarflow.v1/document.read', { request: { context: { ...base, sessionId: fresh, projectId: started.projectId } } })
    record(`AT-64 ${label} 恢复后正文可读`, typeof document?.document?.text === 'string' && document.document.text.length > 0,
      'chars=' + String(document?.document?.text?.length ?? 0))
    const files = await readdir(join(root, '.scholarflow/writing')).catch(() => [])
    record(`AT-64 ${label} 落盘文件存在`, files.length > 0, 'writing/=' + JSON.stringify(files.slice(0, 4)))
  }

  // An existing project must come back rather than be initialised again: this one already has a
  // draft from the assignment run, and re-initialising it would replace that draft.
  const existing = join(roots, 'course-paper')
  const before = existsSync(join(existing, '.scholarflow/project.yaml')) ? (await stat(join(existing, '.scholarflow/project.yaml'))).mtimeMs : undefined
  await page.reload()
  await page.waitForTimeout(2500)
  const after = existsSync(join(existing, '.scholarflow/project.yaml')) ? (await stat(join(existing, '.scholarflow/project.yaml'))).mtimeMs : undefined
  record('AT-64 重新加载不改写已落盘项目', before !== undefined && before === after,
    'config.yaml mtime 不变=' + (before === after))
  record('AT-64 回归期间无客户端错误', clientErrors.length === 0, clientErrors.slice(0, 3).join(' | ') || 'none')
  await finish(rows.some(row => !row.ok) ? 1 : 0)
} catch (error) {
  if (!(error instanceof StopRun)) {
    record('run', false, error?.message ?? String(error))
    try { await finish(1) } catch { /* StopRun */ }
  }
}
