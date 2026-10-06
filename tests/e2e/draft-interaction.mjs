// AT-67 / AT-68 / AT-59 on the real project the assignment run already produced.
//
// The overlay, the rewrite candidate and the right pane all live in the draft workbench, so
// they need a project that exists. This drives the one from assignment-e2e.mjs rather than
// creating another, and it presses 停止 on a real in-flight model call rather than a fake one.
//
// Usage: node tests/e2e/draft-interaction.mjs <workspaceDir> <homeDir> <projectId>
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const [workspaceArg, homeArg, projectId] = process.argv.slice(2)
const workspaceRoot = resolve(workspaceArg), home = resolve(homeArg)
const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const outDir = resolve('.dsh-tmp/draft-interaction', String(Date.now()))
const port = 19900 + (Number(String(Date.now()).slice(-3)) % 90)
await mkdir(outDir, { recursive: true })

const rows = []
const record = (name, ok, detail) => {
  rows.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name} — ${detail}${String.fromCharCode(10)}`)
}
class StopRun extends Error {}
const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-assignment', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const finish = async code => {
  await writeFile(join(outDir, 'draft-interaction.json'), JSON.stringify(rows, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
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
    return JSON.parse(await response.text())?.result?.value
  }, { method, args })
  const workspaceId = (await rpc('workspace/create', { request: { path: workspaceRoot } }))?.workspace?.workspaceId
  await page.waitForTimeout(1500)
  // Open the existing project through the conversation list, the way a person returns to it.
  await page.locator('[class*="_sessionRow"]').first().click().catch(() => undefined)
  await page.waitForTimeout(1500)
  // Point the conversation at the assignment workspace. The picker renders asynchronously and
  // closes between calls, so the button and the option are clicked inside one evaluation —
  // the same sequence the interface acceptance uses.
  const switched = await page.evaluate(async name => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const button = document.querySelector('button[aria-label="选择工作区"]')
    if (!button) return { clicked: false, reason: 'no workspace button' }
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
      target.click()
      return { clicked: true, text: option.innerText.slice(0, 40) }
    }
    return { clicked: false, reason: 'option never appeared' }
  }, workspaceRoot.split(String.fromCharCode(92)).pop().split('/').pop())
  await page.waitForTimeout(2000)

  const column = page.locator('.sf-middle-column')
  let mounted = await column.count()
  if (!mounted) {
    // The project surface is behind the ScholarFlow mode; try the chip as a fallback path.
    await page.locator('button[title="选择新任务使用的 Agent 预设"]').click().catch(() => undefined)
    await page.waitForTimeout(900)
    await page.evaluate(() => {
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const option = [...document.querySelectorAll('button,[role=menuitem],[role=option],[class*="_item_"]')]
        .filter(visible).find(el => (el.className ?? '').toString().includes('_item_') && (el.innerText ?? '').includes('ScholarFlow'))
      option?.click()
    })
    await page.waitForTimeout(3000)
    mounted = await column.count()
  }
  record('draft workbench is open on the real project', mounted > 0,
    'middle columns=' + mounted + ' workspace=' + workspaceId + ' 切换=' + JSON.stringify(switched))
  if (!mounted) throw new Error('draft surface did not mount; AT-67/68/59 cannot run')

  // ── AT-67 · the overlay's geometry inside the real middle column ─────────────────────────
  await page.evaluate(() => { const area = document.querySelector('.sf-source-input'); area?.focus() })
  const box = () => page.evaluate(() => {
    const column = document.querySelector('.sf-middle-column')
    const overlay = document.querySelector('.sf-overlay')
    const scroller = document.querySelector('.sf-editor-scroll')
    const right = document.querySelector('[class*="_sidebarRight"], [class*="sidebar-right"], aside')
    return { hasColumn: Boolean(column), hasOverlay: Boolean(overlay),
      column: column ? column.getBoundingClientRect().toJSON() : undefined,
      overlay: overlay ? overlay.getBoundingClientRect().toJSON() : undefined,
      rightLeft: right ? right.getBoundingClientRect().left : undefined,
      padBottom: scroller ? parseFloat(getComputedStyle(scroller).paddingBottom) : 0,
      open: scroller?.dataset.overlayOpen }
  })

  // Open the overlay the way a user does: select text in the preview, then pick a function.
  const selectInPreview = async () => page.evaluate(() => {
    const block = document.querySelector('.sf-paper-page .sf-prose p') ?? document.querySelector('.sf-paper-page p')
    if (!block || !block.firstChild) return false
    const range = document.createRange(); range.setStart(block.firstChild, 0)
    range.setEnd(block.firstChild, Math.min(30, block.firstChild.textContent.length))
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return true
  })
  await page.locator('.sf-paper-views button, .sf-paper-toolbar button').first().click().catch(() => undefined)
  const selected = await selectInPreview()
  await page.waitForTimeout(500)
  const menuOpen = await page.locator('.sf-selection-menu').count()
  record('AT-56 选区菜单在真实客户端出现', selected && menuOpen > 0, '选中=' + selected + ' 菜单=' + menuOpen)

  const overlayBefore = await box()
  record('AT-67 浮层未打开时滚动区没有多余留白', (overlayBefore.padBottom ?? 0) === 0 && !overlayBefore.hasOverlay,
    'padBottom=' + overlayBefore.padBottom + ' overlay=' + overlayBefore.hasOverlay)

  // Choosing a function must open the overlay and call no model: only 提交 sends the request.
  await page.locator('.sf-selection-menu button').first().click().catch(() => undefined)
  await page.waitForTimeout(600)
  const afterPick = await box()
  record('AT-56 选择功能即打开底部浮层', afterPick.hasOverlay, 'overlay=' + afterPick.hasOverlay)
  record('AT-67 浮层位于中栏之内且不达右栏',
    afterPick.overlay && afterPick.column && afterPick.overlay.left >= afterPick.column.left - 1 && afterPick.overlay.right <= afterPick.column.right + 1 &&
      (afterPick.rightLeft === undefined || afterPick.overlay.right <= afterPick.rightLeft + 1),
    JSON.stringify({ overlayLeft: Math.round(afterPick.overlay?.left ?? 0), overlayRight: Math.round(afterPick.overlay?.right ?? 0),
      columnRight: Math.round(afterPick.column?.right ?? 0), rightPaneLeft: afterPick.rightLeft === undefined ? null : Math.round(afterPick.rightLeft) }))
  record('AT-67 浮层打开时滚动区获得等量留白', (afterPick.padBottom ?? 0) > 0 && afterPick.open === 'true',
    'padBottom=' + Math.round(afterPick.padBottom ?? 0) + ' open=' + afterPick.open)

  // ── AT-67 · repeated open/close, then a burst, with the geometry re-checked ──────────────
  const collapse = page.locator('.sf-overlay button:has-text("收起"), .sf-overlay-head button').first()
  for (let index = 0; index < 6; index++) {
    await collapse.click().catch(() => undefined)
    await page.waitForTimeout(90)
    await page.locator('.sf-selection-menu button').first().click().catch(() => undefined)
    await page.waitForTimeout(90)
  }
  await page.waitForTimeout(500)
  const afterToggles = await box()
  record('AT-67 反复开合后浮层仍在边界内且不残留',
    !afterToggles.hasOverlay || (afterToggles.overlay.left >= afterToggles.column.left - 1 && afterToggles.overlay.right <= afterToggles.column.right + 1),
    'hasOverlay=' + afterToggles.hasOverlay + ' padBottom=' + Math.round(afterToggles.padBottom ?? 0))

  // ── AT-68 · stop a real in-flight model call and keep the original text ─────────────────
  const before = await page.evaluate(() => document.querySelector('.sf-source-input')?.value ?? '')
  const submit = page.locator('.sf-overlay button:has-text("提交")').first()
  await submit.click().catch(() => undefined)
  const started = await page.evaluate(async () => {
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      const node = document.querySelector('.sf-rewrite')
      if (node && node.dataset.state === 'generating') return { generating: true, sweep: getComputedStyle(node.querySelector('.sf-rewrite-sweep') ?? node, '::before').animationName }
      await new Promise(done => setTimeout(done, 100))
    }
    return { generating: false }
  })
  record('AT-57 提交后真实进入生成状态', started.generating === true, JSON.stringify(started))
  const stopButton = page.locator('.sf-rewrite button:has-text("停止")').first()
  const stopped = await stopButton.click().then(() => true).catch(() => false)
  await page.waitForTimeout(1500)
  const afterStop = await page.evaluate(() => ({ state: document.querySelector('.sf-rewrite')?.dataset.state,
    sweep: document.querySelector('.sf-rewrite')?.querySelector('.sf-rewrite-sweep') ? getComputedStyle(document.querySelector('.sf-rewrite'), '::before').animationName : 'absent',
    text: document.querySelector('.sf-source-input')?.value ?? '', acceptVisible: Boolean(document.querySelector('[data-sf-accept]')) }))
  record('AT-68 停止后循环渐变停止', afterStop.state === 'stopped' && afterStop.sweep !== 'sf-sweep', JSON.stringify({ state: afterStop.state, sweep: afterStop.sweep }))
  record('AT-67 停止后正文不变、也没有可接受的候选', afterStop.text === before && afterStop.acceptVisible === false,
    '文本一致=' + (afterStop.text === before) + ' 接受按钮=' + afterStop.acceptVisible)

  // ── AT-59 · the right pane toggles without rebuilding the session ───────────────────────
  const sessionBefore = await page.evaluate(() => location.href)
  for (let index = 0; index < 4; index++) {
    await page.locator('button[title*="右"], [class*="rightToggle"], [class*="sidebarRight"] button').first().click().catch(() => undefined)
    await page.waitForTimeout(160)
  }
  await page.waitForTimeout(600)
  const afterPane = await page.evaluate(() => ({ url: location.href,
    column: document.querySelector('.sf-middle-column')?.getBoundingClientRect().toJSON(),
    overlay: document.querySelector('.sf-overlay')?.getBoundingClientRect().toJSON() }))
  record('AT-59 右栏反复开合不重建会话', afterPane.url === sessionBefore, 'url 不变=' + (afterPane.url === sessionBefore))
  record('AT-59 右栏开合后浮层边界仍然正确',
    !afterPane.overlay || afterPane.overlay.right <= afterPane.column.right + 1,
    JSON.stringify({ overlayRight: Math.round(afterPane.overlay?.right ?? 0), columnRight: Math.round(afterPane.column?.right ?? 0) }))

  record('AT-67～59 交互期间无客户端错误', clientErrors.length === 0, clientErrors.slice(0, 3).join(' | ') || 'none')
  await finish(rows.some(row => !row.ok) ? 1 : 0)
} catch (error) {
  if (!(error instanceof StopRun)) {
    record('run', false, error?.message ?? String(error))
    try { await finish(1) } catch { /* StopRun */ }
  }
}
