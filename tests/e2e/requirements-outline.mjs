// Real React wizard + controlled service responses. No model calls or user workspace access.
// Exercises automatic outlining, semantic candidates, stale input protection and structure layouts.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const out = resolve('.dsh-tmp/requirements-outline', String(Date.now()))
await mkdir(out, { recursive: true })
// Include the actual parent fallback styles: a standalone wizard misses their specificity.
const workspaceCss = (await readFile('src/client/plugin.tsx', 'utf8')).match(/const CSS = `([^`]+)`/)[1]
await build({ stdin: { resolveDir: resolve('.'), loader: 'tsx', contents: `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { CreationWizard, WIZARD_CSS } from './src/client/creation-wizard.tsx'
import { THEME_CSS } from './src/client/theme/tokens.ts'
import { PAPER_CSS } from './src/client/paper-workspace.tsx'
import { requirementDraftSpec, requirementBrief } from './src/shared/writing-task.ts'

const files = []
const base = { title: 'TEST_ONLY 报告', requirements: '阅读指定科技论文，分析结构及承接关系，约1500字。', type: 'course-paper', language: 'zh-CN', format: 'docx',
  materials: [], online: false, targetLength: 4000, sections: [], manuscriptDir: 'manuscript' }
const titles = ['论文题名的定位作用','作者与通讯信息','原论文摘要的组织','引言的问题提出','相关工作的承接','方法的组织逻辑','实验结果的呈现','讨论与结论的呼应','原论文参考文献的作用']
const lengths = [120,80,160,160,170,260,200,210,140]
window.fixture = { calls: [], mode: 'ready', release: null, template: titles.map((title,i) => ({id:'s'+i,title,targetLength:lengths[i],purpose:'TEST_ONLY 分析这一部分如何承接前文、引出后文，不复述原文。',kind:'body',allocationMode:'auto'})) }
let candidate
const api = async (name, request) => {
  window.fixture.calls.push({ name, request })
  if (name === 'creation.materials') return { files }
  if (name === 'outline.stop') return { stopped: true }
  if (name === 'presets.list') return { all: [], byType: {} }
  if (request?.spec) requirementDraftSpec.parse(request.spec)
  if (name === 'outline.suggest') {
    if (window.fixture.mode === 'fail') throw new Error('TEST_ONLY 模型暂时不可用，请重试。')
    const template = structuredClone(window.fixture.template)
    if (window.fixture.mode === 'late') await new Promise(done => window.fixture.release = done)
    candidate = { candidateId: 'cand_TEST_ONLY', sections: template, targetLength: template.reduce((sum,row)=>sum+row.targetLength,0),
      taskSummary: 'TEST_ONLY 根据本次要求分析对象的结构及其关系，而非套用议论文模板。', changes:[],coverage:[],gaps:[],conflicts:[] }
    return { candidate }
  }
  if (name === 'candidates.adopt') return { spec: { ...request.spec, sections: candidate.sections, targetLength: candidate.targetLength, structureOrigin:'generated', targetLengthOrigin:'requirements' } }
  if (name === 'candidates.discard') return { state:'discarded' }
  throw new Error('Unexpected fixture call: ' + name)
}
const root = createRoot(document.getElementById('app'))
const mount = scope => root.render(<div className="sf-app" style={{width:'100%'}}><style>{THEME_CSS + ${JSON.stringify(workspaceCss)} + PAPER_CSS + WIZARD_CSS}</style><div className="sf-body sf-paper-project"><CreationWizard key={scope} scope={scope} api={api}
  context={() => ({workspaceId:'TEST_ONLY',sessionId:'TEST_ONLY'})} workspaceTitle="TEST_ONLY" onCreated={()=>{}} /></div></div>)
