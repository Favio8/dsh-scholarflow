// Continue the retained TEST_ONLY research candidate after a harness interruption.
import assert from 'node:assert/strict'
import {readFile,writeFile,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
import {chromium,expect} from '@playwright/test'
import {runResearchScenario} from './v21-research-scenario.mjs'
import {digest} from '../../src/core/store/files.ts'
const root=resolve(process.argv[2]),workspace=join(root,'Workspace TEST_ONLY'),inspectOnly=process.argv.includes('--inspect-only')
assert(root.startsWith(resolve('.dsh-tmp/v21-host')+'\\'),'Only isolated TEST_ONLY fixtures are allowed')
const pointer=JSON.parse(await readFile(join(workspace,'.scholarflow/task-delivery/current.json'),'utf8')),taskId=pointer.taskId,
  saved=JSON.parse(await readFile(join(workspace,`.scholarflow/task-delivery/${taskId}/task.json`),'utf8')),
  context={requestId:'TEST_ONLY_research_resume',projectId:saved.projectId,workspaceId:saved.workspaceId,sessionId:saved.sessionId}
assert(saved.model.providerId==='TEST_ONLY'&&saved.goal==='research-results'&&saved.phase===(inspectOnly?'finished':'awaiting-adoption'))
if(inspectOnly)await copyFile('dist/client.js',join(root,'fixture-plugin/dist/client.js'))
const install=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness'),checks=[],errors=[];let host,page,log=''
const launch=()=>{host=spawn(join(install,'DeepSeek Harness.exe'),['--expose-internals',join(install,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'p','--no-open','--port','0'],{env:{...process.env,DSH_HOME:root,ELECTRON_RUN_AS_NODE:'1',DSH_PERMISSION_MODE:'workspace-write'},windowsHide:true,stdio:['ignore','pipe','pipe']});host.stderr.on('data',b=>log+=b);return new Promise((done,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Host boot timeout')),30000);host.stdout.on('data',b=>{log+=b;text+=b;const found=text.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);if(found){clearTimeout(timer);done(found[1])}});host.once('exit',code=>{clearTimeout(timer);reject(Error('Host exit '+code))})})}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const dismiss=async()=>{for(let i=0;i<4;i++){const dialog=page.getByRole('dialog').first();try{await dialog.waitFor({timeout:i?1000:4000})}catch{return}const text=await dialog.innerText();if(text.startsWith('预览版说明'))await dialog.getByRole('button',{name:'继续',exact:true}).click();else if(text.startsWith('添加一个 API Key'))await dialog.getByRole('button',{name:'稍后配置',exact:true}).click();else return;await dialog.waitFor({state:'hidden'})}}
const rpc=(method,args)=>page.evaluate(async({method,args})=>{const response=await fetch('api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})}),result=(await response.json()).result;if(!result.ok||result.value?.ok===false)throw Error(JSON.stringify(result.error??result.value.error));return result.value?.data??result.value},{method,args})
const record=(name,detail={})=>{checks.push({name,passed:true,detail});console.log('PASS '+name)}
try{
  page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(await launch());await page.getByRole('button',{name:'新建会话',exact:true}).first().waitFor({timeout:45000});await dismiss()
  const row=page.locator(`[data-row-key="workspace:${context.workspaceId}"]`);if(await row.getAttribute('aria-expanded')!=='true')await row.click();await page.locator(`[data-row-key="session:${context.sessionId}"]`).click();await page.locator('.sf-app').waitFor()
  if(inspectOnly){await page.locator('[data-node="review"]').click();const panel=page.getByRole('region',{name:'连续任务的检查与交付'});await expect(panel).toContainText('交付文件已保存');await expect(panel).not.toContainText('正在实际复查');await expect(page.locator('[data-node="materials"]')).not.toContainText('已暂停');await page.screenshot({path:join(root,'research-final-ui.png')});record('AT-208: final installed client shows current delivery status and actual material scope without an obsolete paused task')}
  else await runResearchScenario({page,rpc,context,taskId,workspace,out:root,record,dismiss,resume:true});assert.deepEqual(errors,[])
}catch(error){checks.push({passed:false,error:String(error.stack)});await page?.screenshot({path:join(root,'finish-failure.png')}).catch(()=>{});throw error}
finally{await writeFile(join(root,inspectOnly?'final-ui-report.json':'finish-research-report.json'),JSON.stringify({checks,errors,paidModelCalls:0,scope:'installed Host TEST_ONLY continuation; initial generation not replayed',build:{host:digest(await readFile(join(root,'fixture-plugin/dist/host.js'))),client:digest(await readFile(join(root,'fixture-plugin/dist/client.js')))}},null,2));await writeFile(join(root,inspectOnly?'final-ui-host-log.txt':'finish-host-log.txt'),log.replace(/token=[^\s]+/gu,'token=[redacted]'));await browser.close();host?.kill()}
console.log(JSON.stringify({root,checks:checks.length}))
