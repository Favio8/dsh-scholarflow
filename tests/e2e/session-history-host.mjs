// TEST_ONLY projects, actual packaged Desktop host and production plugin; no model requests.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,writeFile,readFile,symlink,rm,readdir} from 'node:fs/promises'
import {join,resolve,dirname,relative} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {sourceConflictFixture} from '../fixtures/source-conflict.ts'
import {saveWritingTask} from '../../src/core/pipeline/writing-task-store.ts'

const continuation=process.argv.indexOf('--continue')
const recoveryOnly=process.argv.includes('--recovery-only')
const legacyIndex=process.argv.indexOf('--legacy-root')
const legacyInstall=legacyIndex>=0?resolve(process.argv[legacyIndex+1]):null
const install=resolve(process.argv[2]),out=continuation>=0?resolve(process.argv[continuation+1]):resolve('.dsh-tmp/session-history-host',String(Date.now()))
const bounded=relative(resolve('.dsh-tmp/session-history-host'),out)
assert(bounded&&!bounded.startsWith('..'))
const workspace=join(out,'Workspace TEST_ONLY'),profile=join(out,'profiles/p'),repo=resolve('.')
await mkdir(join(profile,'node_modules'),{recursive:true});await mkdir(workspace,{recursive:true})
await writeFile(join(profile,'package.json'),JSON.stringify({private:true,dependencies:{'dsh-scholarflow':'link:'+repo.replaceAll('\\','/')},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-scholarflow']}}}))
await writeFile(join(profile,'cordis.yml'),'[]\n');try{await symlink(repo,join(profile,'node_modules/dsh-scholarflow'),'junction')}catch(error){if(error.code!=='EEXIST')throw error}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}})
let host,hostLog='',base,sessionId,workspaceId
const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
const pass=name=>{results.push(name);console.log('PASS '+name)}
async function boot(root=install){
 const exe=join(root,'DeepSeek Harness.exe'),cli=join(root,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
 host=spawn(exe,['--expose-internals',cli,'p','--no-open','--port','0'],{env:{...process.env,DSH_HOME:out,ELECTRON_RUN_AS_NODE:'1',DSH_PERMISSION_MODE:'workspace-write'},windowsHide:true,stdio:['ignore','pipe','pipe']})
 const ready=new Promise((done,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('TEST_ONLY boot timeout')),30000);host.stdout.on('data',chunk=>{text+=chunk;hostLog+=chunk;const m=text.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);if(m){clearTimeout(timer);done(m[1])}});host.stderr.on('data',chunk=>hostLog+=chunk);host.once('exit',code=>{clearTimeout(timer);reject(Error('TEST_ONLY boot exit '+code))})})
 base=await ready;await page.goto(base)
}
async function stop(){if(host&&host.exitCode===null){const current=host;current.kill();await new Promise(done=>current.once('exit',done))}}
const rpc=(method,args)=>page.evaluate(async({method,args})=>{const response=await fetch('api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})});const r=(await response.json()).result;if(!r.ok||r.value?.ok===false)throw Error(JSON.stringify(r.error??r.value.error));return r.value?.data??r.value},{method,args})
const context=()=>({requestId:'req_TEST_ONLY_'+Date.now(),workspaceId,sessionId})
const historyPage=async()=>{
 const projections=await rpc('session/projections',{request:{sessionId}})
 return rpc('session/page',{request:{address:{kind:'session',sessionId},throughSeq:projections.asOfSeq}})
}
try{
 const originalInstall=legacyInstall
 if(continuation<0&&!originalInstall)throw Error('Pass --legacy-root with the unmodified rc.2 package; the current installation may already be repaired.')
 if(continuation<0)await boot(originalInstall);else await boot()
 if(continuation>=0){
   const catalog=JSON.parse(await readFile(join(out,'storages/workspace.json'),'utf8'))
   workspaceId=Object.entries(catalog.tables.workspaces).find(([,value])=>value.path===workspace)[0]
   const current=JSON.parse(await readFile(join(workspace,'.scholarflow/writing/current.json'),'utf8'))
   sessionId=JSON.parse(await readFile(join(workspace,'.scholarflow/writing/tasks',current.taskId+'.json'),'utf8')).sessionId
   results.push(...JSON.parse(await readFile(join(out,'report.json'),'utf8')).results)
 }else{
   workspaceId=(await rpc('workspace/create',{request:{path:workspace}})).workspace.workspaceId
   sessionId=(await rpc('session/create',{request:{workspaceId,agentPreset:'scholarflow'}})).sessionId
   const f=await sourceConflictFixture(false);f.task.sessionId=sessionId;f.task.status='paused';await saveWritingTask(f.io,f.task)
   for(const [path,file]of f.io.files){const target=resolve(workspace,path);assert(!relative(workspace,target).startsWith('..'));await mkdir(dirname(target),{recursive:true});await writeFile(target,file.text)}
 }
 const paper=await readFile(join(workspace,'manuscript/paper.md'))
 if(process.argv.includes('--ui-only')){
   await page.getByText('预览版说明',{exact:true}).waitFor({state:'visible',timeout:3000}).catch(()=>{})
   if(await page.getByText('预览版说明',{exact:true}).isVisible())await page.locator('[role="presentation"]').filter({hasText:'预览版说明'}).getByRole('button',{name:'继续',exact:true}).click()
   // Bind to the keyless fixture's specific onboarding action. A generic first
   // dialog locator can change identity while React replaces the notice portal.
   const skipKey=page.getByRole('button',{name:'稍后配置',exact:true})
   await skipKey.waitFor({state:'visible'});await skipKey.click()
   const workspaceRow=page.locator('[data-row-key="workspace:'+workspaceId+'"]')
   await workspaceRow.waitFor({state:'visible'})
   if(await workspaceRow.count()&&await workspaceRow.getAttribute('aria-expanded')==='false')await workspaceRow.click()
   await expect(page.getByText('TEST_ONLY renamed paper',{exact:true}).first()).toBeVisible()
   await page.getByText('TEST_ONLY renamed paper',{exact:true}).first().click()
   await expect(page.locator('.sf-project')).toHaveAttribute('data-sf-session-id',sessionId)
   await expect(page.locator('.sf-paper-title')).toHaveText('TEST_ONLY latest project title')
   await page.screenshot({path:join(out,'native-sidebar.png')})
   pass('native sidebar renders the persistent manual name and opens the same paper session')
   await page.reload()
   await expect(page.getByText('TEST_ONLY renamed paper',{exact:true}).first()).toBeVisible()
   pass('native renderer reload keeps the named history entry')
   assert.deepEqual(errors,[])
   process.exitCode=0
 }else{
 let predecessor,predecessorBytes
 if(continuation<0){
   await stop()
   for(const folder of await readdir(join(out,'sessions'))){const candidate=join(out,'sessions',folder,sessionId,'session.v4.jsonl.zstd');try{predecessorBytes=await readFile(candidate);predecessor=candidate;break}catch{}}
   assert(predecessor,'actual rc.2 writer must have created the V4 source')
   await boot()
 }
 if(continuation<0){
 const repaired=await rpc('scholarflow.v1/project.repairSessionRegistration',{request:{context:context()}})
 assert.equal(repaired.registered,true);assert.equal(repaired.title,'TEST_ONLY source conflict')
 let list=await rpc('session/list',{_request:{}}),row=list.items.find(row=>row.sessionId===sessionId)
 assert.equal(row.blank,false);assert.equal(row.projections.values.title,'TEST_ONLY source conflict')
 let history=await historyPage()
 const events=history.records.map(row=>row.event??row).filter(Boolean)
 assert.equal(events.filter(e=>e.type==='session/plugin-task-bound').length,1)
 assert(!events.some(e=>e.type==='turn/start'||e.type==='request/header'))
 pass('actual production plugin repairs a paused preexisting paper into native nonblank history without any model call')
 assert((await readFile(predecessor)).equals(predecessorBytes))
 assert((await readdir(dirname(predecessor))).includes('session.v5.jsonl.zstd'))
 pass('actual V4 writer migrates to a V5 successor while preserving predecessor bytes')
 }
 let history,row
 if(!recoveryOnly){
 await rpc('scholarflow.v1/project.repairSessionRegistration',{request:{context:context()}})
 history=await historyPage()
 assert.equal(history.records.map(row=>row.event??row).filter(e=>e.type==='session/plugin-task-bound').length,1)
 const search=await rpc('session/search',{request:{query:'TEST_ONLY source conflict'}})
 assert(search.items.some(row=>row.sessionId===sessionId));pass('idempotent repair and native title search work before any chat turn')
 let project=await rpc('scholarflow.v1/project.inspect',{request:{context:context()}})
 const updated=await rpc('scholarflow.v1/project.updatePresentation',{request:{context:{...context(),projectId:project.binding.projectId,expectedLedgerRevision:project.ledger.revision},baseConfigHash:project.configHash,
   title:'TEST_ONLY renamed paper',type:project.config.project.type,language:project.config.project.language}})
 assert.equal(updated.sessionRegistration.title,'TEST_ONLY renamed paper')
 await rpc('session/rename',{request:{sessionId,title:'TEST_ONLY renamed paper'}})
 project=await rpc('scholarflow.v1/project.inspect',{request:{context:context()}})
 const manual=await rpc('scholarflow.v1/project.updatePresentation',{request:{context:{...context(),projectId:project.binding.projectId,expectedLedgerRevision:project.ledger.revision},baseConfigHash:project.configHash,
   title:'TEST_ONLY latest project title',type:project.config.project.type,language:project.config.project.language}})
 assert.equal(manual.sessionRegistration.manualTitlePreserved,true);assert.equal(manual.sessionRegistration.title,'TEST_ONLY renamed paper')
 pass('confirmed title follows; a native manual rename to identical text stops automatic ownership')
 const other=(await rpc('session/create',{request:{workspaceId,agentPreset:'scholarflow'}})).sessionId
 assert.equal((await rpc('scholarflow.v1/project.repairSessionRegistration',{request:{context:{...context(),sessionId:other}}})).registered,false)
 assert.equal((await rpc('session/list',{_request:{}})).items.find(row=>row.sessionId===other).blank,true)
 pass('independent assistant chat remains provisional and never claims another task')
 }else{
   await rpc('scholarflow.v1/project.repairSessionRegistration',{request:{context:context()}})
 }
 if(!results.includes('packaged host restart restores native history and pinned title from persisted data')){
   await stop();await boot()
   row=(await rpc('session/list',{_request:{}})).items.find(row=>row.sessionId===sessionId)
   assert.equal(row.blank,false);assert.equal(row.projections.values.title,'TEST_ONLY renamed paper')
   pass('packaged host restart restores native history and pinned title from persisted data')
 }
 // Only remove this synthetic session's derived cache, leaving its durable log intact.
 const cache=resolve(out,'storages/session_projcache/sessions',sessionId+'.json')
 assert(relative(out,cache)&&!relative(out,cache).startsWith('..'))
 await stop();await rm(cache,{force:true});await boot()
 await historyPage()
 // Prepared cold observations rebuild in memory; a list-only read deliberately performs no write-back.
 const rebuilt=await rpc('session/projections',{request:{sessionId}})
 assert.equal(rebuilt.values.sessionListMetadata.blank,false);assert.equal(rebuilt.values.title,'TEST_ONLY renamed paper')
 await rpc('scholarflow.v1/project.repairSessionRegistration',{request:{context:context()}})
 row=(await rpc('session/list',{_request:{}})).items.find(row=>row.sessionId===sessionId)
 assert.equal(row.blank,false);assert.equal(row.projections.values.title,'TEST_ONLY renamed paper')
 assert((await readFile(join(workspace,'manuscript/paper.md'))).equals(paper))
 pass('deleted derived cache rebuilds from durable task event; paper bytes remain unchanged')
 // User explicitly selected V5: the old writer must refuse, never silently reopen V4.
 if(!legacyInstall)throw Error('Old-reader acceptance requires --legacy-root pointing at the unmodified rc.2 package.')
 await stop();await boot(legacyInstall)
 await assert.rejects(historyPage())
 pass('unmodified rc.2 host refuses V5 instead of silently selecting the older V4 predecessor')
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({results,errors,out,paidModelCalls:0},null,2))
 }
}catch(error){await page.screenshot({path:join(out,'failure.png')});throw error}
finally{await writeFile(join(out,'report.json'),JSON.stringify({results,errors},null,2));await writeFile(join(out,'host.log'),hostLog);await stop();await browser.close()}
