// Graceful operator pause/cancel of only this run's isolated live Host; no tokens printed.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {chromium} from '@playwright/test'
const root=resolve(process.argv[2]),action=process.argv[3]??'pause';assert(root.startsWith(resolve('.dsh-tmp/v21-real-task')+'\\'));assert(['pause','cancel'].includes(action))
const {url}=JSON.parse(await readFile(join(root,'gateway.json'),'utf8')),target=new URL(url);assert(target.hostname==='127.0.0.1'&&target.protocol==='http:')
const {context,taskId}=JSON.parse(await readFile(join(root,'context.json'),'utf8')),browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
try{const page=await browser.newPage();await page.goto(url);const result=await page.evaluate(async({context,taskId,action})=>{const rpc=async(method,data)=>{const r=await fetch('api/scholarflow.v1/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'scholarflow.v1/'+method,payload:{args:{request:{context,...data}}}})}),v=(await r.json()).result;if(!v.ok||v.value?.ok===false)throw Error('Operator control failed');return v.value.data};const current=await rpc('deliveryTask.inspect',{taskId});return rpc('deliveryTask.action',{taskId,action,expectedTaskRevision:current.task.revision})},{context,taskId,action});console.log(JSON.stringify({taskId,action,status:result.task.status,phase:result.task.phase}))}finally{await browser.close()}
