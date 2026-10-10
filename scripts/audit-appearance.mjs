// SF-133: all registered render surfaces plus the real Host creation surface.
// Component fixtures and native Host measurements are labelled separately in the report.
//
// Aesthetic judgement needs eyes; legibility does not. This drives the real client and measures
// what can be measured: contrast against the effective background, whether the surfaces follow
// the host theme instead of hardcoding light colours, interactive target sizes at narrow widths,
// text clipping, and font sizes below a readable floor. Findings are numbers, so a regression
// shows up as a number rather than as an opinion.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { extractCss, pageHtml, prepareSurfaceMarkup, surfaces } from './render-surfaces.mjs'
import { visualSourceMetrics } from './visual-source-metrics.mjs'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const testHome = resolve('.dsh-tmp/appearance', String(Date.now()))
const profile = join(testHome, 'profiles/p')
const root = join(testHome, '工作区 TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(join(root, '课程要求'), { recursive: true })
await writeFile(join(root, 'TEST_ONLY 作业说明.md'), 'TEST_ONLY 要求：四页，第一页封面。\n')
await writeFile(join(root, '课程要求', 'TEST_ONLY 评分标准.md'), 'TEST_ONLY 评分标准。\n')
await writeFile(join(root, 'TEST_ONLY 无法解析.bin'), new Uint8Array([0, 255, 13, 10]))
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'p', private: true,
  dependencies: { 'dsh-scholarflow': `link:${resolve('.').replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-scholarflow'] } } }))
await writeFile(join(profile, 'cordis.yml'), '[]\n')
try { await symlink(resolve('.'), join(profile, 'node_modules/dsh-scholarflow'), 'junction') } catch (error) { if (error.code !== 'EEXIST') throw error }

const browser = await chromium.launch({ executablePath: process.env.SCHOLARFLOW_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
let page, child

/** Runs in the page: contrast, sizes, clipping and theme adherence for one surface. */
const auditInPage = (selector) => {
  const parseColour = value => {
    const match = String(value).match(/rgba?\(([^)]+)\)/)
    if (!match) return null
    const [r, g, b, a = '1'] = match[1].split(',').map(part => parseFloat(part))
    return { r, g, b, a }
  }
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 })
  const luminance = ({ r, g, b }) => {
    const channel = value => { const s = value / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
  // The effective background is the nearest ancestor that actually paints something.
  const backgroundOf = element => {
    let node = element, painted = { r: 255, g: 255, b: 255, a: 1 }
    const stack = []
    while (node && node !== document.documentElement) {
      const colour = parseColour(getComputedStyle(node).backgroundColor)
      if (colour && colour.a > 0) stack.push(colour)
      if (colour && colour.a >= 1) break
      node = node.parentElement
    }
    const base = parseColour(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
    painted = base.a >= 1 ? base : { r: 255, g: 255, b: 255, a: 1 }
    for (const layer of stack.reverse()) painted = layer.a >= 1 ? layer : over(layer, painted)
    return painted
  }
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.checkVisibility() && getComputedStyle(el).visibility !== 'hidden' }
  const host = document.querySelector(selector)
  if (!host) return null
  const texts = [], targets = [], clipped = [], tiny = [], exclusions = []
  const fontSizes = new Set(), radii = new Set(), controlHeights = new Set()
  let selectElements = 0, customSelectElements = 0
  let contrastChecked = 0, visibleElements = 0
  for (const el of [host, ...host.querySelectorAll('*')]) {
    if (!visible(el)) continue
    visibleElements++
    const style = getComputedStyle(el)
    fontSizes.add(style.fontSize)
    radii.add(style.borderRadius)
    if (el.matches('select')) { selectElements++; if (style.appearance === 'none') customSelectElements++ }
    const own = el.matches('input:not([type=checkbox]):not([type=radio]),textarea')
      ? el.value || el.placeholder || ''
      : [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).join('')
    if (own) {
      const foreground = !el.value && el.placeholder ? getComputedStyle(el, '::placeholder') : style
      const colour = parseColour(foreground.color)
      const size = parseFloat(style.fontSize)
      const bold = parseInt(style.fontWeight, 10) >= 700
      // 18pt regular / 14pt bold = 24px / 18.667px. The former gate confused pt and px.
      const required = size >= 24 || (bold && size >= 18.6667) ? 3 : 4.5
      const gradientGlyphs = style.backgroundImage !== 'none' && (style.backgroundClip === 'text' || style.webkitBackgroundClip === 'text')
      if (el.closest(':disabled')) exclusions.push({ text: own.slice(0, 28), reason: 'disabled-control (WCAG exemption)' })
      else if (gradientGlyphs) exclusions.push({ text: own.slice(0, 28), reason: 'gradient-glyphs: pixel contrast measured by render:surfaces' })
      else {
        let opacity = foreground === style ? 1 : parseFloat(foreground.opacity)
        for (let node = el; node; node = node.parentElement) opacity *= parseFloat(getComputedStyle(node).opacity)
        const ratio = colour ? contrast(over({ ...colour, a: colour.a * opacity }, backgroundOf(el)), backgroundOf(el)) : null
        contrastChecked++
        if (ratio === null || ratio < required) texts.push({ text: own.slice(0, 28), ratio: ratio === null ? null : +ratio.toFixed(2), required, size, colour: foreground.color, opacity, effectiveBackground: backgroundOf(el) })
      }
      if (size < 11) tiny.push({ text: own.slice(0, 20), size })
    }
    if (el.matches('button,input,select,textarea,[role=button],[role=checkbox],[role=radio]')) {
      const rect = el.getBoundingClientRect()
      controlHeights.add(+rect.height.toFixed(2))
      if (rect.height < 28 || rect.width < 24) targets.push({ tag: el.tagName.toLowerCase(), w: Math.round(rect.width), h: Math.round(rect.height), text: (el.innerText ?? '').slice(0, 16) })
    }
    if (el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible' && own) {
      clipped.push({ text: own.slice(0, 24), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
    }
  }
  const inherited = getComputedStyle(host)
  return {
    contrastFailures: texts.sort((a, b) => a.ratio - b.ratio),
    contrastChecked, visibleElements, exclusions,
    computedKinds: { fontSizes: [...fontSizes].sort(), radii: [...radii].sort(), controlHeights: [...controlHeights].sort((a, b) => a - b) },
    selectAppearance: { total: selectElements, custom: customSelectElements },
    smallTargets: targets, clipped, tinyText: tiny,
    hostTheme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
    tokens: {
      surface: inherited.getPropertyValue('--sf-surface').trim(),
      text: inherited.getPropertyValue('--sf-text').trim(),
      background: inherited.backgroundColor
    }
  }
}

const report = { coverage: Object.keys(surfaces), renderSurfaces: {}, sourceMetrics: visualSourceMetrics(resolve('src/client')) }
try {
  // The original eight use the established same-CSS/JSX fixtures. Additional seats mount
  // actual client components with TEST_ONLY data. Neither is claimed as Host acceptance.
  const fixtures = await prepareSurfaceMarkup()
  const css = [
    ['src/client/theme/tokens.ts', 'THEME_CSS'], ['src/client/creation-wizard.tsx', 'WIZARD_CSS'],
    ['src/client/preset-picker.tsx', 'PRESET_CSS'], ['src/client/paper-workspace.tsx', 'PAPER_CSS'],
    ['src/client/motion/tokens.ts', 'MOTION_CSS'],
  ].map(([file, name]) => extractCss(file, name))
  for (const scheme of ['light', 'dark']) {
    report.renderSurfaces[scheme] = {}
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } })
    try {
      const fixturePage = await context.newPage()
      await fixturePage.setContent(pageHtml(...css, scheme === 'dark'))
      await fixturePage.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), scheme === 'dark')
      await fixturePage.addScriptTag({ content: fixtures.outputFiles[0].text })
      await fixturePage.waitForFunction(() => window.sfVisualFixturesReady === true)
      for (const width of [1100, 320]) {
        await fixturePage.setViewportSize({ width, height: 900 })
        for (const [index, id] of Object.keys(surfaces).entries()) {
          const selector = `#s${index + 1}>.frame`
          const measurement = await fixturePage.evaluate(auditInPage, selector)
          if (!measurement) throw new Error(`missing fixture: ${id}`)
          report.renderSurfaces[scheme][`${id}@${width}`] = {
            evidence: 'client-render-fixture', ...measurement,
            overflow: await fixturePage.locator(selector).evaluate(el => el.scrollWidth - el.clientWidth),
          }
        }
      }
    } finally { await context.close() }
  }
  const url = await new Promise((done, reject) => {
    child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
      join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
      'p', '--no-open', '--port', '19401'], {
      env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const t = setTimeout(() => reject(new Error('boot timeout')), 30000)
    let out = ''
    child.stdout.on('data', c => { out += c.toString(); const m = out.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/); if (m) { clearTimeout(t); done(m[1]) } })
    child.on('error', error => { clearTimeout(t); reject(error) })
    child.on('exit', code => { clearTimeout(t); reject(new Error('exit ' + code)) })
  })
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.setDefaultTimeout(20000)
  await page.goto(url); await page.waitForTimeout(1500)
  const dismiss = async () => {
    const d = page.getByRole('dialog')
    if (await d.count()) { const t = await d.first().innerText()
      if (t.startsWith('预览版说明')) await d.first().getByRole('button', { name: '继续', exact: true }).click()
      else if (t.startsWith('添加一个 API Key')) await d.first().getByRole('button', { name: '稍后配置', exact: true }).click()
      await page.waitForTimeout(700) }
  }
  await dismiss()
  const rpc = (method, args = {}) => page.evaluate(async ({ method, args }) => {
    const r = await fetch(`api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }, { method, args })
  await rpc('workspace/create', { request: { path: root } })
  await page.reload(); await page.waitForTimeout(3000); await dismiss()

  // Reach the wizard the way a user does.
  await page.locator('button[aria-label="选择工作区"]').click().catch(() => undefined)
  await page.waitForTimeout(900)
  await page.evaluate(async () => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 120))
      const option = [...document.querySelectorAll('*')].filter(el => visible(el) && el.children.length === 0 && (el.innerText ?? '').includes('工作区 TEST_ONLY')).at(-1)
      if (!option) continue
      let target = option
      for (let up = 0; up < 4 && target.parentElement; up += 1) {
        if (target.tagName === 'BUTTON' || target.getAttribute('role') === 'menuitem' || (target.className ?? '').toString().includes('_item_')) break
        target = target.parentElement
      }
      target.click(); return
    }
  })
  await page.waitForTimeout(1500)
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
  await page.waitForTimeout(1000)
  await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const option = [...document.querySelectorAll('button,[role=menuitem],[role=option],[class*="_item_"]')]
      .filter(visible).find(el => (el.className ?? '').toString().includes('_item_') && (el.innerText ?? '').includes('ScholarFlow'))
    option?.click()
  })
  await page.waitForTimeout(3000)
  if (!await page.locator('[aria-label="创建论文向导"]').count()) throw new Error('wizard did not render')

  for (const scheme of ['light', 'dark']) {
    // Change only this isolated Host profile, then explicitly activate the actual token selector.
    const changed = await rpc('settings/update', { ns: 'ui-theme', patch: { preference: scheme } })
    if (changed.status !== 200 || changed.body?.result?.ok === false) throw new Error(`cannot set Host theme: ${scheme}`)
    await page.emulateMedia({ colorScheme: scheme })
    await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), scheme === 'dark')
    await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, scheme === 'dark')
    // Await finite transitions before taking contrast samples; infinite status/mark animations
    // have their own pixel gate and must not prevent the appearance audit from finishing.
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      await Promise.allSettled(finite.map(animation => animation.finished))
    })
    report[scheme] = {
      evidence: 'installed-dsh-client',
      step1: await page.evaluate(auditInPage, '[aria-label="创建论文向导"]'),
      step1Narrow: null,
      zoom200: null
    }
    await page.setViewportSize({ width: 320, height: 900 })
    await page.waitForTimeout(1000)
    report[scheme].step1Narrow = await page.evaluate(auditInPage, '[aria-label="创建论文向导"]')
    report[scheme].step1Narrow.overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    // 200% zoom halves the CSS viewport, which is the case design 05 §9 asks about: targets
    // must reach 44px there, and nothing may clip.
    await page.setViewportSize({ width: 720, height: 900 })
    await page.waitForTimeout(1000)
    const zoom = await page.evaluate(auditInPage, '[aria-label="创建论文向导"]')
    report[scheme].zoom200 = {
      targetsUnder44: await page.evaluate(() => {
        const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
        return [...document.querySelectorAll('[aria-label="创建论文向导"] button,[aria-label="创建论文向导"] input:not([type=checkbox]),[aria-label="创建论文向导"] select,[aria-label="创建论文向导"] textarea')]
          .filter(visible).map(el => ({ h: Math.round(el.getBoundingClientRect().height), t: (el.innerText ?? el.value ?? '').slice(0, 14) }))
          .filter(row => row.h < 44).slice(0, 10)
      }),
      clipped: zoom.clipped,
      overflow: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(800)
  }
  report.hostThemeActivated = report.light?.step1?.hostTheme === 'light' && report.dark?.step1?.hostTheme === 'dark'
    && report.light?.step1?.tokens?.surface !== report.dark?.step1?.tokens?.surface
} catch (error) {
  report.error = error.message
} finally {
  await writeFile(resolve('.dsh-tmp/appearance/report.json'), JSON.stringify({ at: new Date().toISOString(), testHome, report }, null, 2))
  await page?.context().close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  if (child && child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)) }
}

const problems = []
if (report.error) problems.push(`audit aborted: ${report.error}`)
if (!report.hostThemeActivated) problems.push('Host light/dark attribute and computed SF surface tokens were not both activated')
for (const scheme of ['light', 'dark']) {
  const rows = report.renderSurfaces[scheme] ?? {}
  for (const id of report.coverage) for (const width of [1100, 320]) {
    const key = `${id}@${width}`, view = rows[key]
    if (!view || !view.visibleElements || !view.contrastChecked) { problems.push(`${scheme} ${key}: no readable surface measurement`); continue }
    if (view.hostTheme !== scheme || !view.tokens.surface || !view.tokens.text) problems.push(`${scheme} ${key}: theme/tokens missing`)
    for (const row of view.contrastFailures) problems.push(`${scheme} ${key}: contrast ${row.ratio} < ${row.required} — ${row.text}`)
    if (view.overflow > 1) problems.push(`${scheme} ${key}: overflow ${view.overflow}px`)
    if (view.tinyText.length) problems.push(`${scheme} ${key}: ${view.tinyText.length} font sizes below 11px`)
  }
}
for (const scheme of ['light', 'dark']) {
  const surface = report[scheme]
  if (!surface) { problems.push(`${scheme}: no measurement`); continue }
  for (const [where, view] of [['宽屏', surface.step1], ['窄屏', surface.step1Narrow], ['200% 缩放', surface.zoom200]]) {
    if (!view) { problems.push(`${scheme} ${where}: missing measurement`); continue }
    for (const row of view.contrastFailures ?? []) problems.push(`${scheme} ${where}: 对比度 ${row.ratio} < ${row.required} — ${row.text}`)
    if ((view.narrowOverflow ?? view.overflow ?? 0) > 1) problems.push(`${scheme} ${where}: 横向溢出 ${view.narrowOverflow ?? view.overflow}px`)
    if (view.clipped?.length) problems.push(`${scheme} ${where}: ${view.clipped.length} 处文字截断`)
    if (view.tinyText?.length) problems.push(`${scheme} ${where}: ${view.tinyText.length} 处字号小于 11px`)
  }
  for (const row of surface.zoom200?.targetsUnder44 ?? []) problems.push(`${scheme} 200% 缩放: 点击目标 ${row.h}px < 44px — ${row.t}（设计 05 §9）`)
}

report.coverageComplete = report.hostThemeActivated === true && ['light', 'dark'].every(scheme =>
  report.coverage.every(id => [1100, 320].every(width => report.renderSurfaces[scheme]?.[`${id}@${width}`]?.contrastChecked > 0)))
report.problems = problems
await writeFile(resolve('.dsh-tmp/appearance/report.json'), JSON.stringify({ at: new Date().toISOString(), testHome, report }, null, 2))
console.log(JSON.stringify({ coverage: report.coverage, coverageComplete: report.coverageComplete,
  hostThemeActivated: report.hostThemeActivated, problemCount: problems.length, error: report.error,
  sourceCounts: { fontLiterals: report.sourceMetrics.fontSizeLiterals.length,
    fontTokenKinds: report.sourceMetrics.fontTokenKinds.length, paddingKinds: report.sourceMetrics.paddingDeclarationKinds.length,
    primaryDefinitions: report.sourceMetrics.primaryDefinitions.length, importantOccurrences: report.sourceMetrics.importantOccurrences } }, null, 1))
console.log('\n报告写入 .dsh-tmp/appearance/report.json；隔离目录：', testHome)
if (problems.length) {
  console.error(`\n${problems.length} 项外观问题：`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log('\n外观审计通过：浅色与深色主题对比度均达 WCAG AA，窄屏与 200% 缩放无横向溢出、无截断、点击目标均 ≥44px。')
