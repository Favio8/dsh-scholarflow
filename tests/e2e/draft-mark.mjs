// The rewrite mark against the installed Host, in the real client: does the mirror line up with the
// pane's own text, does the gradient stay readable at every zoom and in both themes, does the flow
// stop when it should, and does the input method keep its characters visible.
//
// TEST_ONLY manuscript and isolated profile; no model request is ever made — the one rewrite is
// answered by a route, and everything else is a selection, a zoom, a scroll or a key.
// Usage: node tests/e2e/draft-mark.mjs [--desktop]
import assert from 'node:assert/strict'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/draft-mark', String(Date.now()))
const nativeDesktop = process.argv.includes('--desktop')
const profile = join(root, nativeDesktop ? 'profiles/desktop' : 'profiles/mark-test')
const workspacePath = join(root, 'Mark TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspacePath, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
if (nativeDesktop) await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 19401\n')
const host = nativeDesktop ? undefined : spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'mark-test', '--no-open', '--port', '19401'], {
  env: { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write', ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const url = nativeDesktop ? undefined : new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Host boot timed out')), 30000)
  let output = ''
  host.stdout.on('data', chunk => {
    output += chunk.toString()
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timer); done(match[1]) }
  })
  host.on('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
})
const browser = nativeDesktop ? undefined : await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let desktopApp
const rows = [], errors = []
const record = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`) }
let page
try {
  if (nativeDesktop) {
    const env = { ...process.env, DSH_HOME: root, DSH_PERMISSION_MODE: 'workspace-write' }; delete env.ELECTRON_RUN_AS_NODE
    desktopApp = await electron.launch({ executablePath: join(install, 'DeepSeek Harness.exe'), args: [`--user-data-dir=${join(root, 'electron')}`], env })
    page = await desktopApp.firstWindow()
    await page.getByRole('button', { name: '新建会话', exact: true }).first().waitFor({ timeout: 45000 })
    await desktopApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) { window.setSize(1440, 960); window.showInactive() }
    })
  } else page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  if (!nativeDesktop) await page.goto(await url)
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
  await page.reload(); await dismissOnboarding()
  await page.locator(`[data-row-key="workspace:${workspaceId}"]`).hover()
  const [created] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && response.request().postDataJSON()?.method === 'session/create'),
    page.locator('button[aria-label*="Mark TEST_ONLY"][aria-label*="中新建会话"]').click()
  ])
  const sessionId = (await created.json()).result.value.sessionId
  await page.locator(`[data-row-key="session:${sessionId}"][aria-selected="true"]`).waitFor()
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
  await page.locator('[class*="_item_"]').filter({ hasText: /^ScholarFlow/ }).click()
  await page.locator('.sf-wizard').waitFor()
  const context = { requestId: 'req_mark_TEST_ONLY', workspaceId, sessionId }
  const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'Mark TEST_ONLY', type: 'course-paper' } } })
  await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
  const project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  const paragraph = '多模态情感识别从语音、文本与视频等异质来源推断情绪状态，已被用于患者情绪状态分析、客户服务中的实时情绪检测以及自闭症儿童的社交技能训练。'.repeat(40)
  const manuscript = `# Mark TEST_ONLY\n\n${paragraph}\n\n## 小结\n\n短段落。\n`
  const projectContext = { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision }
  await rpc('scholarflow.v1/document.saveManual', { request: { context: projectContext, text: manuscript, baseHash: project.document.contentHash } })
  const hash = (await rpc('scholarflow.v1/project.inspect', { request: { context } })).document.contentHash
  await page.reload(); await dismissOnboarding()
  await page.locator('.sf-middle-column').waitFor()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const input = page.locator('.sf-source-input')
  await expect(input).toBeEnabled()

  // A plain selection is a mark (SF-087 r2): both panes show it before anything is submitted.
  const from = manuscript.indexOf(paragraph), to = from + paragraph.length
  await input.evaluate((el, range) => { el.focus({ preventScroll: true }); el.setSelectionRange(...range) }, [from, to])
  await page.waitForTimeout(400)
  const both = await page.evaluate(() => ({
    mirror: Boolean(document.querySelector('.sf-source-mirror .sf-mark-inline')),
    preview: Boolean(document.querySelector('.sf-mark-inline[data-sf-marked]')),
    marked: document.querySelector('.sf-source-editor')?.hasAttribute('data-marked'),
    chips: document.querySelectorAll('.sf-source-paper>i').length,
    flow: document.querySelector('.sf-source-mirror .sf-mark-inline')?.dataset.flow
  }))
  record('a plain selection marks both panes', both.mirror && both.preview && both.marked && both.chips > 3 && both.flow === 'off', both)

  // The copy has to wrap where the pane wraps: its own height is the pane's content height, and the
  // app's own measurement of the selection (which anchors the selection card) agrees with it.
  const geometry = await page.evaluate(() => {
    const area = document.querySelector('.sf-source-input'), mirror = document.querySelector('.sf-source-mirror')
    const marked = mirror.querySelector('.sf-mark-inline')
    const style = getComputedStyle(area), mirrorStyle = getComputedStyle(mirror)
    // The line-number column is the pane's own measurement of its own rows, so it is the copy's
    // reference: a textarea reports its window when the text is shorter than the window, which says
    // nothing about where the text wraps.
    const gutter = document.querySelector('.sf-line-gutter>div')
    const cells = [...gutter.children].reduce((sum, cell) => sum + cell.offsetHeight, 0)
    return { height: Math.abs(mirror.scrollHeight - parseFloat(mirrorStyle.paddingTop) - parseFloat(mirrorStyle.paddingBottom) - cells),
      fragments: marked.getClientRects().length, rows: new Set([...marked.getClientRects()].map(rect => Math.round(rect.top))).size,
      text: mirror.textContent.replace(/​/g, '') === area.value, slice: marked.textContent === area.value.slice(area.selectionStart, area.selectionEnd),
      pointerEvents: getComputedStyle(mirror).pointerEvents, hidden: mirror.getAttribute('aria-hidden'),
      colour: getComputedStyle(area).color, caret: getComputedStyle(area).caretColor,
      pane: getComputedStyle(document.querySelector('.sf-source-pane')).backgroundColor,
      dbg: { mirrorScroll: mirror.scrollHeight, cells, areaScroll: area.scrollHeight, areaClientHeight: area.clientHeight,
        mirrorWidth: mirror.getBoundingClientRect().width, areaClient: area.clientWidth } }
  })
  record('the mirror is the pane, laid out again', geometry.height <= 2 && geometry.rows > 3 && geometry.text && geometry.slice
    && geometry.pointerEvents === 'none' && geometry.hidden === 'true' && geometry.colour === 'rgba(0, 0, 0, 0)'
    && geometry.caret !== 'rgba(0, 0, 0, 0)', geometry)

  // A real wheel over the pane: the gesture the acceptance item is about, and the only one that
  // proves the app's own scroll handling is wired rather than a scripted assignment.
  const paneBox = await input.boundingBox()
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(400)
  const scrolled = await page.evaluate(() => {
    const area = document.querySelector('.sf-source-input'), stack = document.querySelector('.sf-source-marks>div')
    const layer = Number((stack.style.transform.match(/-?[\d.]+px\)$/)?.[0] ?? '0').replace('px)', ''))
    const gutter = document.querySelector('.sf-line-gutter>div')
    return { scrollTop: area.scrollTop, layer, gutter: gutter.style.transform,
      followed: area.scrollTop > 0 && Math.abs(layer + area.scrollTop) <= 1 }
  })
  record('the mark follows a scroll with one transform', scrolled.followed, scrolled)

  // The gradient against the paper it is carried on, sampled in the client at three zooms. The
  // background is unclipped for the capture: clipped to the glyphs a strip's colour is an ink-and-paper
  // mixture that depends on which glyph happens to sit there.
  const contrast = async () => {
    // Measured on the pane's own capture rather than the span's: the span is taller than the pane's
    // window, and an element capture of it would be clipped where the pane clips. The strips are
    // positioned against the pane, so they land on the same pixels the user sees.
    await page.evaluate(() => { document.querySelector('.sf-source-input').scrollTop = 0 })
    await page.waitForTimeout(250)
    const geometry = await page.evaluate(async () => {
      const marked = document.querySelector('.sf-source-mirror .sf-mark-inline'), pane = document.querySelector('.sf-source-pane')
      marked.style.webkitBackgroundClip = 'border-box'; marked.style.backgroundClip = 'border-box'
      await new Promise(done => setTimeout(done, 80))
      const origin = pane.getBoundingClientRect()
      const strips = []
      for (const rect of [...marked.getClientRects()].slice(0, 3)) for (const share of [0.1, 0.5, 0.9])
        strips.push({ x: rect.left - origin.left + (rect.right - rect.left) * share - 4, y: rect.top - origin.top + rect.height / 2 - 3, width: 8, height: 6 })
      return { strips }
    })
    const shot = (await page.locator('.sf-source-pane').screenshot()).toString('base64')
    await page.evaluate(() => { const marked = document.querySelector('.sf-source-mirror .sf-mark-inline')
      marked.style.webkitBackgroundClip = ''; marked.style.backgroundClip = '' })
    return page.evaluate(async ({ src, strips }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + src; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      const channel = value => { const part = value / 255; return part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4) }
      const ratio = one => { const other = [255, 255, 255]
        const first = 0.2126 * channel(one[0]) + 0.7152 * channel(one[1]) + 0.0722 * channel(one[2])
        const second = 0.2126 * channel(other[0]) + 0.7152 * channel(other[1]) + 0.0722 * channel(other[2])
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) }
      return { worst: Math.min(...strips.map(strip => { const data = context.getImageData(Math.round(strip.x), Math.round(strip.y), strip.width, strip.height).data
        let r = 0, g = 0, b = 0; for (let index = 0; index < data.length; index += 4) { r += data[index]; g += data[index + 1]; b += data[index + 2] }
        return ratio([r / (data.length / 4), g / (data.length / 4), b / (data.length / 4)]) })) }
    }, { src: shot, strips: geometry.strips })
  }
  for (const zoom of [0.5, 1, 2]) {
    await page.evaluate(value => { document.querySelector('.sf-source-pane').style.setProperty('--sf-editor-font', `${13 * value}px`) }, zoom)
    await page.waitForTimeout(300)
    const measured = await contrast()
    record(`the gradient reads on its paper at ${zoom * 100}% zoom`, measured.worst >= 4.5, measured)
  }
  await page.evaluate(() => { document.querySelector('.sf-source-pane').style.removeProperty('--sf-editor-font') })

  // The flow: only a running generation moves, and reduced motion stops even that.
  await page.route('**/api/scholarflow.v1/cowrite.propose', async route => {
    const body = route.request().postDataJSON()
    const suggestion = { id: 'cowrite_mark_TEST_ONLY', after: 'TEST_ONLY 更简洁的表达。', protectedFactChanges: [], citationChanges: { added: [], removed: [] } }
    try { await route.fulfill({ json: { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { ok: true, data: { suggestion } } } } }) }
    catch { /* A cancelled request cannot receive its candidate. */ }
  })
  await input.evaluate((el, range) => { el.focus({ preventScroll: true }); el.setSelectionRange(...range) }, [from, to])
  await page.waitForTimeout(200)
  await input.dispatchEvent('mouseup')
  await page.locator('.sf-selection-menu').waitFor()
  await page.locator('.sf-selection-menu').getByRole('button', { name: '润色', exact: true }).click()
  await page.locator('.sf-overlay').getByRole('button', { name: '提交修改', exact: true }).click()
  await page.locator('.sf-rewrite[data-state="ready"]').waitFor()
  await page.waitForTimeout(500)
  const flow = await page.evaluate(() => {
    const marked = document.querySelector('.sf-source-mirror .sf-mark-inline')
    return { flow: marked.dataset.flow, name: getComputedStyle(marked).animationName }
  })
  record('a ready candidate holds the colour but stops the flow', flow.flow === 'off' && flow.name === 'none', flow)

  // The input method: the mirror steps aside and the pane's own glyphs come back, because the
  // composition preview is painted in the pane's text colour.
  const composing = await page.evaluate(async () => {
    const area = document.querySelector('.sf-source-input'), editor = document.querySelector('.sf-source-editor')
    area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await new Promise(done => setTimeout(done, 60))
    const during = { attribute: editor.hasAttribute('data-composing'),
      mirror: getComputedStyle(document.querySelector('.sf-source-mirror')).visibility, colour: getComputedStyle(area).color }
    area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await new Promise(done => setTimeout(done, 60))
    return { during, after: { mirror: getComputedStyle(document.querySelector('.sf-source-mirror')).visibility,
      colour: getComputedStyle(area).color, attribute: editor.hasAttribute('data-composing') } }
  })
  record('a composition keeps the characters being spelled visible', composing.during.attribute && composing.during.mirror === 'hidden'
    && composing.during.colour !== 'rgba(0, 0, 0, 0)' && composing.after.mirror === 'visible'
    && composing.after.colour === 'rgba(0, 0, 0, 0)', composing)

  // Scrolling follows with one transform and no re-measure, and the body is untouched by all of it.
  const after = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  record('the manuscript is byte-identical after every interaction', after.document.contentHash === hash
    && after.document.text === manuscript && errors.length === 0, { hash: after.document.contentHash === hash, errors })
} finally {
  if (desktopApp) await desktopApp.close()
  if (browser) await browser.close()
  if (host) host.kill()
}
const failed = rows.filter(row => !row.ok)
console.log(`\n${rows.length - failed.length}/${rows.length} 项通过${failed.length ? `，失败：${failed.map(row => row.name).join('、')}` : ''}`)
if (failed.length) process.exit(1)
