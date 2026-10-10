// Installed-host Draft and real inspect bridge. Explicit TEST_ONLY confirmation boundary.
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { sourceConflictFixture } from '../fixtures/source-conflict.ts'
import { saveWritingTask } from '../../src/core/pipeline/writing-task-store.ts'
import { writingTaskAction } from '../../src/shared/writing-task.ts'

const testHome=resolve('.dsh-tmp/writing-source-conflict-host',String(Date.now())), profile=join(testHome,'profiles/p'), root=join(testHome,'Workspace TEST_ONLY')
await mkdir(join(profile,'node_modules'),{recursive:true})
const fixture=await sourceConflictFixture()
fixture.task.status='waiting-input'; fixture.task.questions.push({id:'question_TEST_ONLY_legacy',kind:'failure',title:'TEST_ONLY old duplicate error',options:['继续']})
await saveWritingTask(fixture.io,fixture.task)
for(const [path,file] of fixture.io.files){const target=join(root,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,file.text)}
await writeFile(join(profile,'package.json'),JSON.stringify({private:true,dependencies:{'dsh-scholarflow':'link:'+resolve('.').replaceAll('\\','/')},
  dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-scholarflow']}}}))
await writeFile(join(profile,'cordis.yml'),'[]\n');await symlink(resolve('.'),join(profile,'node_modules/dsh-scholarflow'),'junction')
const install=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness')
const child=spawn(join(install,'DeepSeek Harness.exe'),['--expose-internals',join(install,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'p','--no-open','--port','0'],
  {env:{...process.env,DSH_HOME:testHome,ELECTRON_RUN_AS_NODE:'1',DSH_PERMISSION_MODE:'workspace-write'},windowsHide:true,stdio:['ignore','pipe','pipe']})
const ready=new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('boot timeout')),30000);let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();const match=output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);if(match){clearTimeout(timer);done(match[1])}});child.once('exit',code=>{clearTimeout(timer);reject(Error('exit '+code))})})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1000}}), results=[], errors=[], layouts=[]
page.on('pageerror',error=>errors.push(error.message))
try{
  await page.goto(await ready)
  const dismiss=async()=>{for(let i=0;i<3;i++){await page.waitForTimeout(350);const dialog=page.getByRole('dialog').first();if(!await dialog.count())break;const text=await dialog.innerText();if(text.startsWith('预览版说明'))await dialog.getByRole('button',{name:'继续',exact:true}).click();else if(text.startsWith('添加一个 API Key'))await dialog.getByRole('button',{name:'稍后配置',exact:true}).click();else break}}
  await dismiss()
  const rpc=(method,args)=>page.evaluate(async({method,args})=>{const r=await fetch('api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})});return (await r.json()).result.value},{method,args})
  await rpc('workspace/create',{request:{path:root}})
  await page.reload();await dismiss()
  await page.locator('button[aria-label="选择工作区"]').click().catch(()=>undefined)
  await page.waitForTimeout(700)
  await page.evaluate(()=>{const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0};const option=[...document.querySelectorAll('*')].filter(el=>visible(el)&&el.children.length===0&&(el.innerText??'').includes('Workspace TEST_ONLY')).at(-1);if(!option)throw Error('workspace menu absent');let target=option;for(let up=0;up<4&&target.parentElement;up++){if(target.tagName==='BUTTON'||target.getAttribute('role')==='menuitem'||String(target.className).includes('_item_'))break;target=target.parentElement}target.click()})
  await page.waitForTimeout(900)
  await page.locator('button[title="选择新任务使用的 Agent 预设"]').click()
  await page.locator('[class*="_item_"]').filter({hasText:/^ScholarFlow/}).click()
  const confirm=page.getByRole('button',{name:'分别保留并继续',exact:true})
  await expect(confirm).toBeVisible({timeout:15000})
  await expect(confirm).toBeDisabled()
  await expect(page.locator('.sf-overlay-question').getByText('reading-notes.md',{exact:true})).toBeVisible()
  assert.equal(await page.getByRole('button',{name:'继续',exact:true}).count(),0)
  results.push('real inspect upgrades legacy continue failure to specific files without writing')
  for(const scheme of ['light','dark']){await page.emulateMedia({colorScheme:scheme});for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.screenshot({path:join(testHome,'overlay-'+scheme+'-'+width+'.png')})
    const layout=await page.locator('.sf-overlay').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,overflow:[...el.querySelectorAll('*')].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>({tag:n.tagName,class:n.className,width:n.clientWidth,scroll:n.scrollWidth,whiteSpace:getComputedStyle(n).whiteSpace,text:n.innerText?.slice(0,30)}))}))
    layouts.push({scheme,width,layout})
    if(process.argv.includes('--diagnose-layout'))console.log(JSON.stringify({scheme,width,layout}))
    else assert.equal(layout.scrollWidth>layout.width+1,false)
  }}
  results.push(layouts.some(row=>row.layout.scrollWidth>row.layout.width+1)?'diagnostic geometry contains overflow':'installed overlay fits light/dark and wide/narrow viewports')
  let release, received, actions=0
  await page.route('**/api/scholarflow.v1/writingTask.action',async route=>{
    const body=route.request().postDataJSON();received=writingTaskAction.parse(body.payload.args.request);actions++
    await new Promise(done=>release=done)
    await route.fulfill({json:{type:'server-response',rpcId:body.rpcId,result:{ok:true,value:{ok:true,data:{task:{status:'queued'}}}}}})
  })
  await page.getByLabel('分别保留的理由',{exact:true}).fill('TEST_ONLY selected PDF is the paper; existing file is reading notes')
  await confirm.click()
  await expect(page.getByRole('button',{name:'正在确认…',exact:true})).toBeDisabled()
  assert.equal(received.duplicateDecision,'keep-separate');assert(received.sourceConflictHash)
  release()
  await expect(page.getByLabel('分别保留的理由',{exact:true})).toHaveCount(0)
  await page.waitForTimeout(3400)
  await expect(page.getByRole('button',{name:'分别保留并继续',exact:true})).toHaveCount(0)
  assert.equal(actions,1)
  results.push('single explicit decision, disabled while confirming; stale actual poll does not reopen question')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({results,errors,layouts,testHome,paidModelCalls:0},null,2))
}finally{await writeFile(join(testHome,'report.json'),JSON.stringify({results,errors,layouts},null,2));await browser.close();if(child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done))}}
