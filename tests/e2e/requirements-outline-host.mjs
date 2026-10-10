// Installed-host outline interaction and layout, with explicitly controlled model responses.
//
// Aesthetic judgement needs eyes; legibility does not. This drives the real client and measures
// what can be measured: contrast against the effective background, whether the surfaces follow
// the host theme instead of hardcoding light colours, interactive target sizes at narrow widths,
// text clipping, and font sizes below a readable floor. Findings are numbers, so a regression
// shows up as a number rather than as an opinion.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { requirementDraftSpec } from '../../src/shared/writing-task.ts'
import { validateGeneration, assessOutline, outlineDocumentPlan, outlineCandidateKey } from '../../src/core/requirements/outline.ts'

const install = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const testHome = resolve('.dsh-tmp/outline-host', String(Date.now()))
const profile = join(testHome, 'profiles/p')
const root = join(testHome, '工作区 TEST_ONLY')
await mkdir(join(profile, 'node_modules'), { recursive: true })
await mkdir(join(root, '课程要求'), { recursive: true })
await writeFile(join(root, 'TEST_ONLY 作业说明.md'), 'TEST_ONLY 要求：四页，第一页封面。\n')
await writeFile(join(root, '课程要求', 'TEST_ONLY 评分标准.md'), 'TEST_ONLY 评分标准。\n')
await writeFile(join(root, 'TEST_ONLY 无法解析.bin'), new Uint8Array([0, 255, 13, 10]))
// Mirrors the actual collision: prior exports, without an initialized ScholarFlow project.
await mkdir(join(root,'manuscript/exports/delivery_TEST_ONLY'),{recursive:true})
await writeFile(join(root,'manuscript/exports/delivery_TEST_ONLY/old.md'),'TEST_ONLY previous export must remain unchanged')
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


  const titles = ['论文题名的定位作用','作者与通讯信息','原论文摘要的组织','引言的问题提出','相关工作的承接','方法的组织逻辑','实验结果的呈现','讨论与结论的呼应','原论文参考文献的作用']
  const lengths = [120,80,160,160,170,260,200,210,140]
  let candidate = { candidateId:'cand_TEST_ONLY',taskSummary:'TEST_ONLY 阅读指定论文，着重分析九个组成部分的组织方式及其承接关系。',targetLength:1500,
    sections:titles.map((title,i)=>({id:'s'+i,title,targetLength:lengths[i],purpose:'分析本节如何承接前文并支撑后文。',kind:'body',allocationMode:'auto'})),
    changes:[],coverage:[],gaps:[],conflicts:[] }
  report.modelFixture = true
  report.outlineRequests = 0
  await page.route('**/api/scholarflow.v1/outline.suggest',async route=>{
    report.outlineRequests++
    const body=route.request().postDataJSON()
    const spec=requirementDraftSpec.parse(body.payload.args.request.spec)
    const requirements=['分析结构与承接关系','封面一页','内容三页','星期五提交','解释材料局限']
    const generated=validateGeneration({taskSummary:candidate.taskSummary,targetLength:1500,sections:candidate.sections,
      requirements:requirements.map((text,i)=>({id:'r'+(i+1),text,quote:text}))},spec)
    const assessed=assessOutline(generated,{coverage:[
      {itemId:'r1',scope:'sections',sectionIds:['s0'],status:'covered',reason:'TEST_ONLY 章节规划分析结构与关系。'},
      {itemId:'r2',sectionIds:[],status:'covered',reason:'TEST_ONLY 旧格式没有设置证据。'},
      {itemId:'r3',scope:'document',documentFields:['requestedPages'],sectionIds:[],status:'covered',reason:'TEST_ONLY 尚未分页。'},
      {itemId:'r4',scope:'submission',sectionIds:[],status:'covered',reason:'TEST_ONLY 保留提交要求。'},
      {itemId:'r5',scope:'sections',sectionIds:[],status:'missing',reason:'TEST_ONLY 没有安排局限分析。'},
    ],issues:[]},outlineDocumentPlan(spec,generated))
    candidate={...candidate,...assessed,inputSpecJson:outlineCandidateKey(spec)}
    report.coverage=assessed.coverage.map(row=>({scope:row.scope,status:row.status,sectionIds:row.sectionIds}))
    await route.fulfill({json:{type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{ok:true,data:{candidate}}}}})
  })
  await page.route('**/api/scholarflow.v1/candidates.adopt',async route=>{
    const body=route.request().postDataJSON(),input=body.payload.args.request
    const spec={...input.spec,sections:candidate.sections,targetLength:1500,structureOrigin:'generated',targetLengthOrigin:'requirements'}
    await route.fulfill({json:{type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{ok:true,data:{spec}}}}})
  })
  await page.locator('#sf-field-title').fill('TEST_ONLY 科技论文阅读报告')
  await page.locator('#sf-field-requirements').fill('阅读指定科技论文，着重分析结构与承接关系，约1500字，封面一页、内容三页。星期五提交。解释材料局限。')
  await page.getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('region',{name:'大纲候选'}).waitFor()
  await page.locator('.sf-outline-review>summary').first().click()
  assert.equal(await page.locator('.sf-coverage-pending').count(),3)
  assert.equal(await page.getByText(/缺口：解释材料局限/).count(),1)
  assert.equal(await page.getByText(/缺口：封面一页|缺口：内容三页|缺口：星期五提交/).count(),0)
  assert.deepEqual(report.coverage.map(row=>row.status),['covered','pending','pending','pending','missing'])
  report.candidateViews=[]
  for(const scheme of ['light','dark']) {
    await page.emulateMedia({colorScheme:scheme})
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1050})
      const audit=await page.evaluate(auditInPage,'[aria-label="创建论文向导"]')
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
      report.candidateViews.push({scheme,width,overflow,contrastFailures:audit.contrastFailures})
      await page.screenshot({path:resolve('.dsh-tmp/scoped-coverage-host-'+scheme+'-'+width+'.png')})
    }
  }
  report.noAutomaticTemplate = await page.locator('.sf-outline-edit-row').count() === 0
  await page.getByRole('button',{name:'采用此大纲',exact:true}).click()
  await page.locator('.sf-outline-edit-row').first().waitFor()
  report.adoptedRows = await page.locator('.sf-outline-edit-row').count()
  assert.equal(await page.getByRole('button',{name:'创建论文并开始撰写',exact:true}).isEnabled(),true)
  report.creationEnabled=true
  await page.getByRole('button',{name:'创建论文并开始撰写',exact:true}).click()
  const errorNotice=page.locator('.sf-wizard-error')
  await errorNotice.waitFor()
  await errorNotice.getByText('查看详情',{exact:true}).click()
  assert((await errorNotice.innerText()).includes('OUTPUT_PATH_CONFLICT'))
  assert((await errorNotice.innerText()).includes('manuscript/exports'))
  await page.getByRole('button',{name:'使用新目录 manuscript-2',exact:true}).waitFor()
  assert.equal(await page.getByRole('textbox',{name:'论文输出目录',exact:true}).inputValue(),'manuscript')
  await page.getByRole('button',{name:'使用新目录 manuscript-2',exact:true}).click()
  assert.equal(await page.getByRole('textbox',{name:'论文输出目录',exact:true}).inputValue(),'manuscript-2')
  assert.equal(await page.locator('.sf-wizard-error').count(),0)
  assert.equal(await readFile(join(root,'manuscript/exports/delivery_TEST_ONLY/old.md'),'utf8'),'TEST_ONLY previous export must remain unchanged')
  // Real prepare bridge, but stop at the paid launch boundary. This is not full drafting.
  let selectedPlan
  await page.route('**/api/scholarflow.v1/creation.start',async route=>{
    const body=route.request().postDataJSON()
    selectedPlan=body.payload.args.request
    await route.fulfill({json:{type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{ok:false,error:{code:'TEST_ONLY_STOP_BEFORE_MODEL',message:'TEST_ONLY 已准备新目录，停止在付费模型之前。',details:{}}}}}})
  })
  await page.getByRole('button',{name:'创建论文并开始撰写',exact:true}).click()
  await page.getByText('TEST_ONLY 已准备新目录，停止在付费模型之前。',{exact:true}).waitFor()
  assert(selectedPlan?.planId && selectedPlan.planHash)
  assert.equal(report.outlineRequests,1,'changing only output keeps adopted structure, without regeneration')
  report.outputCollision={detailVisible:true,userSelected:'manuscript-2',reprepared:true,oldExportUnchanged:true,paidModelCalls:0}
  await page.getByRole('button',{name:'上一步',exact:true}).click()
  await page.getByRole('button',{name:'下一步',exact:true}).click()
  await page.waitForTimeout(700)
  report.views=[]
  for (const scheme of ['light','dark']) {
    await page.emulateMedia({colorScheme:scheme})
    for (const width of [1440,720,390]) {
      await page.setViewportSize({width,height:1050}); await page.waitForTimeout(300)
      const audit = await page.evaluate(auditInPage,'[aria-label="创建论文向导"]')
      const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
      await page.locator('.sf-wizard-header-compact').scrollIntoViewIfNeeded()
      await page.screenshot({path:resolve('.dsh-tmp/outline-host-'+scheme+'-'+width+'.png')})
      report.views.push({scheme,width,overflow,contrastFailures:audit.contrastFailures,clipped:audit.clipped})
    }
  }
} catch (error) {
  report.error = error.message
} finally {
  await writeFile(resolve('.dsh-tmp/outline-host-internal.json'), JSON.stringify({ at: new Date().toISOString(), testHome, report }, null, 2))
  await page?.context().close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)) }
}


await writeFile(resolve('.dsh-tmp/outline-host-report.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
if(report.error || !report.outputCollision?.reprepared || report.outlineRequests !== 1 || !report.noAutomaticTemplate || report.adoptedRows !== 9 || !report.creationEnabled || report.candidateViews?.length!==4 || report.candidateViews.some(row=>row.overflow||row.contrastFailures.length) || report.views?.length !== 6 || report.views.some(row=>row.overflow||row.contrastFailures.length)) process.exitCode=1
