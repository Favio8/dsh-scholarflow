// Long-document typing, wheel, selection and overlay geometry against the installed Host.
// TEST_ONLY manuscript and isolated profile; original assignment files are unchanged.
// Only --live-visual-only starts a real model request, then cancels it to verify native lifecycle.
// Usage: node tests/e2e/workbench-performance.mjs [--desktop] [--interaction-only | --layout-only | --materials-only | --live-visual-only]
// Diagnostic only: add --profile-typing to collect a renderer CPU profile (not acceptance evidence).
import assert from 'node:assert/strict'
import { chromium, _electron as electron, expect } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { cpus } from 'node:os'
import { mkdir, readFile, writeFile, symlink, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { geometryInPage } from '../../scripts/visual-language-contracts.mjs'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const root = resolve('.dsh-tmp/workbench-performance', String(Date.now()))
const scriptStarted=performance.now()
const cpuTimes=()=>cpus().reduce((sum,cpu)=>({idle:sum.idle+cpu.times.idle,total:sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0})
// Collect outside the input window; do not start a competing sampler during typing.
const processSnapshot=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
  "@(Get-Process chrome,'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,CPU,WorkingSet64) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}).trim()||'[]')
const nativeDesktop = process.argv.includes('--desktop')
const layoutOnly = process.argv.includes('--layout-only')
const materialsOnly = process.argv.includes('--materials-only')
const materialNames = ['TEST_ONLY 报告笔记.md', 'TEST_ONLY 个人报告笔记.md',
  'TEST_ONLY_Graph_Convolution-Based_Decoupling_and_Consistency-Driven_Fusion_for_Multimodal_Emotion_Recognition.md',
  'TEST_ONLY 作业要求1.md', 'TEST_ONLY 作业要求2.md', 'TEST_ONLY 作业要求3.md']
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
  record('client artifact bytes (SF-134 baseline observation)', true, { bytes: (await stat(resolve('dist/client.js'))).size })
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
    // Both onboarding dialogs are optional, and a dismissal is asynchronous: the host keeps the node
    // mounted with its button disabled until it finishes taking it away. So wait for a dialog to
    // appear, click only while the button is enabled, then wait for the node to actually go.
    // Checking once and clicking blind raced the mount (the dialog arrived after the shell painted
    // and covered the sidebar); re-clicking the closing node only burned the click timeout.
    for (let attempt = 0; attempt < 6; attempt++) {
      const dialog = page.getByRole('dialog').first()
      const appeared = await dialog.waitFor({ state: 'visible', timeout: attempt === 0 ? 5000 : 3000 }).then(() => true).catch(() => false)
      if (!appeared) return
      const text = (await dialog.innerText().catch(() => '')).trimStart()
      const name = text.startsWith('预览版说明') ? '继续' : text.startsWith('添加一个 API Key') ? '稍后配置' : undefined
      if (!name) throw new Error('unexpected dialog: ' + text.slice(0, 80))
      const button = dialog.getByRole('button', { name, exact: true })
      if (await button.isEnabled()) await button.click({ timeout: 15000 })
      await button.waitFor({ state: 'hidden', timeout: 45000 }).catch(() => {})
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
  if (materialsOnly) for (const name of materialNames) await writeFile(join(workspacePath, name), `# ${name}\n\nTEST_ONLY 本地资料；不读取用户文件，不调用模型。\n`)
  const plan = await rpc('scholarflow.v1/project.prepareInit', { request: { context, input: { title: 'Scroll TEST_ONLY', type: 'course-paper' } } })
  await rpc('scholarflow.v1/project.initialize', { request: { context, planId: plan.planId, planHash: plan.planHash } })
  let project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  if (materialsOnly) for (const relativePath of materialNames) {
    await rpc('scholarflow.v1/materials.register', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision }, relativePath, role: 'notes' } })
    project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  }
  if (materialsOnly) for (const material of Object.values(project.ledger.materials).slice(0, 2)) {
    await rpc('scholarflow.v1/materials.parse', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision }, materialId: material.id } })
    project = await rpc('scholarflow.v1/project.inspect', { request: { context } })
  }
  const manuscript = '# Scroll TEST_ONLY\n\n' + Array.from({ length: 450 }, (_, i) =>
    `第 ${i + 1} 段：这是用于验证滚轮的测试正文。保留真实编辑器与预览布局，不调用模型。\n\n`).join('')
  await rpc('scholarflow.v1/document.saveManual', { request: { context: { ...context, projectId: project.binding.projectId, expectedLedgerRevision: project.ledger.revision },
    text: manuscript, baseHash: project.document.contentHash } })
  await page.reload()
  await dismissOnboarding()
  await page.locator('.sf-middle-column').waitFor()

  if (materialsOnly) {
    const closePanel = page.getByRole('button', { name: '收起右侧边栏', exact: true })
    if (await closePanel.isVisible()) await closePanel.click()
    await page.getByLabel('更多论文选项', { exact: true }).click()
    await page.locator('.sf-paper-toolbar .sf-paper-menu-popover').getByRole('button', { name: '资料与引用', exact: true }).click()
    const panel = page.locator('#sf-panel-Research')
    await expect(panel.locator('.sf-material-row')).toHaveCount(6)
    for (const preference of ['light', 'dark']) {
      await rpc('settings/update', { ns: 'ui-theme', patch: { preference } })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, preference === 'dark')
      const geometry = await page.evaluate(geometryInPage, '#sf-panel-Research')
      const cards = geometry.materials
      record(`${preference} installed Host material filenames and statuses remain inside all six cards`,
        cards.cards.length === 6 && cards.cards.every(card => card.contentContained && card.separateStatus && card.textAlign === 'left')
        && cards.overflow <= 1 && cards.referenceGap >= 16, cards)
      await page.locator('.sf-native-workspace').screenshot({ path: join(root, `native-materials-${preference}.png`) })
    }
    const firstReady = panel.locator('.sf-material-row').filter({ hasText: '已读取' }).first()
    const firstReadyTitle = await firstReady.locator('strong').textContent()
    const readyMaterial = Object.values(project.ledger.materials).find(material => material.projectRelativePath === firstReadyTitle)
    const expectedParsed = await rpc('scholarflow.v1/materials.read', { request: { context: { ...context, projectId: project.binding.projectId }, materialId: readyMaterial.id } })
    await firstReady.focus(); await page.keyboard.press('Enter')
    await expect(panel.locator('.sf-material-excerpt pre')).toHaveText(expectedParsed.blocks[0].text)
    if (expectedParsed.blocks.length > 1) {
      await panel.locator('.sf-material-excerpt').getByRole('button', { name: '下一段', exact: true }).click()
      await expect(panel.locator('.sf-material-excerpt pre')).toHaveText(expectedParsed.blocks[1].text)
    }
    await panel.locator('.sf-material-excerpt').getByRole('button', { name: '关闭', exact: true }).click()
    await expect(panel.locator('.sf-material-excerpt')).toHaveCount(0)
    record('keyboard opens the real parsed TEST_ONLY material and closes the excerpt', true, { errors })
    assert.equal(errors.length, 0, 'No client error while opening populated materials')
  } else if (layoutOnly) {
    assert.ok(!nativeDesktop, 'Layout viewport checks use the installed Host in Chromium')
    const closePanel = page.getByRole('button', { name: '收起右侧边栏', exact: true })
    if (await closePanel.isVisible()) await closePanel.click()
    // SF-170 removed split view; header geometry is checked in the current preview view.
    await page.getByRole('button', { name: '预览', exact: true }).click()
    for (const preference of ['light', 'dark']) {
      await rpc('settings/update', { ns: 'ui-theme', patch: { preference } })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, preference === 'dark')
      for (const width of [320, 420, 720, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const layout = await page.locator('.sf-paper-header').evaluate(header => {
          const box = header.getBoundingClientRect(), select = header.querySelector(':scope > select')
          const style = getComputedStyle(select), selectBox = select.getBoundingClientRect()
          const label = select.selectedOptions[0].text, canvas = document.createElement('canvas'), context = canvas.getContext('2d')
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          const formatWidths = [...select.options].map(option => ({ label: option.text, width: context.measureText(option.text).width }))
          const textWidth = Math.max(...formatWidths.map(option => option.width))
          const available = selectBox.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
          const clippedControls = [header].flatMap(container => {
            const parentBox = container.getBoundingClientRect()
            return [...container.querySelectorAll('button,select')].filter(el => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && r.height > 0 && (r.left < parentBox.left - 1 || r.right > parentBox.right + 1)
            }).map(el => el.getAttribute('aria-label') ?? el.textContent)
          })
          return { width: innerWidth, headerWidth: box.width, overflow: document.documentElement.scrollWidth - innerWidth,
            label, formatWidths, textWidth, available, clippedControls, fontSize: style.fontSize,
            selectHeight: selectBox.height, wrapped: getComputedStyle(header).flexWrap }
        })
        record(`${preference} initialized workbench at ${width}px keeps format text and controls inside header`,
          layout.overflow <= 1 && layout.clippedControls.length === 0 && layout.available >= layout.textWidth - 1
          && layout.selectHeight >= (width <= 720 ? 44 : 30), layout)
        await page.locator('.sf-native-workspace').screenshot({ path: join(root, `initialized-${preference}-${width}.png`) })
      }
    }
  } else {
  await page.getByRole('button',{name:'编辑',exact:true}).click()
  const area=page.locator('.sf-source-input');await area.click();await page.keyboard.press('Control+End')
  if (!process.argv.includes('--interaction-only') && !process.argv.includes('--live-visual-only')) {
  const processesBefore=processSnapshot()
  const hiddenPreview=await page.locator('.sf-paper-page .sf-prose').textContent()
  const profiler=process.argv.includes('--profile-typing')?await page.context().newCDPSession(page):undefined
  if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start')}
  await page.evaluate(()=>{
    window.sfPerf={inputs:[],frames:[],longTasks:[]};let prev=performance.now()
    window.sfFrame=requestAnimationFrame(function tick(now){window.sfPerf.frames.push(now-prev);prev=now;window.sfFrame=requestAnimationFrame(tick)})
    document.querySelector('.sf-source-input').addEventListener('input',()=>{const t=performance.now();requestAnimationFrame(()=>window.sfPerf.inputs.push(performance.now()-t))})
    new PerformanceObserver(list=>window.sfPerf.longTasks.push(...list.getEntries().map(x=>x.duration))).observe({entryTypes:['longtask']})
  })
  const cpuBefore=cpuTimes(),start=performance.now();await page.keyboard.type('TEST_ONLY steady typing '.repeat(31),{delay:43});const durationMs=performance.now()-start,cpuAfter=cpuTimes()
  // Include the final input's paint callback rather than dropping the last sample.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const measured=await page.evaluate(()=>{cancelAnimationFrame(window.sfFrame);const p=window.sfPerf,sort=p.inputs.toSorted((a,b)=>a-b);return {samples:sort.length,inputP95Ms:sort[Math.floor(sort.length*.95)],inputMaxMs:Math.max(...sort),longTasks:p.longTasks,frameOver100ms:p.frames.filter(x=>x>100).length}})
  if(profiler){const {profile}=await profiler.send('Profiler.stop');await writeFile(join(root,'typing.cpuprofile'),JSON.stringify(profile));await profiler.detach();console.log('Diagnostic CPU profile:',join(root,'typing.cpuprofile'))}
  const environment={processesBefore,processesAfter:processSnapshot(),systemCpuBusyPercent:100*(1-(cpuAfter.idle-cpuBefore.idle)/(cpuAfter.total-cpuBefore.total)),visibility:await page.evaluate(()=>({hidden:document.hidden,focused:document.hasFocus()}))}
  record('30 seconds of input in a manuscript over 8000 Chinese characters',durationMs>=30000&&manuscript.match(/[\p{Script=Han}]/gu).length>=8000,{durationMs,expectedDelayMs:'TEST_ONLY steady typing '.repeat(31).length*43,chineseCharacters:manuscript.match(/[\p{Script=Han}]/gu).length,...measured,environment})
  record('AT-134 typing p95 within the approved performance limit', measured.samples > 0 && measured.inputP95Ms <= 24.1 * 1.1,
    { measuredP95Ms: measured.inputP95Ms, limitMs: 24.1 * 1.1, nativeDesktop, acceptanceEligible: !profiler })
  record('typing preserves all input with no client failure',(await area.inputValue()).endsWith('TEST_ONLY steady typing '.repeat(31))&&errors.length===0,{errors})
  record('source typing does not rerender the hidden preview',await page.locator('.sf-paper-page .sf-prose').textContent()===hiddenPreview,{})
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
  // The current compact rewrite input no longer repeats the target in .sf-overlay-note.
  // Inspect the source's actual selection and the real instruction control instead.
  const scope=await area.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))
  record('cross-paragraph selection opens an input for the actual selected range',scope.includes('第 2 段') && await page.getByRole('textbox', { name: '局部修改要求', exact: true }).isVisible(),{scope})
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
  }
  await page.screenshot({path:join(root,'performance.png')})
  if (nativeDesktop && !materialsOnly) {
    // Save only this isolated TEST_ONLY manuscript before closing Electron. A dirty
    // beforeunload dialog racing renderer shutdown otherwise makes cleanup fail.
    // v1.20 (SF-187): saving moved out of the pane caption into the single editor bar.
    await page.evaluate(() => { document.documentElement.style.zoom = '1' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const save = page.locator('.sf-format-toolbar').getByRole('button', { name: '保存', exact: true })
    if (await save.count()) { await save.click(); await expect(page.locator('.sf-draft-status')).toContainText('已保存',{timeout:20000}); await expect(save).toHaveCount(0) }
    const collapse = page.getByRole('button', { name: '收起输入', exact: true })
    if (await collapse.isVisible()) await collapse.click()
    const expectedTail=(await page.locator('.sf-source-input').inputValue()).trim().split(/\n\s*\n/).at(-1)
    await page.getByRole('button', { name: '预览', exact: true }).click()
    await expect(page.locator('.sf-paper-page .sf-prose>p').last()).toHaveText(expectedTail)
    for (const preference of ['light', 'dark']) {
      await rpc('settings/update', { ns: 'ui-theme', patch: { preference } })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, preference === 'dark')
      await page.locator('.sf-native-workspace').screenshot({ path: join(root, `native-workspace-${preference}.png`) })
    }
    record('native Desktop review surfaces captured after saving TEST_ONLY edits', true, { themes: ['light','dark'] })
  }
  // Preserve evidence and save isolated edits even when AT-134 fails; still exit nonzero.
  assert.ok(rows.every(row=>row.ok),'See performance journal')
} catch (error) {
  record('run', false, error.message)
  await page?.screenshot({ path: join(root, 'failure.png') }).catch(() => undefined)
  await writeFile(join(root,'failure-page.txt'),await page?.locator('body').innerText().catch(()=> '') ?? '')
  throw error
} finally {
  record('script elapsed time before cleanup',true,{durationMs:performance.now()-scriptStarted,nativeDesktop})
  await writeFile(join(root, 'journal.json'), JSON.stringify(rows, null, 2))
  console.log('Journal:', join(root, 'journal.json'))
  host?.kill()
  await browser?.close()
  await desktopApp?.close()
}
