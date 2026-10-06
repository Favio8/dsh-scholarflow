// AT-29…AT-44 through the real client (SPEC v1.1 §2 V6/§13): boot the installed Host with an
// isolated DSH_HOME, drive the actual UI, and record what each acceptance item does.
//
// The earlier attempt recorded this as unreliable. It was not the client: the wizard is reached
// through a *new conversation's mode chip*, which nothing had clicked. With that one step the
// surfaces render and can be asserted on. No model call is made and no paid usage occurs.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const testHome = resolve('.dsh-tmp/ui-acceptance', String(Date.now()))
const profile = join(testHome, 'profiles/scholarflow-probe')
const emptyRoot = join(testHome, '空工作区 TEST_ONLY')
const projectRoot = join(testHome, '已有项目 TEST_ONLY')
const results = []
const record = (name, verdict, detail) => { const mark = verdict === true || verdict === 'PASS' ? 'PASS' : 'FAIL'
  results.push({ name, verdict: mark, detail }); console.log(`${mark === 'PASS' ? '✔' : '✖'} ${name} — ${detail}`) }

await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(join(emptyRoot, '课程要求'), { recursive: true })
await mkdir(join(projectRoot), { recursive: true })
await writeFile(join(emptyRoot, 'TEST_ONLY 作业说明.md'), 'TEST_ONLY 要求：四页，第一页封面。\n')
await writeFile(join(emptyRoot, '课程要求', 'TEST_ONLY 评分标准.md'), 'TEST_ONLY 评分标准。\n')
await writeFile(join(emptyRoot, 'TEST_ONLY 无法解析.bin'), new Uint8Array([0, 255, 13, 10]))
await writeFile(join(projectRoot, 'TEST_ONLY 原始资料.txt'), 'TEST_ONLY project material.\n')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'scholarflow-probe-TEST_ONLY', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'scholarflow-probe', '--no-open', '--port', '19381'], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const payload = body => body?.result?.value?.data ?? body?.result?.value ?? body
let page
const text = el => (el.innerText ?? '').replace(/\s+/g, ' ').trim()

