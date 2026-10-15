// Read-only connectivity probe: no credentials and no inference request.
import {spawn} from 'node:child_process'
import {join} from 'node:path'
const exe=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness/DeepSeek Harness.exe')
const post=process.argv.includes('--post')
await Promise.all([false,true].map(proxy=>new Promise((resolve,reject)=>{
  const code=`const t=setTimeout(()=>{},10000);fetch('https://api.deepseek.com/anthropic/messages',{method:'${post?'POST':'HEAD'}',${post?`headers:{'content-type':'application/json','anthropic-version':'2023-06-01'},body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'TEST_ONLY unauthenticated transport probe'}],max_tokens:1,stream:true}),`:''}signal:AbortSignal.timeout(8000)}).then(r=>console.log(JSON.stringify({runtime:process.versions.node,proxy:${proxy},method:'${post?'POST':'HEAD'}',status:r.status})),e=>console.log(JSON.stringify({runtime:process.versions.node,proxy:${proxy},name:e.name,code:e.cause?.code}))).finally(()=>clearTimeout(t))`
  const child=spawn(exe,['-e',code],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',...(proxy&&{NODE_USE_ENV_PROXY:'1'})},windowsHide:true,stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',resolve)
})))