window.resetWizard = (spec = {}, step = 2) => {
  const scope = crypto.randomUUID()
  window.fixture.calls=[]; window.fixture.mode='ready'
  sessionStorage.setItem('active',scope)
  localStorage.setItem('scholarflow:creation:'+scope,JSON.stringify({spec:{...base,...spec},step}))
  mount(scope)
}
const existing = sessionStorage.getItem('active')
if (existing) mount(existing); else window.resetWizard()
` }, bundle: true, platform: 'browser', format: 'iife', outfile: join(out, 'app.js'),
  define: { __SF_KATEX_CSS__: '""' } })
const html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif}#app{display:flex;min-height:100vh}*{box-sizing:border-box}</style><div id="app"></div><script src="/app.js"></script>'
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html; charset=utf-8')
  res.end(req.url === '/app.js' ? await readFile(join(out, 'app.js')) : html)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
const errors = [], results = []
page.on('pageerror', error => errors.push(error.message))
const pass = name => { results.push(name); console.log('PASS ' + name) }
const button = name => page.getByRole('button', { name, exact: true })
const reset = async (spec = {}, step = 2) => {
  await page.evaluate(({ spec, step }) => window.resetWizard(spec, step), { spec, step })
  await expect(page.locator('.sf-wizard-page')).toBeVisible()
}
const outlineCalls = () => page.evaluate(() => window.fixture.calls.filter(row => row.name === 'outline.suggest').length)
try {
  await page.goto('http://127.0.0.1:' + server.address().port)
  await expect(page.getByRole('region', {name:'大纲候选'})).toBeVisible()
  assert.equal(await outlineCalls(),1)
  await expect(page.locator('.sf-outline-edit-row')).toHaveCount(0)
  assert.equal(await page.getByText('反方观点与回应', {exact:true}).count(),0)
  await button('采用此大纲').click()
  await expect(page.locator('.sf-outline-edit-row')).toHaveCount(9)
  await expect(page.getByRole('spinbutton',{name:'目标篇幅',exact:true})).toHaveValue('1500')
  await expect(page.getByText('结构已确认',{exact:true})).toBeVisible()
  pass('automatically generates once and only adoption replaces the structure and target')
  await button('上一步').click(); await button('下一步').click()
  await page.waitForTimeout(650)
  assert.equal(await outlineCalls(),1)
  await page.reload()
  await expect(page.locator('.sf-outline-edit-row')).toHaveCount(9)
  await page.waitForTimeout(650)
  assert.equal(await outlineCalls(),0)
  pass('returning and refreshing an accepted draft never replay the model request')
  for (const dark of [false,true]) {
    await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme',dark),dark)
    for (const width of [1100,390]) {
      await page.setViewportSize({width,height:1050})
      await page.locator('.sf-outline-purpose>summary').first().click()
      await expect(page.getByRole('textbox',{name:'第1章写作内容',exact:true})).toBeVisible()
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
      assert.equal(await page.locator('.sf-outline-title').first().evaluate(el=>getComputedStyle(el).color),dark?'rgb(249, 250, 251)':'rgb(15, 17, 21)')
      await page.locator('.sf-wizard').screenshot({path:join(out,'outline-'+(dark?'dark':'light')+'-'+width+'.png')})
      await page.locator('.sf-outline-purpose>summary').first().click()
    }
  }
  pass('editable structure fits light/dark and narrow/wide layouts with expandable purpose')
  await page.setViewportSize({width:1100,height:1050})
  await reset()
  await page.evaluate(()=>window.fixture.mode='fail')
  await expect(page.getByRole('alert')).toContainText('模型暂时不可用')
  assert.equal(await outlineCalls(),1)
  await page.waitForTimeout(650); assert.equal(await outlineCalls(),1)
  await page.evaluate(()=>window.fixture.mode='ready')
  await button('重新按要求生成').click()
  await expect(page.getByRole('region',{name:'大纲候选'})).toBeVisible()
  assert.equal(await outlineCalls(),2)
  pass('failure does not loop; explicit retry generates a fresh candidate')
  await reset()
  await page.evaluate(()=>window.fixture.mode='late')
  await expect(button('停止生成')).toBeVisible()
  await button('停止生成').click()
  await page.evaluate(()=>window.fixture.release())
  await expect(button('重新按要求生成')).toBeEnabled()
  await expect(page.getByRole('region',{name:'大纲候选'})).toHaveCount(0)
  await page.waitForTimeout(650); assert.equal(await outlineCalls(),1)
  pass('cancellation discards late output without automatic replay')
  const old = [{id:'old',title:'我手工保留的章节',purpose:'原有重点',targetLength:1500,kind:'body',allocationMode:'manual'}]
  await reset({sections:old,structureOrigin:'manual'})
  await page.evaluate(()=>window.fixture.mode='late')
  await expect(button('停止生成')).toBeVisible()
  await page.getByRole('textbox',{name:'第1章标题',exact:true}).fill('生成期间的新修改')
  await page.evaluate(()=>window.fixture.release())
  await expect(button('重新按要求生成')).toBeEnabled()
  await expect(page.getByRole('textbox',{name:'第1章标题',exact:true})).toHaveValue('生成期间的新修改')
  await expect(page.getByRole('region',{name:'大纲候选'})).toHaveCount(0)
  pass('existing manual structure and concurrent edits survive a late model response')
  await button('上一步').click(); await button('上一步').click()
  await page.locator('#sf-field-requirements').fill('比较小说叙事视角，约1200字')
  await page.evaluate(()=>{window.fixture.mode='ready';window.fixture.template=[{id:'n1',title:'叙事视角与距离',purpose:'比较不同视角带来的理解差异。',targetLength:1200,kind:'body',allocationMode:'auto'}]})
  await button('下一步').click(); await button('下一步').click()
  await expect(page.getByRole('region',{name:'大纲候选'})).toContainText('叙事视角与距离')
  await button('采用此大纲').click()
  await expect(page.locator('.sf-outline-edit-row')).toHaveCount(1)
  await expect(page.getByRole('spinbutton',{name:'目标篇幅',exact:true})).toHaveValue('1200')
  pass('changed task generates different model-proposed content, never a fixed nine-section template')

  await button('撤销结构编辑').click()
  await expect(page.getByText('结构已确认',{exact:true})).toHaveCount(0)
  const beforeUndo = await outlineCalls()
  await page.waitForTimeout(650)
  assert.equal(await outlineCalls(),beforeUndo)
  pass('undo invalidates confirmation without automatically regenerating')
  await reset({requirements:'旧任务',brief:{task:{nature:'旧任务性质'},coverage:[{id:'old_req',text:'旧要求',kind:'dimension'}],length:{value:4000},format:{},submission:{},decisions:[],origins:{},readIds:[]}},0)
  await page.locator('#sf-field-requirements').fill('新任务：比较叙事视角')
  const snapshot = await page.evaluate(()=>JSON.parse(localStorage.getItem('scholarflow:creation:'+sessionStorage.getItem('active'))))
  assert.equal(snapshot.spec.brief,undefined)
  await button('下一步').click(); await button('下一步').click()
  await expect(page.getByRole('region',{name:'大纲候选'})).toBeVisible()
  const request=await page.evaluate(()=>window.fixture.calls.find(row=>row.name==='outline.suggest').request)
  assert(!request.spec.brief?.task?.nature)
  assert.equal(request.spec.brief?.coverage?.length??0,0)
  assert(!request.spec.brief?.length?.value)
  pass('edited requirements drop the stale brief before model dispatch')
  await reset()
  await page.evaluate(()=>window.fixture.mode='late')
  await expect(button('停止生成')).toBeVisible()
  const marker=await page.evaluate(()=>JSON.parse(localStorage.getItem('scholarflow:creation:'+sessionStorage.getItem('active'))).attemptedOutline)
  assert(marker)
  await button('上一步').click()
  await page.evaluate(()=>window.fixture.release())
  await expect(button('下一步')).toBeEnabled()
  await button('下一步').click(); await page.waitForTimeout(650)
  assert.equal(await outlineCalls(),1)
  await expect(page.getByRole('region',{name:'大纲候选'})).toHaveCount(0)
  pass('leaving the step cancels late output and the persisted marker prevents replay')
  assert.deepEqual(errors,[])
  console.log(results.length+' checks passed; evidence: '+out)
} finally {
  await writeFile(join(out,'report.json'),JSON.stringify({results,errors},null,2))
  await browser.close(); await new Promise(done=>server.close(done))
}
