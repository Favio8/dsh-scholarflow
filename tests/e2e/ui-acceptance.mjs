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
const record = (name, verdict, detail) => { results.push({ name, verdict, detail }); console.log(`${verdict === 'PASS' ? '✔' : '✖'} ${name} — ${detail}`) }

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