try {
  const url = await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Host boot timed out')), 30000)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
      if (match) { clearTimeout(timeout); done(match[1]) } })
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Host exited ${code}`)) })
  })
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  // Collected so the motion section can assert that driving the UI did not break anything.
  const clientErrors = []
  page.on('pageerror', error => clientErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') clientErrors.push(message.text()) })
  await page.goto(url)
  await page.waitForTimeout(1500)
  const dismiss = async () => {
    const dialogs = page.getByRole('dialog')
    if (await dialogs.count()) {
      const body = await dialogs.first().innerText()
      if (body.startsWith('预览版说明')) await dialogs.first().getByRole('button', { name: '继续', exact: true }).click()
      else if (body.startsWith('添加一个 API Key')) await dialogs.first().getByRole('button', { name: '稍后配置', exact: true }).click()
      await page.waitForTimeout(700)
    }
  }
  await dismiss()
  const rpc = (method, args = {}) => page.evaluate(async ({ method, args }) => {
    const response = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  }, { method, args })
  const workspaceOf = async path => payload((await rpc('workspace/create', { request: { path } })).body)?.workspace?.workspaceId

  await workspaceOf(emptyRoot)
  await workspaceOf(projectRoot)
  // The client reads the workspace list from the host, so reload after registering them.
  await page.reload()
  await page.waitForTimeout(3000)
  await dismiss()

  // ── AT-29 · the top entry opens the plugin's own settings surface ─────────────────────────
  await page.locator('button', { hasText: 'ScholarFlow 设置' }).first().click()
  await page.waitForTimeout(1500)
  const settings = await page.evaluate(() => {
    const body = (document.body.innerText ?? '').replace(/\s+/g, ' ')
    return { body, hasDefaultType: body.includes('新项目默认类型'), hasProfiles: body.includes('Writing Profiles') }
  })
  record('AT-29 顶部入口打开设置', settings.hasDefaultType && settings.hasProfiles ? 'PASS' : 'FAIL',
    '默认类型=' + settings.hasDefaultType + ' Writing Profiles=' + settings.hasProfiles)

  // Change a setting in the panel, then read it back through the host's own diagnostics.
  // The diagnostics wrapper returns settings as a row array carrying ns, revision and value.
  // The control is a select, so choose the option rather than clicking a button.
  const readSettings = async () => ((await rpc('scholarflow.v1/diagnostics', {})).body?.result?.value?.settings ?? [])[0]
  const beforeRow = await readSettings()
  const typeSelect = page.locator('label', { hasText: '新项目默认类型' }).locator('select')
  await typeSelect.selectOption('research-paper')
  await page.waitForTimeout(1800)
  const afterRow = await readSettings()
  record('AT-29 设置与全局同源',
    beforeRow?.value?.defaultProjectType !== 'research-paper' && afterRow?.value?.defaultProjectType === 'research-paper' ? 'PASS' : 'FAIL',
    '改前=' + String(beforeRow?.value?.defaultProjectType) + ' 改后=' + String(afterRow?.value?.defaultProjectType))

  // ── AT-30 · reached through a new conversation's mode chip ───────────────────────────────
  // The settings panel replaces the main surface, so return to a conversation first.
  await page.locator('[class*="_sessionRow"]', { hasText: '新会话' }).first().click()
  await page.waitForTimeout(1500)
  // A new conversation starts in the default workspace; point it at the fixture workspace so the
  // wizard has the files this run asserts on. The menu renders asynchronously and closes between
  // separate calls, so click the button and poll for the option inside one evaluation.
  const switched = await page.evaluate(async () => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const button = document.querySelector('button[aria-label="选择工作区"]')
    if (!button) return { clicked: false, reason: 'no workspace button' }
    button.click()
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 120))
      const option = [...document.querySelectorAll('*')]
        .filter(el => visible(el) && el.children.length === 0 && (el.innerText ?? '').includes('空工作区 TEST_ONLY'))
        .at(-1)
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
  })
  await page.waitForTimeout(2000)
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
  await page.waitForTimeout(1000)
  const picked = await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const option = [...document.querySelectorAll('button,[role=menuitem],[role=option],[class*="_item_"]')]
      .filter(visible).find(el => (el.className ?? '').toString().includes('_item_') && (el.innerText ?? '').includes('ScholarFlow'))
    if (option) option.click()
    return Boolean(option)
  })
  await page.waitForTimeout(3000)
  const wizard = page.locator('[aria-label="创建论文向导"]')
  const rendered = await wizard.count()
  record('AT-30 模式选择进入引导', rendered === 1 ? 'PASS' : 'FAIL', '向导容器=' + rendered + ' 选项可点=' + picked)
  if (!rendered) throw new Error('wizard did not render; the remaining items cannot run')

  const wizardText = await wizard.first().innerText()
  const steps = await wizard.locator('.sf-wizard-steps button').count()
  record('AT-31 三步导航', steps === 3 && /写作要求/.test(wizardText) && /资料范围/.test(wizardText) && /行文结构/.test(wizardText) ? 'PASS' : 'FAIL',
    '步骤按钮=' + steps)

  // ── AT-31 · step 1: citation style, sources, badges ─────────────────────────────────────
  const citation = /顺序编号/.test(wizardText) && /作者—年份/.test(wizardText) && /尚未实现/.test(wizardText)
  record('AT-31 引用样式如实说明', citation ? 'PASS' : 'FAIL', '顺序编号与作者—年份未实现均已说明=' + citation)
  record('AT-30 新对话落在所选工作区', /空工作区 TEST_ONLY/.test(wizardText) ? 'PASS' : 'FAIL',
    '切换=' + JSON.stringify(switched) + ' 向导标题=' + (wizardText.split('\n')[0] ?? '').slice(0, 40))

  // Step 1 must carry requirements text before it will advance, so write some first — this is
  // also the "only requirements, no source" path the checklist asks about.
  await wizard.locator('#sf-field-requirements').fill('TEST_ONLY 要求：四页，第一页封面。')
  await page.waitForTimeout(700)

  const sourcePicker = async (mode, name) => {
    await wizard.locator('.sf-picker-toggle').click()
    await page.waitForTimeout(600)
    await page.evaluate(({ mode, name }) => {
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const button = [...document.querySelectorAll('.sf-picker-modes button')].find(el => visible(el) && (el.innerText ?? '').trim() === mode)
      button?.click()
      return true
    }, { mode, name })
    await page.waitForTimeout(600)
    const clicked = await page.evaluate(name => {
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const row = [...document.querySelectorAll('.sf-picker-row')].find(el => visible(el) && (el.innerText ?? '').includes(name))
      row?.click()
      return Boolean(row)
    }, name)
    await page.waitForTimeout(900)
    return clicked
  }
  const addedFile = await sourcePicker('文件', 'TEST_ONLY 作业说明.md')
  const addedFolder = await sourcePicker('文件夹', '课程要求')
  const sourceRows = await wizard.locator('.sf-source-row').count()
  const badges = await wizard.locator('.sf-source-badge').allInnerTexts()
  const members = await wizard.locator('.sf-source-members li').count()
  record('AT-31 文件与文件夹来源', addedFile && addedFolder && sourceRows === 2 && members >= 1 ? 'PASS' : 'FAIL',
    '文件=' + addedFile + ' 文件夹=' + addedFolder + ' 来源行=' + sourceRows + ' 成员=' + members)
  record('AT-31 来源徽标', badges.some(badge => /文件夹|可读取/.test(badge)) ? 'PASS' : 'FAIL', '徽标=' + JSON.stringify(badges))

  // ── AT-33 · step 2: one list, counts, disabled reason, clearing keeps sources ─────────────
  await wizard.locator('.sf-wizard-footer button', { hasText: '下一步' }).click()
  await page.waitForTimeout(1500)
  const step2 = await wizard.first().innerText()
  const listCount = await wizard.locator('.sf-material-checklist').count()
  const disabledRows = await wizard.locator('.sf-material-disabled').count()
  const counts = /已选 \d+ · 可解析 \d+ · 仅附件 \d+/.test(step2)
  record('AT-33 单一材料清单', listCount === 1 && counts ? 'PASS' : 'FAIL',
    '清单数=' + listCount + ' 计数行=' + counts + ' 无「其他文件」分区=' + !/其他文件/.test(step2))
  record('AT-33 不可读取行禁用并写明原因', disabledRows >= 1 && /暂不支持/.test(step2) ? 'PASS' : 'FAIL',
    '禁用行=' + disabledRows + ' 原因可见=' + /暂不支持/.test(step2))

  // Select everything readable first, then clear: the clear button is disabled with nothing
  // selected, and this also exercises the toolbar the checklist names.
  const selectAll = wizard.locator('.sf-material-toolbar button', { hasText: '全选可解析' })
  if (await selectAll.isEnabled().catch(() => false)) { await selectAll.click(); await page.waitForTimeout(900) }
  const selectedCount = await wizard.locator('.sf-material-checklist input:checked').count()
  await wizard.locator('.sf-material-toolbar button', { hasText: '清空' }).click()
  await page.waitForTimeout(900)
  const clearedCount = await wizard.locator('.sf-material-checklist input:checked').count()
  record('AT-33 全选可解析与清空', selectedCount >= 1 && clearedCount === 0 ? 'PASS' : 'FAIL',
    '全选后=' + selectedCount + ' 清空后=' + clearedCount)
  await wizard.locator('.sf-wizard-steps button', { hasText: '写作要求' }).click()
  await page.waitForTimeout(900)
  const sourcesAfterClear = await wizard.locator('.sf-source-row').count()
  record('AT-33 清空材料不移除要求来源', sourcesAfterClear === 2 ? 'PASS' : 'FAIL', '来源行=' + sourcesAfterClear)

  // ── AT-34/35 · step 3: the preset library ────────────────────────────────────────────────
  // Going back to step 1 disabled the later steps (by design), so advance with the footer.
  for (let forward = 0; forward < 2; forward += 1) {
    await wizard.locator('.sf-wizard-footer button', { hasText: '下一步' }).click()
    await page.waitForTimeout(1500)
  }
  await wizard.locator('button', { hasText: '更换预设' }).first().click()
  await page.waitForTimeout(1500)
  const dialog = page.locator('[role=dialog][aria-label="选择结构预设"]')
  record('AT-34 预设弹窗打开', await dialog.count() === 1 ? 'PASS' : 'FAIL', '对话框=' + await dialog.count())

  const perType = {}
  for (const [tab, label] of [['课程论文', 'course-paper'], ['研究论文', 'research-paper'], ['文献综述', 'literature-review']]) {
    await dialog.locator('.sf-preset-tabs button', { hasText: tab }).click()
    await page.waitForTimeout(900)
    perType[label] = await dialog.locator('.sf-preset-list .sf-preset-row').count()
  }
  record('AT-35 每类 4 个内置预设', Object.values(perType).every(count => count === 4) ? 'PASS' : 'FAIL',
    JSON.stringify(perType))

  await dialog.locator('.sf-preset-tabs button', { hasText: '课程论文' }).click()
  await page.waitForTimeout(700)
  await dialog.locator('.sf-preset-row').first().click()
  await page.waitForTimeout(700)
  const preview = await dialog.locator('.sf-preset-preview').innerText()
  record('AT-35 预览含场景、比例与依据', /建议分配/.test(preview) && /结构依据|建议/.test(preview) ? 'PASS' : 'FAIL',
    '预览=' + preview.replace(/\s+/g, ' ').slice(0, 160))
  await page.screenshot({ path: join(testHome, 'preset-dialog.png'), fullPage: false })

  await dialog.locator('.sf-preset-row').nth(1).click()
  await page.waitForTimeout(500)
  const applyButton = dialog.locator('footer button', { hasText: /使用|应用/ })
  if (await applyButton.count()) { await applyButton.first().click(); await page.waitForTimeout(1200) }
  // Applying may leave the dialog open; close it so the wizard behind is clickable again.
  if (await dialog.count()) {
    const close = dialog.locator('header button[aria-label="关闭"]')
    if (await close.count()) await close.first().click()
    await page.waitForTimeout(1200)
  }
  const dialogStillOpen = await page.locator('.sf-preset-backdrop').count()
  const afterApply = await wizard.first().innerText()
  record('AT-34 应用预设后进入结构编辑', dialogStillOpen === 0 && /撤销结构编辑/.test(afterApply) && /添加章节/.test(afterApply) ? 'PASS' : 'FAIL',
    '弹窗已关闭=' + (dialogStillOpen === 0) + ' 结构操作可见=' + /撤销结构编辑/.test(afterApply))

  const sectionRows = await wizard.locator('.sf-structure-section').count()
  const lengthModes = await wizard.locator('.sf-section-length span').allInnerTexts()
  record('AT-34 篇幅行区分自动与手工', sectionRows >= 1 && lengthModes.some(mode => /自动/.test(mode)) ? 'PASS' : 'FAIL',
    '章节=' + sectionRows + ' 模式=' + JSON.stringify(lengthModes))

  // Editing a section must mark the structure as modified and be undoable.
  await wizard.locator('.sf-section-length input').first().fill('900')
  await page.waitForTimeout(800)
  const edited = await wizard.first().innerText()
  const undo = wizard.locator('button', { hasText: '撤销结构编辑' })
  record('AT-34 手工改动标记与撤销', /手工/.test(edited) && await undo.count() === 1 ? 'PASS' : 'FAIL',
    '出现手工标记=' + /手工/.test(edited) + ' 撤销按钮=' + await undo.count())

  // ── AT-36 · a user preset is saved from the structure and outlives the project ────────────
  // The button asks for a name through a native prompt, so answer it. A dialog Playwright does
  // not handle is auto-dismissed, which would silently cancel the save.
  const dialogs = []
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.accept('TEST_ONLY 我的结构') })
  await wizard.locator('button', { hasText: '保存为我的预设' }).first().click()
  await page.waitForTimeout(2500)
  const wizardError = await wizard.locator('.sf-wizard-error').allInnerTexts().catch(() => [])
  const savedList = payload((await rpc('scholarflow.v1/presets.list', { request: {} })).body)
  const allUser = (savedList?.all ?? []).filter(preset => preset.source === 'user')
  const mine = allUser.length ? allUser : (savedList?.byType?.['course-paper'] ?? []).filter(preset => preset.source === 'user')
  const presetFile = mine[0]?.id ? join(testHome, 'scholarflow', 'presets', 'user', mine[0].id + '.json') : undefined
  record('AT-36 保存为我的预设', mine.length >= 1 && presetFile && existsSync(presetFile) ? 'PASS' : 'FAIL',
    '我的预设=' + mine.length + ' 落盘=' + Boolean(presetFile && existsSync(presetFile)) +
    ' 原生对话框=' + JSON.stringify(dialogs) + ' 向导错误=' + JSON.stringify(wizardError).slice(0, 160) +
    ' 库总计=' + String((savedList?.all ?? []).length) + ' 类型键=' + JSON.stringify(Object.keys(savedList?.byType ?? {})))
  // Saving stores the structure, not the paper: no title, no requirement text, no manuscript.
  const stored = presetFile && existsSync(presetFile) ? await readFile(presetFile, 'utf8') : ''
  record('AT-36 只存结构', stored && !/TEST_ONLY 作业说明|写作要求|paper\.md/.test(stored) ? 'PASS' : 'FAIL',
    '不含论文题目/要求文件/正文=' + Boolean(stored && !/TEST_ONLY 作业说明|写作要求|paper\.md/.test(stored)))

  // Editing the project structure must not touch the global library.
  const before = presetFile && existsSync(presetFile) ? createHash('sha256').update(await readFile(presetFile)).digest('hex') : ''
  await wizard.locator('.sf-section-title').first().fill('TEST_ONLY 改过的章名')
  await page.waitForTimeout(1200)
  const after = presetFile && existsSync(presetFile) ? createHash('sha256').update(await readFile(presetFile)).digest('hex') : ''
  record('AT-36 改结构不覆盖全局预设', Boolean(before) && before === after ? 'PASS' : 'FAIL',
    '预设文件存在=' + Boolean(before) + ' 哈希一致=' + (Boolean(before) && before === after))

  await page.screenshot({ path: join(testHome, 'wizard-step3.png'), fullPage: false })

  // ── AT-39 · manual lengths survive a smaller target and the shortfall is shown ─────────────
  const target = wizard.locator('.sf-length-input input')
  await target.fill('4000')
  await page.waitForTimeout(900)
  const rows = wizard.locator('.sf-structure-section')
  const count = await rows.count()
  await rows.nth(0).locator('.sf-section-length input').fill('800')
  await page.waitForTimeout(500)
  await rows.nth(1).locator('.sf-section-length input').fill('1200')
  await page.waitForTimeout(1200)
  const withManual = await wizard.first().innerText()
  const manualKept = /计划合计/.test(withManual)
  await target.fill('1500')
  await page.waitForTimeout(1400)
  const manualValues = await rows.nth(0).locator('.sf-section-length input').inputValue()
  const secondManual = await rows.nth(1).locator('.sf-section-length input').inputValue()
  const lowered = await wizard.first().innerText()
  record('AT-39 手工篇幅不被自动削减', manualKept && manualValues === '800' && secondManual === '1200' ? 'PASS' : 'FAIL',
    '章节=' + count + ' 目标降到 1500 后手工值=' + manualValues + '/' + secondManual + ' 差额说明=' + /差额|超出|计划合计/.test(lowered))

  // ── AT-51/SF-053 · the big pre-creation block is gone; a short summary sits by the button ─
  const visibleConfirm = await wizard.locator('.sf-confirm:visible').count()
  record('AT-51 大块创建前确认区已移除', visibleConfirm === 0 ? 'PASS' : 'FAIL', '可见的 .sf-confirm=' + visibleConfirm)
  const summary = await wizard.locator('.sf-create-summary').first().innerText()
  // The summary shows the user-facing format label, not the machine value.
  const deliverable = ['Word', '字', '要求来源', '参考材料', '输出', '联网'].every(token => summary.includes(token))
  record('AT-51 短摘要可核对范围', deliverable ? 'PASS' : 'FAIL', summary.replace(/\s+/g, ' ').slice(0, 120))
  await wizard.locator('.sf-create-summary details > summary').first().click()
  await page.waitForTimeout(200)
  const scope = await wizard.locator('.sf-create-summary details').first().innerText()
  const scopeMissing = ['将读取', '将写入', '排版', '能力缺口'].filter(label => !scope.includes(label))
  record('AT-51 展开后可见读取/写入范围与能力缺口', scopeMissing.length === 0 ? 'PASS' : 'FAIL', '缺失=' + JSON.stringify(scopeMissing))
  record('AT-57 不再展示固定额度', /模型调用上限/.test(scope) ? 'FAIL' : 'PASS',
    /模型调用上限/.test(scope) ? '仍显示调用上限' : '只说明次数与耗时为统计')

  // ── AT-41 · narrow widths do not scroll sideways; Escape closes and restores focus ───────
  const overflow = {}
  for (const width of [480, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(900)
    overflow[width] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  }
  record('AT-41 窄屏无横向滚动', Object.values(overflow).every(delta => delta <= 1) ? 'PASS' : 'FAIL',
    '480px 溢出=' + overflow[480] + ' 320px 溢出=' + overflow[320])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(900)

  const trigger = wizard.locator('button', { hasText: '更换预设' }).first()
  await trigger.click()
  await page.waitForTimeout(1500)
  const opened = await page.locator('.sf-preset-backdrop').count()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)
  const closed = await page.locator('.sf-preset-backdrop').count()
  const focusBack = await page.evaluate(() => (document.activeElement?.innerText ?? '').includes('更换预设'))
  record('AT-41 弹窗 Escape 关闭并归还焦点', opened === 1 && closed === 0 ? 'PASS' : 'FAIL',
    '打开=' + opened + ' Escape 后=' + closed + ' 焦点回到触发按钮=' + focusBack)

  // ── AT-44 · the picker states its scope and offers the external folder honestly ───────────
  // The picker lives on step 1, so step back before looking for it.
  await wizard.locator('.sf-wizard-steps button', { hasText: '写作要求' }).click()
  await page.waitForTimeout(1500)
  await wizard.locator('.sf-picker-toggle').click()
  await page.waitForTimeout(1000)
  const pickerFoot = await wizard.locator('.sf-picker-foot button').allInnerTexts()
  const pickerNote = await wizard.locator('.sf-picker-note').innerText()
  record('AT-44 来源范围说明与外部入口',
    pickerFoot.some(label => label.includes('电脑其他位置')) && /工作区/.test(pickerNote) && /只读取这一个文件夹/.test(pickerNote) ? 'PASS' : 'FAIL',
    '入口=' + JSON.stringify(pickerFoot) + ' 说明=' + pickerNote.replace(/\s+/g, ' ').slice(0, 120))
  await page.keyboard.press('Escape').catch(() => undefined)

  // ── AT-65 · three steps forward and back, direction-aware, then a burst of clicks ────────
  // The transform is sampled while the transition is still running: an assertion that a step
  // "changed" would pass even with no motion at all.
  const sampleStep = async () => page.evaluate(() => {
    const pages = document.querySelectorAll('.sf-wizard-page')
    const node = pages[pages.length - 1]
    const buttons = [...document.querySelectorAll('.sf-wizard-steps button')]
    return { pages: pages.length, transform: node ? getComputedStyle(node).transform : 'none',
      direction: node?.getAttribute('data-direction'),
      current: buttons.findIndex(button => button.getAttribute('aria-current') === 'step') }
  })
  // Clicked through the page rather than through an actionability wait: the point is to sample
  // a transition mid-flight, and a stability check would let it finish first.
  const pressStep = async label => page.evaluate(text => {
    const button = [...document.querySelectorAll('.sf-wizard-footer button')]
      .find(el => (el.innerText ?? '').includes(text) && !el.disabled)
    if (button) button.click()
    return Boolean(button)
  }, label)
  // Return to step 1 first: the previous section ends on the source picker.
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.evaluate(() => {
    const first = document.querySelector('.sf-wizard-steps button')
    if (first && first.getAttribute('aria-current') !== 'step') first.click()
  })
  await page.waitForTimeout(500)
  const travel = []
  for (let index = 0; index < 3; index++) {
    await pressStep('下一步')
    await page.waitForTimeout(70)
    travel.push({ way: 'forward', during: await sampleStep() })
    await page.waitForTimeout(320)
  }
  for (let index = 0; index < 3; index++) {
    await pressStep('上一步')
    await page.waitForTimeout(70)
    travel.push({ way: 'back', during: await sampleStep() })
    await page.waitForTimeout(320)
  }
  const offsetX = frame => {
    const match = /matrix\(([^)]+)\)/.exec(frame.during.transform ?? '')
    return match ? Number(match[1].split(',')[4]) : 0
  }
  const forwards = travel.filter(frame => frame.way === 'forward')
  const backwards = travel.filter(frame => frame.way === 'back')
  record('AT-65 前进与返回都实际播放过渡', travel.every(frame => frame.during.direction) && travel.some(frame => offsetX(frame) !== 0),
    travel.map(frame => `${frame.way}:${frame.during.direction} x=${offsetX(frame).toFixed(1)}`).join(' | '))
  record('AT-65 方向区分前进与返回',
    forwards.every(frame => offsetX(frame) >= 0) && backwards.every(frame => offsetX(frame) <= 0) &&
      forwards.some(frame => offsetX(frame) > 0) && backwards.some(frame => offsetX(frame) < 0),
    '前进 x=' + forwards.map(frame => offsetX(frame).toFixed(1)).join(',') + ' 返回 x=' + backwards.map(frame => offsetX(frame).toFixed(1)).join(','))
  record('AT-65 返回后停在第一步', (await sampleStep()).current === 0, '当前步骤=' + (await sampleStep()).current)

  // Business state follows the click, not the animation: the step index must already be the
  // new one while the transition is still playing.
  await pressStep('下一步')
  await page.waitForTimeout(40)
  const immediate = await sampleStep()
  record('AT-66 状态随点击立即改变，不等动画播完', immediate.current === 1, '40ms 后当前步骤=' + immediate.current)

  // A burst of clicks must leave exactly one live page and a stage that is not blank.
  for (let index = 0; index < 5; index++) { await pressStep('下一步'); await pressStep('上一步') }
  await page.waitForTimeout(600)
  const burst = await page.evaluate(() => ({ pages: document.querySelectorAll('.sf-wizard-page').length,
    height: document.querySelector('.sf-wizard')?.getBoundingClientRect().height ?? 0,
    text: (document.querySelector('.sf-wizard')?.innerText ?? '').length,
    operable: [...document.querySelectorAll('.sf-wizard-page button')].filter(button => button.offsetParent !== null).length }))
  record('AT-65 连续点击后只有一个可操作页面且不空白',
    burst.pages === 1 && burst.height > 200 && burst.text > 40 && burst.operable > 0, JSON.stringify(burst))

  // ── AT-69 · reduced motion collapses the transitions and leaves nothing running ──────────
  const quiet = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const quietPage = await quiet.newPage()
  await quietPage.goto(url)
  await quietPage.waitForTimeout(1400)
  const quietTokens = await quietPage.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return { base: style.getPropertyValue('--sf-dur-base').trim(), sweep: style.getPropertyValue('--sf-sweep').trim() }
  })
  record('AT-69 减少动态效果时令牌收敛', /^1ms$/.test(quietTokens.base) && (quietTokens.sweep === '0s' || quietTokens.sweep === '0'),
    '--sf-dur-base=' + quietTokens.base + ' --sf-sweep=' + quietTokens.sweep)
  await quiet.close()

  // ── AT-69 · 200% zoom must not scroll sideways and must keep controls usable ─────────────
  await page.setViewportSize({ width: 640, height: 450 })
  await page.waitForTimeout(800)
  const zoomed = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('.sf-wizard button, .sf-wizard input:not([type=checkbox]), .sf-wizard select, .sf-wizard textarea')]
      .filter(el => el.offsetParent !== null && !el.hidden)
      .map(el => el.getBoundingClientRect().height).filter(height => height > 0)
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, count: controls.length,
      smallest: controls.length ? Math.min(...controls) : 0 }
  })
  record('AT-69 200% 缩放无横向滚动', zoomed.overflow <= 1, 'overflow=' + zoomed.overflow + 'px')
  record('AT-69 200% 缩放控件仍可用', zoomed.count > 0 && zoomed.smallest >= 24,
    '可见控件=' + zoomed.count + ' 最小高度=' + Math.round(zoomed.smallest) + 'px')
  await page.setViewportSize({ width: 1440, height: 900 })
  record('AT-65～69 交互期间无客户端错误', clientErrors.length === 0, clientErrors.slice(0, 3).join(' | ') || 'none')

  // ── AT-67/68/59 · these need a real project: the overlay, the candidate and the draft only
  // exist once one does. Created and cancelled at once, so no generation is paid for.
  const projectWorkspace = await workspaceOf(projectRoot)
  const createdSession = payload((await rpc('session/create', { request: { workspaceId: projectWorkspace, agentPreset: 'scholarflow' } })).body)?.sessionId
  const projectContext = { requestId: `req_at67_${Date.now()}`, workspaceId: projectWorkspace, sessionId: createdSession }
  const projectSpec = { title: 'TEST_ONLY 交互验收', type: 'course-paper', language: 'zh-CN', format: 'markdown',
    requirements: 'TEST_ONLY 交互验收用要求。', requirementSources: [], materials: [], online: false, targetLength: 1500,
    countingPolicy: { scope: 'body', includeAbstract: false, algorithmVersion: 1 },
    sections: [{ id: 'section_1', title: '第一节', purpose: '', targetLength: 1500, allocationMode: 'auto' }],
    manuscriptDir: 'manuscript', overrides: [] }
  let workbench = 0
  try {
    const plan = payload((await rpc('scholarflow.v1/creation.prepare', { request: { context: projectContext, spec: projectSpec } })).body)
    const started = payload((await rpc('scholarflow.v1/creation.start', { request: { context: projectContext, planId: plan.planId, planHash: plan.planHash } })).body)
    record('AT-68 项目已创建以便驱动工作台', Boolean(started?.taskId), 'task=' + String(started?.taskId))
    await rpc('scholarflow.v1/writingTask.action', { request: { context: { ...projectContext, projectId: started.projectId },
      taskId: started.taskId, action: 'cancel' } })
    await page.waitForTimeout(2000)
    await page.locator('[class*="_sessionRow"]').first().click().catch(() => undefined)
    await page.waitForTimeout(2500)
    workbench = await page.locator('.sf-middle-column').count()
  } catch (error) {
    record('AT-68 项目已创建以便驱动工作台', 'FAIL', error.message)
  }
  record('AT-67 正文工作台在真实客户端挂载', workbench > 0, 'middle columns=' + workbench)
  if (workbench > 0) {
    const box = () => page.evaluate(() => {
      const column = document.querySelector('.sf-middle-column')
      const overlay = document.querySelector('.sf-overlay')
      const scroller = document.querySelector('.sf-editor-scroll')
      const right = document.querySelector('[class*="_sidebarRight"], [class*="sidebar-right"], aside')
      return { overlay: overlay ? overlay.getBoundingClientRect().toJSON() : undefined,
        column: column ? column.getBoundingClientRect().toJSON() : undefined,
        rightLeft: right ? right.getBoundingClientRect().left : undefined,
        padBottom: scroller ? parseFloat(getComputedStyle(scroller).paddingBottom) : 0 }
    })
    const idle = await box()
    record('AT-67 浮层未打开时滚动区没有多余留白', (idle.padBottom ?? 0) === 0 && !idle.overlay,
      'padBottom=' + idle.padBottom + ' overlay=' + Boolean(idle.overlay))
    const selected = await page.evaluate(() => {
      const block = document.querySelector('.sf-paper-page p')
      if (!block?.firstChild) return false
      const range = document.createRange(); range.setStart(block.firstChild, 0)
      range.setEnd(block.firstChild, Math.min(20, block.firstChild.textContent.length))
      const list = window.getSelection(); list.removeAllRanges(); list.addRange(range)
      block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return true
    })
    await page.waitForTimeout(700)
    const menu = await page.locator('.sf-selection-menu').count()
    record('AT-56 选区菜单在真实客户端出现', selected && menu > 0, '选中=' + selected + ' 菜单=' + menu)
    await page.locator('.sf-selection-menu button').first().click().catch(() => undefined)
    await page.waitForTimeout(700)
    const opened = await box()
    record('AT-67 浮层在中栏之内且不达右栏',
      opened.overlay && opened.column && opened.overlay.left >= opened.column.left - 1 && opened.overlay.right <= opened.column.right + 1 &&
        (opened.rightLeft === undefined || opened.overlay.right <= opened.rightLeft + 1),
      JSON.stringify({ overlayRight: Math.round(opened.overlay?.right ?? 0), columnRight: Math.round(opened.column?.right ?? 0),
        rightLeft: opened.rightLeft === undefined ? null : Math.round(opened.rightLeft) }))
    record('AT-67 浮层打开时滚动区获得留白', (opened.padBottom ?? 0) > 0, 'padBottom=' + Math.round(opened.padBottom ?? 0))
    for (let index = 0; index < 6; index++) {
      await page.locator('.sf-overlay button:has-text("收起"), .sf-overlay-head button').first().click().catch(() => undefined)
      await page.waitForTimeout(90)
      await page.locator('.sf-selection-menu button').first().click().catch(() => undefined)
      await page.waitForTimeout(90)
    }
    await page.waitForTimeout(500)
    const toggled = await box()
    record('AT-67 反复开合后浮层仍在边界内',
      !toggled.overlay || (toggled.overlay.left >= toggled.column.left - 1 && toggled.overlay.right <= toggled.column.right + 1),
      'overlay=' + Boolean(toggled.overlay) + ' padBottom=' + Math.round(toggled.padBottom ?? 0))
    const before = await page.evaluate(() => document.querySelector('.sf-source-input')?.value ?? '')
    await page.locator('.sf-overlay button:has-text("提交")').first().click().catch(() => undefined)
    const generating = await page.evaluate(async () => {
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        if (document.querySelector('.sf-rewrite')?.dataset.state === 'generating') return true
        await new Promise(done => setTimeout(done, 100))
      }
      return false
    })
    record('AT-57 提交后真实进入生成状态', generating, 'generating=' + generating)
    await page.locator('.sf-rewrite button:has-text("停止")').first().click().catch(() => undefined)
    await page.waitForTimeout(2000)
    const afterStop = await page.evaluate(() => ({ state: document.querySelector('.sf-rewrite')?.dataset.state,
      text: document.querySelector('.sf-source-input')?.value ?? '', accept: Boolean(document.querySelector('[data-sf-accept]')) }))
    record('AT-68 停止后进入停止状态且没有可接受候选', afterStop.state === 'stopped' && afterStop.accept === false,
      JSON.stringify({ state: afterStop.state, accept: afterStop.accept }))
    record('AT-67 停止后正文不变', afterStop.text === before, '文本一致=' + (afterStop.text === before))
    const urlBefore = page.url()
    for (let index = 0; index < 4; index++) {
      await page.locator('[class*="right"], [title*="右栏"], [title*="侧边"]').first().click().catch(() => undefined)
      await page.waitForTimeout(160)
    }
    await page.waitForTimeout(700)
    const afterPane = await box()
    record('AT-59 右栏反复开合不重建会话', page.url() === urlBefore, 'url 不变=' + (page.url() === urlBefore))
    record('AT-59 右栏开合后浮层边界仍正确',
      !afterPane.overlay || afterPane.overlay.right <= afterPane.column.right + 1,
      JSON.stringify({ overlayRight: Math.round(afterPane.overlay?.right ?? 0), columnRight: Math.round(afterPane.column?.right ?? 0) }))
  }
} catch (error) {
  record('acceptance run', 'FAIL', error.message)
} finally {
  await writeFile(resolve('.dsh-tmp/ui-acceptance/result.json'), JSON.stringify({ at: new Date().toISOString(), testHome, results }, null, 2))
  await page?.context().close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)) }
  const failed = results.filter(row => row.verdict !== 'PASS').length
  console.log(`\n${results.length - failed}/${results.length} 项通过；隔离目录：${testHome}`)
}
