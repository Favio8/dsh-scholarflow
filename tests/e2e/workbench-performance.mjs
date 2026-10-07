// Long-document typing, wheel, selection and overlay geometry against the installed Host.
// TEST_ONLY manuscript and isolated profile; original assignment files are unchanged.
// Only --live-visual-only starts a real model request, then cancels it to verify native lifecycle.
// Usage: node tests/e2e/workbench-performance.mjs [--desktop] [--interaction-only | --live-visual-only]
import assert from 'node:assert/strict'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/workbench-performance', String(Date.now()))
const nativeDesktop = process.argv.includes('--desktop')
const profile = join(root, nativeDesktop ? 'profiles/desktop' : 'profiles/scroll-test')
const workspacePath = join(root, 'Scroll TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(workspacePath, { recursive: true })
const desktop = JSON.parse(await readFile(join(process.env.USERPROFILE, '.dsh/profiles/desktop/package.json'), 'utf8'))
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` }, dsh: desktop.dsh }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction')
if (nativeDesktop) await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 19396\n')
if (process.argv.includes('--live-visual-only')) await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 19396\n- id: credentials\n  name: \"@deepseek-ai/dsh-credentials-local\"\n  config:\n    path: \"C:/Users/19949/.dsh/.credentials.yaml\"\n    watch: false\n')
const host = nativeDesktop ? undefined : spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scroll-test', '--no-open', '--port', '19396'], {
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
let page
const record = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`) }
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
  page.setDefaultTimeout(15000)
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
  if (process.argv.includes('--live-visual-only')) {
    await rpc('settings/update', { ns: 'ui-settings-account', patch: { step: 'done', completion: 'api-key' } })
    await page.reload(); await dismissOnboarding()
  }
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
  const manuscript = '# Scroll TEST_ONLY\n\n' + Array.from({ length: 450 }, (_, i) =>
    `第 ${i + 1} 段：这是用于验证滚轮的测试正文。保留真实编辑器与预览布局，不调用模型。\n\n`).join('')
  await rpc('scholarflow.v1/document.saveManual', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision },
    text: manuscript, baseHash: project.document.contentHash } })
  await page.reload()
  await dismissOnboarding()
  await page.locator('.sf-middle-column').waitFor()

  await page.getByRole('button',{name:'编辑',exact:true}).click()
  const area=page.locator('.sf-source-input');await area.click();await page.keyboard.press('Control+End')
  if (!process.argv.includes('--interaction-only') && !process.argv.includes('--live-visual-only')) {
  await page.evaluate(()=>{
    window.sfPerf={inputs:[],frames:[],longTasks:[]};let prev=performance.now()
    window.sfFrame=requestAnimationFrame(function tick(now){window.sfPerf.frames.push(now-prev);prev=now;window.sfFrame=requestAnimationFrame(tick)})
    document.querySelector('.sf-source-input').addEventListener('input',()=>{const t=performance.now();requestAnimationFrame(()=>window.sfPerf.inputs.push(performance.now()-t))})
    new PerformanceObserver(list=>window.sfPerf.longTasks.push(...list.getEntries().map(x=>x.duration))).observe({entryTypes:['longtask']})
  })
  const start=Date.now();await page.keyboard.type('TEST_ONLY steady typing '.repeat(31),{delay:43});const durationMs=Date.now()-start
  const measured=await page.evaluate(()=>{cancelAnimationFrame(window.sfFrame);const p=window.sfPerf,sort=p.inputs.toSorted((a,b)=>a-b);return {samples:sort.length,inputP95Ms:sort[Math.floor(sort.length*.95)],inputMaxMs:Math.max(...sort),longTasks:p.longTasks,frameOver100ms:p.frames.filter(x=>x>100).length}})
  record('30 seconds of input in a manuscript over 8000 Chinese characters',durationMs>=30000&&manuscript.match(/[\p{Script=Han}]/gu).length>=8000,{durationMs,chineseCharacters:manuscript.match(/[\p{Script=Han}]/gu).length,...measured})
  record('typing preserves all input with no client failure',(await area.inputValue()).endsWith('TEST_ONLY steady typing '.repeat(31))&&errors.length===0,{errors})
  const rect=await area.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2)
  const offsets=[];for(let i=0;i<30;i++){await page.mouse.wheel(0,-1200);await page.waitForTimeout(35);offsets.push(await area.evaluate(el=>el.scrollTop))}
  record('continuous long-document wheel input moves monotonically without an empty editor',offsets.every((x,i)=>!i||x<=offsets[i-1])&&await area.inputValue()!==''&&offsets.at(-1)<offsets[0],{from:offsets[0],to:offsets.at(-1),samples:offsets.length})
  }
  await area.evaluate(el=>{el.scrollTop=0;el.focus();el.setSelectionRange(el.value.indexOf('第 2 段'),el.value.indexOf('第 4 段'));el.dispatchEvent(new Event('select',{bubbles:true}))})
  await page.waitForTimeout(200)
  await area.dispatchEvent('mouseup')
  await expect(page.locator('.sf-selection-menu')).toBeVisible()
  const menuAction = page.locator('.sf-selection-menu button').first()
  await menuAction.focus(); await page.keyboard.press('Enter')
  await expect(page.locator('.sf-overlay')).toBeVisible()
  const scope=await page.locator('.sf-overlay-note').first().innerText()
  record('cross-paragraph selection opens an input for the actual selected range',scope.includes('第 2 段'),{scope})
  if (process.argv.includes('--live-visual-only')) {
    let calls = 0, failed = false
    page.on('requestfailed', request => { if (request.url().endsWith('/cowrite.propose')) failed = true })
    for (const preference of ['light', 'dark']) {
      await rpc('settings/update', { ns: 'ui-theme', patch: { preference } })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, preference === 'dark')
      const palette = await page.locator('.sf-overlay').evaluate(el => ({
        background: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color,
        inputText: getComputedStyle(el.querySelector('input')).color,
      }))
      const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => x / 255)
          .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
        return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
      }
      const a = luminance(palette.background), b = luminance(palette.text), c = luminance(palette.inputText)
      const contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      const inputContrast = (Math.max(a, c) + .05) / (Math.min(a, c) + .05)
      record(preference + ' native theme overlay and input contrast', contrast >= 4.5 && inputContrast >= 4.5, { ...palette, contrast, inputContrast })
    }
    // Playwright emulates page focus even when the real Electron window is hidden.
    // Disable that test-only override before measuring native visibility/focus events.
    const lifecycle = await page.context().newCDPSession(page)
    await lifecycle.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    await desktopApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.restore(); window.show() }))
    await page.locator('.sf-overlay').getByRole('button', { name: '提交', exact: true }).click()
    if (process.argv.includes('--live-visual-only')) calls = 1
    await page.locator('.sf-rewrite-sweep').waitFor()
    const animation = () => page.evaluate(() => {
      const el = document.querySelector('.sf-rewrite-sweep'), app = document.querySelector('.sf-native-workspace')
      return { hidden: document.hidden, marker: app?.dataset.sfHidden, candidate: Boolean(el),
        sweep: el && getComputedStyle(el, '::before').animationPlayState,
        spinner: el && getComputedStyle(el.querySelector('.sf-rewrite-spinner')).animationPlayState,
        roots: [...document.querySelectorAll('.sf-app')].map(el => ({ className: el.className, hidden: el.dataset.sfHidden })),
        candidateStates: [...document.querySelectorAll('.sf-rewrite')].map(el => el.dataset.state),
        messages: [...document.querySelectorAll('[role=status],[role=alert]')].map(el => el.textContent).slice(0, 10),
      }
    })
    const windows = await desktopApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => {
      window.hide(); return { visible: window.isVisible(), throttling: window.webContents.getBackgroundThrottling() }
    }))
    await page.waitForTimeout(500)
    const hidden = await animation()
    console.log('Lifecycle diagnostics', JSON.stringify({ windows, hidden, calls, failed }))
    await desktopApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.show()))
    await page.waitForTimeout(500)
    const shown = await animation()
    record('native window hiding pauses visuals while keeping the pending request', hidden.marker === 'true' && hidden.sweep === 'paused' && hidden.spinner === 'paused' && calls === 1 && !failed, { ...hidden, calls, failed })
    record('native window restoration resumes visuals without a duplicate request', shown.marker === 'false' && shown.sweep === 'running' && shown.spinner === 'running' && calls === 1 && !failed, { ...shown, calls, failed })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reduced = await page.locator('.sf-rewrite-sweep').evaluate(el => ({
      sweep: getComputedStyle(el, '::before').animationName,
      spinner: getComputedStyle(el.querySelector('.sf-rewrite-spinner')).animationName,
      transform: getComputedStyle(document.querySelector('.sf-overlay-presence')).transform,
    }))
    record('reduced motion removes continuous animations and translation', reduced.sweep === 'none' && reduced.spinner === 'none' && ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(reduced.transform), reduced)
    await page.locator('.sf-overlay').getByRole('button', { name: '停止生成', exact: true }).click()
    await page.waitForTimeout(250)
    record('stopping cancels the one pending request and leaves original text', failed && calls === 1 && await area.inputValue() === manuscript && await page.locator('.sf-rewrite-spinner').count() === 0, { failed, calls, errors })
  } else {
  const originalSession=await page.locator('.sf-project').getAttribute('data-sf-session-id')
  const togglePanel = async () => {
    const close = page.getByRole('button', { name: '收起右侧边栏', exact: true })
    if (await close.isVisible()) await close.click()
    else await page.getByRole('button', { name: '打开右侧边栏', exact: true }).click()
  }
  const paneStates=[]
  for(let i=0;i<4;i++) { await togglePanel();await page.waitForTimeout(200);paneStates.push(await page.locator('[data-sidebar-right-open]:visible').count()) }
  record('native right panel really opens and closes without changing session',paneStates.includes(0)&&paneStates.some(x=>x>0)&&originalSession===await page.locator('.sf-project').getAttribute('data-sf-session-id'),{paneStates})
  if (!paneStates.at(-1)) { await togglePanel(); await page.waitForTimeout(600) }
  const resizeInfo = await page.evaluate(() => [...document.querySelectorAll('div')]
    .filter(el => ['col-resize','ew-resize'].includes(getComputedStyle(el).cursor))
    .map(el => { const box = el.getBoundingClientRect(); return { className: el.className, x: box.x, y: box.y, width: box.width, height: box.height } })
    .filter(box => box.height > 100 && box.width < 20 && box.x > 0))
  if (resizeInfo.length) {
    const grip = resizeInfo.at(-1), widths = []
    const hit = await page.evaluate(grip => {
      const y = grip.y + grip.height / 2
      for (let offset = .5; offset < grip.width; offset++) {
        const x = grip.x + offset, target = document.elementFromPoint(x, y)
        if (target?.className === grip.className) return { x, y, className: target.className }
      }
      return { x: grip.x + .5, y, className: document.elementFromPoint(grip.x + .5, y)?.className }
    }, grip)
    await page.mouse.move(hit.x, hit.y); await page.mouse.down()
    for (let index = 0; index < 50; index++) {
      await page.mouse.move(grip.x + 80 * Math.sin(index / 6), grip.y + grip.height / 2)
      await page.waitForTimeout(100)
      widths.push(await page.locator('.sf-middle-column').evaluate(el => el.getBoundingClientRect().width))
    }
    await page.mouse.up()
    record('five-second native right panel drag follows changes without blanking editor', Math.max(...widths) - Math.min(...widths) > 40 && await area.isVisible(), { grip, hit, widths })
  } else record('five-second native right panel drag', false, { reason: 'No visible native resize grip found', resizeInfo })
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'})
  await page.evaluate(()=>document.documentElement.style.zoom='2')
  await page.waitForTimeout(200)
  const stacking = await page.evaluate(() => {
    const overlay = document.querySelector('.sf-overlay'), box = overlay.getBoundingClientRect()
    return { top: Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + 10)?.closest('.sf-overlay')),
      isolation: getComputedStyle(document.querySelector('.sf-middle-column')).isolation }
  })
  record('native fullscreen panel covers local overlays in the hidden column', stacking.isolation === 'isolate' && !stacking.top, stacking)
  await togglePanel(); await page.waitForTimeout(300)
  const geometry=await page.evaluate(()=>{const a=document.querySelector('.sf-overlay').getBoundingClientRect(),b=document.querySelector('.sf-middle-column').getBoundingClientRect();return {left:a.left,right:a.right,columnLeft:b.left,columnRight:b.right,bottom:a.bottom,viewport:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth}})
  record('200 percent zoom with reduced motion keeps the local overlay in the middle column',geometry.left>=geometry.columnLeft-1&&geometry.right<=geometry.columnRight+1&&geometry.bottom<=geometry.viewport+1&&geometry.overflow<=1,geometry)
  }
  await page.screenshot({path:join(root,'performance.png')})
  assert.ok(rows.every(row=>row.ok),'See performance journal')
} catch (error) {
  record('run', false, error.message)
  await page?.screenshot({ path: join(root, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await writeFile(join(root, 'journal.json'), JSON.stringify(rows, null, 2))
  console.log('Journal:', join(root, 'journal.json'))
  host?.kill()
  await browser?.close()
  await desktopApp?.close()
}
