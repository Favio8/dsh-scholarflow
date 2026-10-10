// Real Draft/overlay with TEST_ONLY controlled task responses. No paid model or user files.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { sourceConflictFixture } from '../fixtures/source-conflict.ts'
import { snapshot } from '../../src/core/project/project.ts'
import { prepareWritingSourceConflict } from '../../src/core/pipeline/source-conflict.ts'

const out=resolve('.dsh-tmp/writing-source-conflict',String(Date.now()))
await mkdir(out,{recursive:true})
const fixture=await sourceConflictFixture(), project={...(await snapshot(fixture.io)),binding:{projectId:fixture.task.projectId,sessionId:'session_TEST_ONLY',workspaceId:'workspace_TEST_ONLY',rootFingerprint:'TEST_ONLY'}}
const preview=await prepareWritingSourceConflict(fixture.io,fixture.task)
const workspaceCss=(await readFile('src/client/plugin.tsx','utf8')).match(/const CSS = `([^`]+)`/)[1]
await build({stdin:{resolveDir:resolve('.'),loader:'tsx',contents:`
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Draft} from './src/client/draft.tsx'
import {THEME_CSS} from './src/client/theme/tokens.ts'
import {PAPER_CSS} from './src/client/paper-workspace.tsx'
import {OVERLAY_CSS} from './src/client/middle-overlay.tsx'
import {writingTaskAction} from './src/shared/writing-task.ts'
const project=${JSON.stringify(project)}
const question={id:'question_TEST_ONLY',kind:'failure',title:'TEST_ONLY duplicate preview',options:[],sourceConflict:${JSON.stringify(preview)}}
window.fixture={calls:[],staleQuestion:question}
const api=async (name,request)=>{
  if(name==='writingTask.inspect')return {task:{status:'waiting-input',questions:[window.fixture.staleQuestion]}}
  if(name==='writingTask.action'){
    writingTaskAction.parse(request); window.fixture.calls.push(request)
    await new Promise(done=>window.fixture.release=done)
    // Deliberately retain an old poll response to exercise answered-question suppression.
    return {task:{status:'queued',questions:[{...question,answered:request.answer}]}}
  }
  if(name==='editor.bufferRead')return {bufferHash:null}
  if(name==='cowrite.list')return {suggestions:[],briefs:[]}
  if(name==='runs.list')return {runs:[],revisions:[],diagnostics:[]}
  if(name==='skills.project')return {bindings:[],resources:[]}
  if(name==='draftSequence.inspect')return {}
  throw Error('TEST_ONLY unexpected call '+name)
}
createRoot(document.getElementById('app')).render(<div className="sf-app" style={{height:'100vh',width:'100%',display:'flex'}}>
  <style>{THEME_CSS+${JSON.stringify(workspaceCss)}+PAPER_CSS+OVERLAY_CSS}</style><div className="sf-body sf-paper-project" style={{width:'100%',height:'100vh',containerType:'inline-size'}}>
  <Draft project={project} api={api} context={()=>({requestId:'req_TEST_ONLY',sessionId:'session_TEST_ONLY',workspaceId:'workspace_TEST_ONLY'})}
    refresh={async()=>{}} run={fn=>void fn()} busy={false}/></div></div>)
`},bundle:true,platform:'browser',format:'iife',outfile:join(out,'app.js'),define:{__SF_KATEX_CSS__:'""'}})
const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html; charset=utf-8')
  res.end(req.url==='/app.js'?await readFile(join(out,'app.js')):'<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif}*{box-sizing:border-box}</style><div id="app"></div><script src="/app.js"></script>')
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:1100,height:900}}), errors=[], results=[]
page.on('pageerror',error=>errors.push(error.message))
try{
  await page.goto('http://127.0.0.1:'+server.address().port)
  const confirm=page.getByRole('button',{name:'分别保留并继续',exact:true})
  await expect(confirm).toBeVisible()
  await expect(confirm).toBeDisabled()
  await expect(page.getByText('reading-notes.md',{exact:true})).toBeVisible()
  await expect(page.getByText('正在读取：TEST_ONLY_Shared_Publication_Title.pdf',{exact:true})).toBeVisible()
  assert.equal(await page.getByRole('button',{name:'继续',exact:true}).count(),0)
  results.push('specific file comparison and required reason replace generic continue')
  for(const dark of [false,true]){
    await page.evaluate(value=>document.body.toggleAttribute('data-ds-dark-theme',value),dark)
    for(const width of [1100,390]){
      await page.setViewportSize({width,height:900})
      assert.equal(await page.locator('.sf-overlay').evaluate(el=>el.scrollWidth>el.clientWidth+1),false)
      await page.screenshot({path:join(out,'source-conflict-'+(dark?'dark':'light')+'-'+width+'.png')})
    }
  }
  results.push('file preview fits wide/narrow and light/dark layouts')
  await page.getByLabel('分别保留的理由',{exact:true}).fill('TEST_ONLY this PDF is the source paper; existing file is reading notes')
  await confirm.click()
  await expect(page.getByRole('button',{name:'正在确认…',exact:true})).toBeDisabled()
  await page.evaluate(()=>window.fixture.release())
  await expect(page.getByLabel('分别保留的理由',{exact:true})).toHaveCount(0)
  await page.waitForTimeout(3400)
  await expect(page.getByRole('button',{name:'分别保留并继续',exact:true})).toHaveCount(0)
  const calls=await page.evaluate(()=>window.fixture.calls)
  assert.equal(calls.length,1)
  assert.equal(calls[0].duplicateDecision,'keep-separate')
  assert.equal(calls[0].sourceConflictHash,preview.previewHash)
  results.push('single confirmed decision carries preview hash; stale poll does not reopen answered question')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({results,errors,evidence:out},null,2))
}finally{
  await writeFile(join(out,'report.json'),JSON.stringify({results,errors},null,2))
  await browser.close(); await new Promise(done=>server.close(done))
}
