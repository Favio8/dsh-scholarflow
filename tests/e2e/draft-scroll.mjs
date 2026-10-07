// Real wheel input against the installed DSH Host, with an isolated profile and a long
// TEST_ONLY manuscript. No model calls and no changes to the user's assignment or profile.
// Usage: node tests/e2e/draft-scroll.mjs
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/draft-scroll', String(Date.now()))
const profile = join(root, 'profiles/scroll-test')
const workspacePath = join(root, 'Scroll TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspacePath, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
const host = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scroll-test', '--no-open', '--port', '19393'], {
  env: { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write', ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const url = new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Host boot timed out')), 30000)
  let output = ''
  host.stdout.on('data', chunk => {
    output += chunk.toString()
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timer); done(match[1]) }
  })
  host.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
})
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const rows = [], errors = []
let page
const record = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`) }
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(await url)
  await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor({ timeout: 45000 })
  const dismissOnboarding = async () => {
    await page.waitForTimeout(800)
    for (let attempt = 0; attempt < 3; attempt++) {
      const dialog = page.getByRole('dialog').first()
      if (!await dialog.count()) break
      const text = await dialog.innerText()
      if (text.startsWith('预览版说明')) await dialog.getByRole('button', { name: '继续', exact: true }).click()
      else if (text.startsWith('添加一个 API Key')) await dialog.getByRole('button', { name: '稍后配置', exact: true }).click()
      else break
      await page.waitForTimeout(700)
    }
  }
  await dismissOnboarding()
  const rpc = (method, args) => page.evaluate(async ({ method, args }) => {
    const response = await fetch('api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    const result = (await response.json()).result
    if (!result.ok || result.value?.ok === false) throw new Error(JSON.stringify(result.error ?? result.value.error))
    return result.value?.data ?? result.value
  }, { method, args })
  const workspaceId = (await rpc('workspace/create', { request: { path: workspacePath } })).workspace.workspaceId
  // A blank session created only through RPC is hidden from the native sidebar. Use the
  // visible native entry so the host retains it and restores it on reload.
  await page.reload()
  await dismissOnboarding()
  await page.locator(`[data-row-key="workspace:${workspaceId}"]`).hover()
  const [created] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.method === 'session/create'),
    page.locator('button[aria-label*="Scroll TEST_ONLY"][aria-label*="中新建会话"]').click()
  ])
  const sessionId = (await created.json()).result.value.sessionId
  await page.locator(`[data-row-key="session:${sessionId}"][aria-selected="true"]`).waitFor()
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
  await page.locator('[class*="_item_"]').filter({ hasText: /^ScholarFlow/ }).click()
  await page.locator('.sf-wizard').waitFor()
  assert.equal(await page.locator('.sf-project').getAttribute('data-sf-session-id'), sessionId)
  console.log('Setup: ScholarFlow fixture session is open')
  const context = { requestId: 'req_scroll_TEST_ONLY', workspaceId, sessionId }
  const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'Scroll TEST_ONLY', type: 'course-paper' } } })
  await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
  const project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  const manuscript = '# Scroll TEST_ONLY\n\n' + Array.from({ length: 120 }, (_, i) =>
    `第 ${i + 1} 段：这是用于验证滚轮的测试正文。保留真实编辑器与预览布局，不调用模型。\n\n`).join('')
  await rpc('scholarflow.v1/document.saveManual', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision },
    text: manuscript, baseHash: project.document.contentHash } })
  await page.reload()
  await dismissOnboarding()
  await page.locator('.sf-middle-column').waitFor()

  const geometry = () => page.locator('.sf-middle-column').evaluate(el => ({
    height: el.clientHeight, scrollHeight: el.scrollHeight, bottom: el.getBoundingClientRect().bottom, viewport: innerHeight,
    ancestors: [...(function* () { for (let node = el; node && !node.classList.contains('sf-native-workspace'); node = node.parentElement) yield node })()]
      .map(node => ({ class: node.className, height: node.clientHeight, scrollHeight: node.scrollHeight, display: getComputedStyle(node).display }))
  }))
  const dimensions = await geometry()
  record('middle column fits the visible viewport', dimensions.height > 100 && dimensions.bottom <= dimensions.viewport + 1, dimensions)

  const wheel = async (selector, name) => {
    const element = page.locator(selector)
    const before = await element.evaluate(el => {
      el.scrollTop = 0
      const rect = el.getBoundingClientRect()
      return { height: el.clientHeight, scrollHeight: el.scrollHeight, top: rect.top, bottom: rect.bottom,
        x: rect.left + rect.width / 2, y: Math.min(rect.bottom - 30, innerHeight / 2), scrollTop: el.scrollTop }
    })
    // Coordinates stay inside the visible viewport even when the broken layout is thousands
    // of pixels tall. Calling locator.hover would scroll ancestors and mask the actual bug.
    await page.mouse.move(before.x, Math.max(before.top + 20, before.y))
    await page.mouse.wheel(0, 550)
    await expect.poll(() => element.evaluate(el => el.scrollTop), { timeout: 2500 }).toBeGreaterThan(0).catch(() => undefined)
    const down = await element.evaluate(el => el.scrollTop)
    await page.mouse.wheel(0, -300)
    if (down > 0) await expect.poll(() => element.evaluate(el => el.scrollTop), { timeout: 2500 }).toBeLessThan(down).catch(() => undefined)
    const up = await element.evaluate(el => el.scrollTop)
    record(name, before.scrollHeight > before.height && down > 0 && up < down, { ...before, down, up })
  }
  const verifyModes = async suffix => {
    for (const [mode, label] of [['edit', '编辑'], ['preview', '预览'], ['split', '分屏']]) {
      await page.locator('.sf-paper-views').getByRole('button', { name: label, exact: true }).click()
      await page.locator(`.sf-editor-grid[data-view="${mode}"]`).waitFor()
      if (mode !== 'preview') await wheel('.sf-source-input', `${suffix} ${label} source wheel down/up`)
      if (mode !== 'edit') await wheel('.sf-paper-scroll', `${suffix} ${label} preview wheel down/up`)
    }
  }
  await verifyModes('resting')

  // Local instructions open without any model call. Exercise the same scrollers while the
  // bottom input is present, including narrow/short windows and reduced motion.
  await page.locator('.sf-source-input').evaluate(el => { el.scrollTop = 0 })
  // A genuine scroll closes the old selection menu. Let that event finish before selecting
  // a new range, rather than dispatching a mouseup in the same frame as the scroll reset.
  await page.waitForTimeout(100)
  await page.locator('.sf-source-input').evaluate(el => {
    el.focus(); el.setSelectionRange(26, 41)
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.locator('.sf-selection-menu').getByRole('button', { name: '润色', exact: true }).click()
  await page.locator('.sf-overlay').waitFor()
  await page.waitForTimeout(300)
  const overlayGeometry = async () => page.evaluate(() => {
    const column = document.querySelector('.sf-middle-column').getBoundingClientRect()
    const overlay = document.querySelector('.sf-overlay').getBoundingClientRect()
    return { column: column.toJSON(), overlay: overlay.toJSON() }
  })
  const checkOverlay = async label => {
    const { column, overlay } = await overlayGeometry()
    record(label, overlay.height > 30 && overlay.bottom <= column.bottom + 1 && overlay.bottom >= column.bottom - 20 &&
      overlay.top >= column.top && overlay.left >= column.left && overlay.right <= column.right, { column, overlay })
  }
  await checkOverlay('overlay is visible at the middle column bottom')
  await verifyModes('overlay open')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1000, height: 650 })
  await checkOverlay('overlay stays at the bottom after resize with reduced motion')
  await verifyModes('narrow reduced motion')
  const preview = page.locator('.sf-paper-scroll')
  const rect = await preview.boundingBox()
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.wheel(0, 100000)
  await expect.poll(() => preview.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop), { timeout: 2500 }).toBeLessThan(2)
  const last = await page.evaluate(() => ({
    lastBottom: document.querySelector('.sf-paper-page .sf-prose p:last-child').getBoundingClientRect().bottom,
    overlayTop: document.querySelector('.sf-overlay').getBoundingClientRect().top
  }))
  record('last paragraph can scroll clear of the overlay', last.lastBottom <= last.overlayTop, last)
  await page.locator('.sf-overlay input').click()
  await page.locator('.sf-overlay input').fill('TEST_ONLY 保留事实')
  record('overlay instruction input remains clickable', await page.locator('.sf-overlay input').inputValue() === 'TEST_ONLY 保留事实', {})
  const source = await page.locator('.sf-source-input').inputValue()
  record('scrolling and view switches leave the manuscript unchanged', source === manuscript, { characters: source.length })
  record('no client exceptions', errors.length === 0, errors)
  await page.screenshot({ path: join(root, 'workbench.png') })
  assert.ok(rows.every(row => row.ok), 'Scroll acceptance failed; see the journal')
} catch (error) {
  record('run', false, error.message)
  await page?.screenshot({ path: join(root, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await writeFile(join(root, 'journal.json'), JSON.stringify(rows, null, 2))
  console.log('Journal:', join(root, 'journal.json'))
  host.kill()
  await browser.close()
}
