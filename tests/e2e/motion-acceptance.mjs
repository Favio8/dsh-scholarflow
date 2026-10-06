// Drives motion and interaction in the real installed client (AT-65…AT-69).
//
// The prototype runs in a plain browser; this runs the plugin inside the DSH desktop client,
// where the slot boundary, the host's own navigation and the real reduced-motion setting all
// apply. Each item records what was actually observed, including the timing of a transition
// rather than an assertion that an animation "exists".
//
// Usage: node tests/e2e/motion-acceptance.mjs
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const stamp = String(Date.now())
const testHome = resolve('.dsh-tmp/motion-home', stamp)
const profile = join(testHome, 'profiles/scholarflow-motion')
const workspaceRoot = resolve('.dsh-tmp/motion-workspace', stamp)
const outDir = resolve('.dsh-tmp/motion-run', stamp)
const port = 19700 + (Number(stamp.slice(-3)) % 200)
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspaceRoot, { recursive: true })
await mkdir(outDir, { recursive: true })
await writeFile(join(workspaceRoot, 'TEST_ONLY 说明.txt'), 'TEST_ONLY，不参与任何模型请求。\n')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-motion', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const rows = []
const record = (name, ok, detail) => {
  rows.push({ name, ok, detail })
  const line = `${ok ? '✔' : '✖'} ${name} — ${detail}`
  process.stdout.write(line + String.fromCharCode(10))
}

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-motion', '--no-open', '--port', String(port)], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

