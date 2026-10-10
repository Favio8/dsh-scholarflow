// Installed-host outline interaction and layout, with explicitly controlled model responses.
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

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const testHome = resolve('.dsh-tmp/preset-layout-host', String(Date.now()))
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

const child = spawn(join(install, 'DeepSeek Harness.exe'), ['--expose-internals',
  join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
  'p', '--no-open', '--port', '19401'], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const payload = body => body?.result?.value?.data ?? body?.result?.value ?? body
let page

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
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  const host = document.querySelector(selector)
  if (!host) return null
  const texts = [], targets = [], clipped = [], tiny = []
  for (const el of host.querySelectorAll('*')) {
    if (!visible(el)) continue
    const style = getComputedStyle(el)
    const own = [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).join('')
    if (own) {
      const colour = parseColour(style.color)
      const ratio = colour ? contrast(over(colour, backgroundOf(el)), backgroundOf(el)) : null
      const size = parseFloat(style.fontSize)
      const bold = parseInt(style.fontWeight, 10) >= 700
      // WCAG AA: 4.5:1 normal text, 3:1 for large (>=18.66px, or bold >=14px).
      const required = size >= 18.66 || (bold && size >= 14) ? 3 : 4.5
      if (ratio && ratio < required) texts.push({ text: own.slice(0, 28), ratio: +ratio.toFixed(2), required, size, colour: style.color })
      if (size < 11) tiny.push({ text: own.slice(0, 20), size })
    }
    if (el.matches('button,input,select,textarea,[role=button],[role=checkbox],[role=radio]')) {
      const rect = el.getBoundingClientRect()
      if (rect.height < 28 || rect.width < 24) targets.push({ tag: el.tagName.toLowerCase(), w: Math.round(rect.width), h: Math.round(rect.height), text: (el.innerText ?? '').slice(0, 16) })
    }
    if (el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible' && own) {
      clipped.push({ text: own.slice(0, 24), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
    }
  }
  const root = getComputedStyle(document.documentElement)
  return {
    contrastFailures: texts.sort((a, b) => a.ratio - b.ratio).slice(0, 8),
    contrastChecked: host.querySelectorAll('*').length,
    smallTargets: targets.slice(0, 8),
    clipped: clipped.slice(0, 6),
    tinyText: tiny.slice(0, 6),
    tokens: {
      bgBase: root.getPropertyValue('--dsw-alias-bg-base').trim(),
      bgLayer: root.getPropertyValue('--dsw-alias-bg-layer-1').trim(),
      labelSecondary: root.getPropertyValue('--dsw-alias-label-secondary').trim(),
      bodyColour: getComputedStyle(document.body).color,
      wizardBackground: getComputedStyle(host).backgroundColor
    }
  }
}

const report = {}
try {
  const url = await new Promise((done, reject) => {
    const t = setTimeout(() => reject(new Error('boot timeout')), 30000)
    let out = ''
    child.stdout.on('data', c => { out += c.toString(); const m = out.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/); if (m) { clearTimeout(t); done(m[1]) } })
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



  await page.route('**/api/scholarflow.v1/outline.suggest',async route=>{
    const body=route.request().postDataJSON()
    await route.fulfill({json:{type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{ok:true,data:{candidate:{candidateId:'cand_TEST_ONLY',sections:[{id:'s1',title:'TEST_ONLY',purpose:'TEST_ONLY',targetLength:1500,kind:'body',allocationMode:'auto'}],changes:[],coverage:[],gaps:[],conflicts:[]}}}}}})
  })
  await page.locator('#sf-field-requirements').fill('TEST_ONLY 预设布局检查')
  await page.getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('region',{name:'大纲候选'}).waitFor()
  await page.getByRole('button',{name:'参考预设',exact:true}).click()
  await page.locator('.sf-preset-row').first().waitFor()
  await page.locator('.sf-preset-row').first().click()
  const widths=process.argv.includes('--narrow-only')?[390]:[1440,720,390]
  report.expectedViews=widths.length*2
  report.views=[]
  for(const scheme of ['light','dark']) {
    await page.emulateMedia({colorScheme:scheme})
    for(const width of widths) {
      await page.setViewportSize({width,height:1050});await page.waitForTimeout(250)
      const rows=await page.locator('.sf-preset-row').evaluateAll(nodes=>nodes.map(el=>{
        const r=el.getBoundingClientRect(),title=el.querySelector('strong').getBoundingClientRect(),small=el.querySelector('small').getBoundingClientRect()
        return {height:r.height,gap:small.top-title.bottom,contentBottom:small.bottom-r.bottom,top:r.top,bottom:r.bottom,horizontalClipping:r.right>el.closest('.sf-preset-list').getBoundingClientRect().right||el.closest('.sf-preset-list').getBoundingClientRect().right>el.closest('.sf-preset-dialog').getBoundingClientRect().right}
      }))
      const checks={horizontalClipping:rows.some(r=>r.horizontalClipping),rowCount:rows.length,minHeight:Math.min(...rows.map(r=>r.height)),titleOverlap:rows.some(r=>r.gap<3),bottomClipping:rows.some(r=>r.contentBottom>0),rowOverlap:rows.some((r,i)=>i>0&&r.top-rows[i-1].bottom<7),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}
      report.views.push({scheme,width,...checks})
      await page.locator('.sf-preset-dialog').screenshot({path:resolve('.dsh-tmp/preset-host-'+scheme+'-'+width+'.png')})
    }
  }
} catch (error) {
  report.error = error.message
} finally {
  await writeFile(resolve('.dsh-tmp/preset-layout-internal.json'), JSON.stringify({ at: new Date().toISOString(), testHome, report }, null, 2))
  await page?.context().close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)) }
}



await writeFile(resolve('.dsh-tmp/preset-layout-report.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
if(report.error||report.views?.length!==report.expectedViews||report.views.some(r=>r.rowCount!==4||r.minHeight<76||r.horizontalClipping||r.titleOverlap||r.bottomClipping||r.rowOverlap||r.overflow))process.exitCode=1
