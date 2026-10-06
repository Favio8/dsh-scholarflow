// The requirement-reading chain in the real client: AT-45, AT-47, AT-48 and AT-49.
//
// A driver of its own rather than more code inside ui-acceptance.mjs, so the 55/55 acceptance
// stays untouched. It reaches the wizard the same way a person does: a conversation, then the
// mode chip. Real model calls happen only with --live-model, in which case the operator's own
// credentials are reused, because the structure step ends in one.
//
// Usage: node tests/e2e/reading-chain.mjs [--live-model]
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, symlink, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const liveModel = process.argv.includes('--live-model')
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const stamp = String(Date.now())
const testHome = resolve('.dsh-tmp/reading-home', stamp)
const profile = join(testHome, 'profiles/scholarflow-reading')
const root = join(testHome, '要求来源 TEST_ONLY')
const outDir = resolve('.dsh-tmp/reading-run', stamp)
const port = 19860 + (Number(stamp.slice(-3)) % 60)

await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(join(root, '作业要求'), { recursive: true })
await mkdir(outDir, { recursive: true })
// A mixed folder: one readable file and one the reader cannot open, so a per-member failure is
// guaranteed rather than hoped for.
await writeFile(join(root, '作业要求', '要求说明.md'), 'TEST_ONLY 要求：四页，第一页封面；中文宋体；约 1500 字。\n')
await writeFile(join(root, '作业要求', '扫描件.bin'), new Uint8Array([0, 255, 13, 10, 7, 42]))
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-reading', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
if (liveModel) await copyFile(join(process.env.USERPROFILE ?? '', '.dsh/.credentials.yaml'), join(testHome, '.credentials.yaml'))
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const rows = []
const record = (name, ok, detail) => {
  rows.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name} — ${detail}${String.fromCharCode(10)}`)
}
class StopRun extends Error {}
const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-reading', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const finish = async code => {
  await writeFile(join(outDir, 'reading-chain.json'), JSON.stringify(rows, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
  process.stdout.write(`journal: ${join(outDir, 'reading-chain.json')}${String.fromCharCode(10)}`)
  process.exitCode = code
  throw new StopRun()
}

try {
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Host boot timed out')), 60000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timer); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const clientErrors = []
  page.on('pageerror', error => clientErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') clientErrors.push(message.text()) })
  page.setDefaultTimeout(30000)
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
    return JSON.parse(await response.text())?.result?.value
  }, { method, args })
  await rpc('workspace/create', { request: { path: root } })
  await page.reload()
  await page.waitForTimeout(3000)

  // The same entry a person uses: open a conversation, point it at the workspace, then the chip.
  await page.locator('[class*="_sessionRow"]', { hasText: '新会话' }).first().click().catch(() => undefined)
  await page.waitForTimeout(1800)
  await page.evaluate(async name => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const button = document.querySelector('button[aria-label="选择工作区"]')
    if (!button) return false
    button.click()
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 120))
      const option = [...document.querySelectorAll('*')]
        .filter(el => visible(el) && el.children.length === 0 && (el.innerText ?? '').includes(name)).at(-1)
      if (!option) continue
      let target = option
      for (let up = 0; up < 4 && target.parentElement; up += 1) {
        if (target.tagName === 'BUTTON' || target.getAttribute('role') === 'menuitem' || (target.className ?? '').toString().includes('_item_')) break
        target = target.parentElement
      }
      target.click(); return true
    }
    return false
  }, root.split(String.fromCharCode(92)).pop())
  await page.waitForTimeout(2000)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.locator('[aria-label="创建论文向导"]').count()) break
    await page.locator('button[title="选择新任务使用的 Agent 预设"]').click().catch(() => undefined)
    await page.waitForTimeout(900)
    await page.evaluate(() => {
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const option = [...document.querySelectorAll('button,[role=menuitem],[role=option],[class*="_item_"]')]
        .filter(visible).find(el => (el.className ?? '').toString().includes('_item_') && (el.innerText ?? '').includes('ScholarFlow'))
      option?.click()
    })
    await page.waitForTimeout(3000)
  }
  const wizard = page.locator('[aria-label="创建论文向导"]')
  record('读取链路向导已打开', await wizard.count() === 1, '容器=' + await wizard.count())
  if (!(await wizard.count())) throw new Error('wizard did not render')

  const press = async label => page.evaluate(text => {
    const button = [...document.querySelectorAll('.sf-wizard-footer button, .sf-assignment-extract')]
      .find(el => (el.innerText ?? '').includes(text) && !el.disabled)
    if (button) button.click()
    return Boolean(button)
  }, label)
  await wizard.locator('#sf-field-requirements').fill('TEST_ONLY 原始要求文字，采用候选后必须保留。')
  await page.waitForTimeout(400)
  // Add the mixed folder as the requirement source.
  await page.evaluate(() => { const toggle = document.querySelector('.sf-picker-toggle'); toggle?.click() })
  await page.waitForTimeout(700)
  await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const folder = [...document.querySelectorAll('.sf-picker-modes button')].find(el => visible(el) && (el.innerText ?? '').trim() === '文件夹')
    folder?.click()
  })
  await page.waitForTimeout(700)
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.sf-picker-row')].find(el => (el.innerText ?? '').includes('作业要求'))
    row?.click()
  })
  await page.waitForTimeout(900)
  const sources = await page.evaluate(() => document.querySelectorAll('.sf-source-row').length)
  record('AT-48 已选要求来源但尚未读取', sources > 0 &&
    await page.evaluate(() => document.querySelectorAll('.sf-member-reads li').length === 0), '来源行=' + sources)

  // AT-45: first feedback within a second.
  const startedAt = Date.now()
  await press('整理要求')
  let feedbackMs = null
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await page.evaluate(() => Boolean(document.querySelector('.sf-long-op')))) { feedbackMs = Date.now() - startedAt; break }
    await page.waitForTimeout(25)
  }
  record('AT-45 一秒内出现运行反馈', feedbackMs !== null && feedbackMs <= 1000, '反馈延迟=' + String(feedbackMs) + 'ms')

  // AT-47: let this read run to completion, so every member has an outcome of its own.
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const settled = await page.evaluate(() => {
      const running = Boolean(document.querySelector('.sf-long-op'))
      const members = [...document.querySelectorAll('.sf-member-reads li')]
      return !running || members.some(row => row.getAttribute('data-state') === 'failed')
    })
    if (settled) break
    await page.waitForTimeout(1000)
  }
  const members = await page.evaluate(() => [...document.querySelectorAll('.sf-member-reads li')].map(row => ({
    state: row.getAttribute('data-state'), text: (row.innerText ?? '').replace(/\s+/g, ' ').slice(0, 110),
    actions: [...row.querySelectorAll('.sf-member-actions button')].map(button => button.innerText.trim()) })))
  record('AT-47 逐成员给出读取结果', members.length >= 2, JSON.stringify(members).slice(0, 260))
  const failed = members.find(row => row.state === 'failed')
  record('AT-47 失败成员标明原因并给出可执行处理', Boolean(failed) && failed.actions.length >= 2,
    failed ? JSON.stringify({ text: failed.text, actions: failed.actions }) : '没有失败成员')
  record('AT-47 失败成员不被当作已确认要求', Boolean(failed) && !/已确认/.test(failed.text), failed ? failed.text.slice(0, 60) : 'n/a')

  // AT-45: a second run, stopped deliberately, must leave no late write behind.
  const beforeStop = await page.evaluate(() => document.querySelector('#sf-field-requirements')?.value ?? '')
  await press('整理要求')
  await page.waitForTimeout(250)
  await press('停止')
  await page.waitForTimeout(2500)
  const stopped = await page.evaluate(() => ({ running: Boolean(document.querySelector('.sf-long-op')),
    requirements: document.querySelector('#sf-field-requirements')?.value ?? '' }))
  record('AT-45 停止结束运行状态', stopped.running === false, 'running=' + stopped.running)
  record('AT-45 停止后迟到响应不写入字段', stopped.requirements === beforeStop || stopped.requirements.length === beforeStop.length,
    '长度 ' + beforeStop.length + '→' + stopped.requirements.length)

  // AT-49: structuring produces a candidate that is adopted on purpose, not applied silently.
  await press('整理要求')
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const done = await page.evaluate(() => Boolean(document.querySelector('.sf-brief')) || Boolean(document.querySelector('.sf-wizard-error')))
    if (done) break
    await page.waitForTimeout(1000)
  }
  const envelope = await page.evaluate(async () => {
    const post = async (method, request) => {
      const response = await fetch('api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args: { request } } }) })
      const text = await response.text()
      try { return JSON.parse(text)?.result?.value } catch { return { raw: text.slice(0, 200) } }
    }
    const session = await post('session/list', {})
    return { sessionKeys: Object.keys(session ?? {}).slice(0, 5) }
  })
  record('AT-49 会话列表可用', true, JSON.stringify(envelope).slice(0, 160))
  const candidate = await page.evaluate(() => ({ brief: document.querySelectorAll('.sf-brief').length,
    origins: document.querySelectorAll('.sf-brief-origin').length, conflicts: document.querySelectorAll('.sf-brief-conflict').length,
    diffs: (document.querySelector('.sf-brief-diff')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 90),
    error: (document.querySelector('.sf-wizard-error')?.innerText ?? '').slice(0, 140) }))
  record('AT-49 整理要求产出候选而非直接改写', candidate.brief > 0, JSON.stringify(candidate))
  record('AT-49 候选标出每项来源', candidate.origins > 0, '来源标记=' + candidate.origins)
  const adopted = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.sf-brief-actions button')].find(el => (el.innerText ?? '').includes('全部采用'))
    if (!button) return false
    button.click(); return true
  })
  await page.waitForTimeout(1800)
  const after = await page.evaluate(() => ({ brief: document.querySelectorAll('.sf-brief').length,
    requirements: document.querySelector('#sf-field-requirements')?.value ?? '' }))
  record('AT-49 采用后候选收起且原输入保留', adopted && after.brief === 0 && after.requirements.includes('TEST_ONLY 原始要求文字'),
    '采用=' + adopted + ' 候选=' + after.brief + ' 原输入保留=' + after.requirements.includes('TEST_ONLY 原始要求文字'))
  record('AT-49 采用写入的是带标签的整理记录', /已采用的要求整理/.test(after.requirements) || !adopted,
    '含整理记录=' + /已采用的要求整理/.test(after.requirements))
  record('读取链路期间无客户端错误', clientErrors.length === 0, clientErrors.slice(0, 3).join(' | ') || 'none')
  await finish(rows.some(row => !row.ok) ? 1 : 0)
} catch (error) {
  if (!(error instanceof StopRun)) {
    record('run', false, error?.message ?? String(error))
    try { await finish(1) } catch { /* StopRun */ }
  }
}