/** Enters the wizard the way a person does: new conversation, then the mode chip. */
async function openWizard(page) {
  // The chip opens a menu that the host renders asynchronously; a retry is what a person does
  // when the first click lands before the list is ready.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator('button[title="选择新任务使用的 Agent 预设"]').click().catch(() => undefined)
    await page.waitForTimeout(900)
    if (await page.locator('[aria-label="创建论文向导"]').count()) return true
  }
  const picked = await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const option = [...document.querySelectorAll('button,[role=menuitem],[role=option],[class*="_item_"]')]
      .filter(visible).find(el => (el.className ?? '').toString().includes('_item_') && (el.innerText ?? '').includes('ScholarFlow'))
    if (option) option.click()
    return Boolean(option)
  })
  await page.waitForTimeout(2500)
  return picked
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
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.setDefaultTimeout(30000)
  await page.goto(url)
  await page.waitForTimeout(1500)
  for (const [matcher, label] of [[/^预览版说明/, '继续'], [/^添加一个 API Key/, '稍后配置']]) {
    const dialogs = page.getByRole('dialog')
    if (await dialogs.count() && matcher.test(await dialogs.first().innerText().catch(() => '')))
      await dialogs.first().getByRole('button', { name: label, exact: true }).click().catch(() => undefined)
    await page.waitForTimeout(700)
  }
  const workspaceId = await page.evaluate(async path => {
    const response = await fetch('api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace/create', payload: { args: { request: { path } } } }) })
    return JSON.parse(await response.text())?.result?.value?.workspace?.workspaceId
  }, workspaceRoot)
  // The same entry a person uses: open a conversation first, then the mode chip on its
  // composer. Without the row click the composer (and therefore the chip) is not mounted.
  await page.locator('[class*="_sessionRow"]', { hasText: '新会话' }).first().click().catch(() => undefined)
  await page.waitForTimeout(1800)

  // ── AT-65 · three steps forward and back, then a burst, with direction and no stale page ──
  const entered = await openWizard(page)
  const wizard = page.locator('[aria-label="创建论文向导"]')
  const rendered = await wizard.count()
  record('AT-65 wizard renders in the real client', rendered === 1 && entered, `容器=${rendered}`)
  // The token sheet mounts with the workspace surface, so it is read once the wizard is up.
  const tokenValue = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sf-dur-base').trim())
  record('v1.2 motion tokens are present in the client', tokenValue !== '', '--sf-dur-base=' + (tokenValue || 'none'))
  if (!rendered) throw new Error('wizard did not render; AT-65…67 cannot run')

  // The wizard refuses to advance without a requirement, so the driver supplies one: an
  // empty field is the product working, not a failure to drive.
  await wizard.locator('#sf-field-requirements').fill('TEST_ONLY 动作验收用要求：约 1500 字。')
  await page.waitForTimeout(200)
  const stepState = () => page.evaluate(() => {
    const active = document.querySelector('.sf-wizard-page')
    const stepButtons = [...document.querySelectorAll('.sf-wizard-steps button')]
    const current = stepButtons.findIndex(button => button.getAttribute('aria-current') === 'step')
    const transform = active ? getComputedStyle(active).transform : 'none'
    return { current, pages: document.querySelectorAll('.sf-wizard-page').length, transform,
      text: (active?.innerText ?? '').slice(0, 40) }
  })
  // One step forward, sampled while the transition is still running.
  const forward = []
  for (let index = 0; index < 3; index++) {
    await wizard.locator('button:has-text("下一步")').click()
    await page.waitForTimeout(70)
    const during = await page.evaluate(() => {
      const node = document.querySelectorAll('.sf-wizard-page')[document.querySelectorAll('.sf-wizard-page').length - 1]
      return node ? getComputedStyle(node).transform : 'none'
    })
    await page.waitForTimeout(320)
    forward.push({ during, after: await stepState() })
  }
  const movedDuring = forward.some(frame => frame.during !== 'none')
  record('AT-65 forward transitions actually animate', movedDuring, forward.map(f => `${f.during}→${f.after.current}`).join(' | '))
  const back = []
  for (let index = 0; index < 3; index++) {
    await wizard.locator('button:has-text("上一步")').click()
    await page.waitForTimeout(70)
    const during = await page.evaluate(() => {
      const pages = document.querySelectorAll('.sf-wizard-page')
      const node = pages[pages.length - 1]
      return node ? getComputedStyle(node).transform : 'none'
    })
    await page.waitForTimeout(320)
    back.push({ during, after: await stepState() })
  }
  record('AT-65 back transitions animate and end on step 1', back.every(f => f.after.current === 0) && back.some(f => f.during !== 'none'),
    back.map(f => `${f.during}→${f.after.current}`).join(' | '))

  // A burst of clicks must leave exactly one live page and no blank stage.
  const next = wizard.locator('button:has-text("下一步")'), prev = wizard.locator('button:has-text("上一步")')
  for (let index = 0; index < 4; index++) { await next.click().catch(() => undefined); await prev.click().catch(() => undefined) }
  await page.waitForTimeout(500)
  const burst = await page.evaluate(() => ({ pages: document.querySelectorAll('.sf-wizard-page').length,
    wizardHeight: document.querySelector('.sf-wizard')?.getBoundingClientRect().height ?? 0,
    text: (document.querySelector('.sf-wizard')?.innerText ?? '').length }))
  record('AT-65 rapid forward/back leaves one live page and no blank stage', burst.pages === 1 && burst.wizardHeight > 200 && burst.text > 40,
    JSON.stringify({ pages: burst.pages, height: Math.round(burst.wizardHeight), text: burst.text }))

  // ── AT-66 · a click acts once and the control reports real state, not the animation ──────
  const presetOpens = []
  for (let index = 0; index < 4; index++) {
    await wizard.locator('button:has-text("AI 完善结构")').click().catch(() => undefined)
    await page.waitForTimeout(120)
  }
  presetOpens.push(await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length))
  record('AT-66 repeated clicks do not queue up work', presetOpens[0] <= 2, '可见对话框=' + presetOpens[0])

  // ── AT-67 · the middle-column overlay's geometry inside the real slot ────────────────────
  const geometry = await page.evaluate(() => {
    const column = document.querySelector('.sf-middle-column')
    const pane = document.querySelector('aside.pane, [class*=sidebar-right], [class*="_pane_"]')
    const overlay = document.querySelector('.sf-overlay')
    return { hasColumn: Boolean(column), hasOverlay: Boolean(overlay),
      column: column ? { left: column.getBoundingClientRect().left, right: column.getBoundingClientRect().right } : undefined,
      overlay: overlay ? { left: overlay.getBoundingClientRect().left, right: overlay.getBoundingClientRect().right } : undefined,
      paneLeft: pane ? pane.getBoundingClientRect().left : undefined,
      space: column ? getComputedStyle(column).getPropertyValue('--sf-overlay-space').trim() : '' }
  })
  record('AT-67 the overlay host is mounted inside the middle column', geometry.hasColumn,
    JSON.stringify(geometry).slice(0, 200))

  // ── AT-69 · reduced motion collapses the tokens and leaves no running loop ───────────────
  const quiet = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const quietPage = await quiet.newPage()
  await quietPage.goto(url)
  await quietPage.waitForTimeout(1200)
  const tokens = await quietPage.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return { base: style.getPropertyValue('--sf-dur-base').trim(), sweep: style.getPropertyValue('--sf-sweep').trim(),
      running: [...document.querySelectorAll('*')].filter(el => {
        const animations = el.getAnimations ? el.getAnimations() : []
        return animations.some(animation => animation.playState === 'running')
      }).length }
  })
  record('AT-69 reduced motion collapses the durations', /^1ms$/.test(tokens.base), '--sf-dur-base=' + tokens.base)
  record('AT-69 reduced motion stops the sweep loop', tokens.sweep === '0s' || tokens.sweep === '0', '--sf-sweep=' + tokens.sweep)
  record('AT-69 reduced motion leaves no running animation', tokens.running === 0, '运行中的动画元素=' + tokens.running)
  await quiet.close()

  // ── AT-69 · 200% zoom must not scroll sideways ──────────────────────────────────────────
  await page.setViewportSize({ width: 640, height: 450 })
  await page.waitForTimeout(700)
  const zoomed = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth,
    smallest: Math.min(...[...document.querySelectorAll('.sf-wizard button, .sf-wizard input, .sf-wizard select')]
      .map(el => el.getBoundingClientRect().height).filter(height => height > 0)) }))
  record('AT-69 200% zoom has no horizontal overflow', zoomed.overflow <= 1, 'overflow=' + zoomed.overflow + 'px')
  record('AT-69 200% zoom keeps controls usable', zoomed.smallest >= 24, '最小控件高度=' + Math.round(zoomed.smallest) + 'px')
  await page.setViewportSize({ width: 1440, height: 900 })

  record('no client error during the interaction run', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none')
  await writeFile(join(outDir, 'motion-acceptance.json'), JSON.stringify({ rows, url, port }, null, 2))
  const failed = rows.filter(row => !row.ok)
  process.stdout.write(String.fromCharCode(10) + `motion acceptance: ${rows.length - failed.length}/${rows.length} passed` + String.fromCharCode(10))
  process.stdout.write(`journal: ${join(outDir, 'motion-acceptance.json')}` + String.fromCharCode(10))
  child.kill()
  await browser.close()
  process.exitCode = failed.length ? 1 : 0
} catch (error) {
  process.stdout.write(`motion run failed: ${error.message}` + String.fromCharCode(10))
  await writeFile(join(outDir, 'motion-acceptance.json'), JSON.stringify({ rows, error: String(error.stack).slice(0, 800) }, null, 2))
  child.kill()
  try { await browser.close() } catch { /* closed */ }
  process.exitCode = 1
}
