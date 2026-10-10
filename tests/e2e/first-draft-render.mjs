// Real React Draft and JSON decoder with controlled chunk delivery; no model calls.
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium,expect} from '@playwright/test'
import {createServer} from 'node:http'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {sourceConflictFixture} from '../fixtures/source-conflict.ts'
import {snapshot} from '../../src/core/project/project.ts'
import {digest} from '../../src/core/store/files.ts'
import {BodyStreamDecoder,DraftStreamCache} from '../../src/host/bridge/draft-streams.ts'

const out=resolve('.dsh-tmp/first-draft-render',String(Date.now()));await mkdir(out,{recursive:true})
const f=await sourceConflictFixture(),project={...(await snapshot(f.io)),binding:{projectId:f.task.projectId,sessionId:'session_test',workspaceId:'workspace_test',rootFingerprint:'TEST_ONLY'}}
project.document.text='# TEST_ONLY\n\n## TEST_ONLY analysis\n\n';project.document.contentHash=digest(project.document.text)
const task={id:f.task.id,projectId:f.task.projectId,sessionId:'session_test',mode:'first-draft',status:'running',stage:'drafting',revision:1,sectionIndex:0,sections:[{id:'s1',title:'TEST_ONLY analysis',kind:'body'}],expectedDocumentHash:project.document.contentHash}
const cache=new DraftStreamCache(),attempt=cache.begin({taskId:task.id,projectId:task.projectId,sessionId:task.sessionId,sectionId:'s1',title:'TEST_ONLY analysis',baseDocumentHash:project.document.contentHash,start:project.document.text.length,end:project.document.text.length})
const decoder=new BodyStreamDecoder(text=>cache.update(task.id,attempt,{text}));let emittedAt=0
const workspaceCss=(await readFile('src/client/plugin.tsx','utf8')).match(/const CSS = `([^`]+)`/)[1]
await build({stdin:{resolveDir:resolve('.'),loader:'tsx',contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{Draft}from'./src/client/draft.tsx';import{THEME_CSS}from'./src/client/theme/tokens.ts';import{PAPER_CSS}from'./src/client/paper-workspace.tsx';import{OVERLAY_CSS}from'./src/client/middle-overlay.tsx';
let project=${JSON.stringify(project)};const root=createRoot(document.getElementById('app'));
window.fixture={starts:0};const api=async(name,request)=>{
 if(name==='writingTask.watch'||name==='writingTask.stream'){return(await fetch('/frame')).json()}
 if(name==='writingTask.unwatch')return{};
 if(name==='writingTask.inspect')return{task:{mode:'first-draft',questions:[]}};
 if(name==='editor.bufferRead')return{bufferHash:null};if(name==='cowrite.list')return{suggestions:[],briefs:[]};if(name==='runs.list')return{runs:[],diagnostics:[]};if(name==='skills.project')return{resources:[]};if(name==='draftSequence.inspect')return{};throw Error('TEST_ONLY unexpected '+name)
};const mount=()=>root.render(<div className="sf-app" style={{height:'100vh',width:'100%',display:'flex'}}><style>{THEME_CSS+${JSON.stringify(workspaceCss)}+PAPER_CSS+OVERLAY_CSS}</style><div className="sf-body sf-paper-project" style={{height:'100vh',width:'100%'}}><Draft project={project} generationMode="first-draft" api={api} context={()=>({requestId:'req_test',workspaceId:'workspace_test',sessionId:'session_test',projectId:project.binding.projectId})} refresh={async()=>{project=(await(await fetch('/project')).json());mount()}} run={fn=>void fn()} busy={false} view="preview"/></div></div>);mount()
`},outfile:join(out,'app.js'),bundle:true,platform:'browser',format:'iife',define:{__SF_KATEX_CSS__:'""'}})
const server=createServer(async(req,res)=>{
 if(req.url==='/frame'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({watchId:'watch_test',task,preview:cache.peek(task.id)}));return}
 if(req.url==='/project'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(project));return}
 if(req.url==='/emit'){emittedAt=Date.now();decoder.write('{"replacementText":"第一段流式正文');res.end('ok');return}
 res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/app.js'?await readFile(join(out,'app.js')):'<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif}*{box-sizing:border-box}</style><div id="app"></div><script src="/app.js"></script>')
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[],results=[]
page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto('http://127.0.0.1:'+server.address().port)
 await expect(page.locator('.sf-stream-status')).toBeVisible()
 await page.evaluate(()=>{window.firstVisible=0;new MutationObserver(()=>{if(!window.firstVisible&&document.querySelector('.sf-paper-page')?.textContent.includes('第一段流式正文'))window.firstVisible=Date.now()}).observe(document.getElementById('app'),{subtree:true,childList:true,characterData:true})})
 await page.evaluate(()=>fetch('/emit'))
 await expect(page.locator('.sf-paper-page')).toContainText('第一段流式正文')
 const latency=await page.evaluate(()=>window.firstVisible)-emittedAt;assert(latency>=0&&latency<=500,'first decoded delta to paint '+latency+'ms')
 assert.equal(project.document.text.includes('第一段'),false)
 assert.equal(await page.locator('.sf-overlay-question').count(),0)
 results.push({name:'real partial decoder to preview before JSON completion',latencyMs:latency})
 // A long streaming paragraph/section must yield scrolling rather than forcing follow.
 decoder.write('\\n\\n'+('后续段落内容。'.repeat(60)+'\\n\\n').repeat(10))
 await expect(page.locator('.sf-paper-page')).toContainText('后续段落内容')
 const scroll=page.locator('.sf-preview-pane .sf-paper-scroll')
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))})
 await scroll.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'))})
 await expect(page.getByRole('button',{name:'回到正在生成处',exact:true})).toBeVisible()
 decoder.write('新的段落增量');await page.waitForTimeout(300)
 assert.equal(await scroll.evaluate(el=>el.scrollTop),0)
 await page.getByRole('button',{name:'回到正在生成处',exact:true}).click()
 results.push({name:'upward reading stops follow, explicit return restores it'})
 for(const dark of [false,true]){await page.evaluate(dark=>document.body.toggleAttribute('data-ds-dark-theme',dark),dark);for(const width of [1100,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:join(out,'stream-'+(dark?'dark':'light')+'-'+width+'.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}}
 results.push({name:'light/dark wide/narrow preview fits'})
 cache.update(task.id,attempt,{status:'paused'});task.status='paused';task.revision++
 await expect(page.locator('.sf-unfinished-preview')).toBeVisible()
 assert.equal(await page.getByRole('textbox',{name:'Markdown 手工编辑',exact:true}).isDisabled(),false)
 await page.reload();await expect(page.locator('.sf-unfinished-preview')).toBeVisible()
 results.push({name:'paused cache survives reload and editing is restored without model dispatch'})
 assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors,out},null,2))
}finally{await writeFile(join(out,'report.json'),JSON.stringify({results,errors},null,2));await browser.close();await new Promise(done=>server.close(done))}
