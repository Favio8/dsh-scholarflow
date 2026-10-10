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
    if (window.fixture.mode === 'provider-error') throw Object.assign(new Error('当前模型服务正在限流，请稍后重试。'),{code:'RATE_LIMIT',details:{provider:'TEST_ONLY',model:'fixture',status:429,runId:'run_test'}})
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
 await page.goto('http://127.0.0.1:'+server.address().port)
 await reset({cover:{enabled:true,title:'TEST_ONLY 封面',date:'',fields:[{label:'姓名',value:''},{label:'学号',value:''}]}})
 await page.evaluate(()=>window.fixture.mode='late')
 await expect(button('停止生成')).toBeVisible()
 for(let i=0;i<5;i++) { await page.getByRole('textbox',{name:'姓名',exact:true}).fill('TEST_ONLY_'+i); await page.waitForTimeout(600) }
 assert.equal(await outlineCalls(),1)
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(r=>r.name==='outline.stop').length),0)
 await page.evaluate(()=>window.fixture.release())
 await expect(page.getByRole('region',{name:'大纲候选'})).toBeVisible()
 await expect(button('采用此大纲')).toBeEnabled()
 await button('采用此大纲').click()
 await expect(page.getByRole('textbox',{name:'姓名',exact:true})).toHaveValue('TEST_ONLY_4')
 await page.getByRole('textbox',{name:'学号',exact:true}).fill('2026001')
 await page.waitForTimeout(650)
 await expect(page.getByText('结构已确认',{exact:true})).toBeVisible()
 assert.equal(await outlineCalls(),1)
 pass('cover typing during and after generation does not cancel, repeat or invalidate the candidate')
 await reset(); await page.evaluate(()=>window.fixture.mode='provider-error')
 await expect(page.getByRole('alert')).toContainText('限流')
 await page.getByText('查看详情',{exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('RATE_LIMIT')
 await expect(page.getByRole('alert')).toContainText('429')
 pass('provider code and HTTP status are actually reachable in the wizard details')
 await reset(); await page.evaluate(()=>window.fixture.mode='late')
 await expect(button('停止生成')).toBeVisible()
 await button('停止生成').click()
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(r=>r.name==='outline.stop').length),1)
 await page.evaluate(()=>window.fixture.release())
 await expect(button('重新按要求生成')).toBeEnabled()
 await expect(page.getByRole('region',{name:'大纲候选'})).toHaveCount(0)
 pass('stop sends a host operation cancellation and discards a late response')
 assert.deepEqual(errors,[])
}finally{ await browser.close();await new Promise(done=>server.close(done)) }
