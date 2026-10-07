// Installed Electron, current desktop profile copied without changing providers.
// All writes stay in the explicitly supplied .dsh-tmp isolation. --live sends one polish.
// Usage: node tests/e2e/v13-workbench.mjs --setup .dsh-tmp/v13-current.json [--live]
import assert from 'node:assert/strict'
import { _electron as electron } from '@playwright/test'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export async function verifyV13({page,app,setup,rpc,live=false,afterZoom=false,tailOnly=false}) {
  const out=join(setup.root,'acceptance',String(Date.now()));await mkdir(out,{recursive:true})
  const rows=[],errors=[],requests=[];const record=(id,detail)=>{rows.push({at:new Date().toISOString(),id,detail});console.log('PASS',id,JSON.stringify(detail))}
  page.on('pageerror',e=>errors.push(e.message))
  page.on('request',r=>{if(r.method()==='POST'){const body=r.postDataJSON();if(body?.method==='scholarflow.v1/cowrite.propose')requests.push({at:Date.now(),method:body.method})}})
  const a=page.locator('.sf-source-input'),middle=page.locator('.sf-middle-column'),preview=page.locator('.sf-paper-scroll')
  await a.waitFor();const original=tailOnly?await readFile(join(setup.workspace,'manuscript/paper.md'),'utf8'):await a.inputValue(),hash=t=>createHash('sha256').update(t).digest('hex')
  if(tailOnly)await a.fill(original)
  const cdp=await page.context().newCDPSession(page),frames=join(out,'frames');await mkdir(frames,{recursive:true})
  let frame=0;const times=[],pending=[]
  cdp.on('Page.screencastFrame',e=>{const name=`frame-${String(++frame).padStart(5,'0')}.jpg`;times.push({name,time:e.metadata.timestamp});pending.push(writeFile(join(frames,name),Buffer.from(e.data,'base64')));cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{})})
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:72,maxWidth:1500,maxHeight:960,everyNthFrame:1})
  const context=()=>({requestId:'v13_TEST_ONLY_'+Date.now(),workspaceId:setup.workspaceId,sessionId:setup.testSessionId})
  const unwrapped=async(method,request)=>{const r=await rpc('scholarflow.v1/'+method,{request});if(!r.ok||r.value?.ok===false)throw Error(JSON.stringify(r.error??r.value.error));return r.value?.data??r.value}
  const screenshot=async(name)=>page.screenshot({path:join(out,name+'.png')})
  const zooms=()=>page.locator('.sf-pane-zoom').allTextContents()
  async function wheel(node,delta,mod='Control'){const b=await node.boundingBox();await page.mouse.move(b.x+Math.min(80,b.width/2),b.y+Math.min(110,b.height/2));if(mod)await page.keyboard.down(mod);await page.mouse.wheel(0,delta);if(mod)await page.keyboard.up(mod);await page.waitForTimeout(120)}
  async function selectParagraph(){await a.focus();await a.press('Control+Home');for(let i=0;i<4;i++)await a.press('ArrowDown');await a.press('Home');await a.press('Shift+End');await page.getByRole('button',{name:'润色',exact:true}).click();await page.getByRole('textbox',{name:'局部修改要求'}).waitFor()}
  const failureRoute='**/api/scholarflow.v1/cowrite.propose'
  const failure=(code,message)=>({result:{ok:true,value:{ok:false,error:{code,message,retryable:false,details:{category:code==='TRANSPORT'?'provider/transport':'model-response',operation:'cowrite.propose'}}}}})
  async function mockedResult(body,delay=0){await page.evaluate(({body,delay})=>{
    if(!window.__sfV13Fetch) { const original=window.fetch;window.__sfV13Fetch={original,requests:[],fixture:null};window.fetch=async(input,init)=>{
      const holder=window.__sfV13Fetch
      if(String(input).endsWith('api/scholarflow.v1/cowrite.propose')&&holder.fixture){const message=JSON.parse(init.body);holder.requests.push({at:Date.now(),method:message.method});const fixture=holder.fixture;if(fixture.delay)await new Promise(r=>setTimeout(r,fixture.delay));return new Response(JSON.stringify({...fixture.body,type:'server-response',rpcId:message.rpcId}),{status:200,headers:{'content-type':'application/json'}})}
      return Reflect.apply(holder.original,window,[input,init])
    }}window.__sfV13Fetch.fixture={body,delay}
  },{body,delay})}
  const clearMock=()=>page.evaluate(()=>{if(window.__sfV13Fetch)window.__sfV13Fetch.fixture=null})
  let taskBefore
  try {
    if(!tailOnly){
    // A restored candidate is reviewed once; do not resend a previously successful call.
    if(await page.locator('.sf-rewrite[data-state=ready]').count())await page.getByRole('button',{name:'× 放弃',exact:true}).click()
    if(!afterZoom){await page.getByRole('button',{name:'编辑恢复100%',exact:true}).click();await page.getByRole('button',{name:'预览恢复100%',exact:true}).click()
    await wheel(a,-500);await wheel(preview,300);assert.deepEqual(await zooms(),['−125%＋','−85%＋'])
    await wheel(preview,100);assert.equal((await zooms())[0],'−125%＋');await wheel(preview,-100)
    const whole=await app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.getType()==='window').map(w=>w.getZoomFactor()))
    assert.deepEqual(whole,[1]);assert.equal(hash(await a.inputValue()),hash(original));await screenshot('independent-125-85');record('AT-70/G2-4',{zooms:await zooms(),whole,hash:hash(original)})
    await wheel(a,3000);await wheel(preview,-3000);assert.deepEqual(await zooms(),['−50%＋','−200%＋'])
    await wheel(a,300);await wheel(preview,-300);assert.deepEqual(await zooms(),['−50%＋','−200%＋'])
    await page.getByRole('button',{name:'编辑恢复100%',exact:true}).click();await page.getByRole('button',{name:'预览恢复100%',exact:true}).click()
    for(let i=0;i<10;i++)await wheel(a,-10);assert.equal((await zooms())[0],'−105%＋')
    const before=await zooms();await wheel(a,220,null);await wheel(a,100,'Shift');await wheel(a,100,'Alt');assert.deepEqual(await zooms(),before)
    record('AT-71',{boundary:'50/200',smallDeltas:'10×10px→5%',ordinaryShiftAlt:true})}
    await page.getByRole('button',{name:'编辑恢复100%',exact:true}).click();await selectParagraph()
    const input=page.getByRole('textbox',{name:'局部修改要求'}),initial=await page.locator('.sf-overlay').boundingBox()
    assert.ok(initial.height<=64,`one-line input ${initial.height}px`);assert.equal(await page.getByText('查看候选',{exact:true}).count(),0)
    await input.fill('请保持术语准确');await input.press('Shift+Enter');await input.pressSequentially('保持引用');assert.ok((await input.inputValue()).includes('\n'))
    await input.press('Escape');await page.getByRole('button',{name:'恢复修改输入'}).click();assert.ok((await input.inputValue()).includes('保持引用'))
    await input.fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行');assert.ok(await input.evaluate(e=>e.scrollHeight>e.clientHeight))
    await input.fill('');record('AT-73',{initialHeight:initial.height,shiftEnter:true,escapeRestore:true,internalOverflow:true})
    // Controlled Fetch failure paths exercise the actual Electron UI; domain tests own parsing.
    for(const [label,body] of [['transport',failure('TRANSPORT','润色请求的连接中断，本次未改动正文。')],['empty',{result:{ok:true,value:{ok:true,data:{suggestion:{id:'empty_TEST_ONLY',after:''}}}}}],['invalid',failure('INVALID_MODEL_OUTPUT','模型未返回可用的改写结果。')]]){
      await mockedResult(body);await input.press('Enter');await page.locator('.sf-rewrite[data-state=failed]').waitFor();assert.equal(await page.locator('.sf-rewrite [data-sf-accept]').count(),0)
      assert.equal(await page.locator('.sf-rewrite-diff').count(),0);assert.equal(await a.inputValue(),original);await screenshot('failure-'+label);await page.unroute(failureRoute)
      await clearMock();record('AT-74/'+label,{type:'controlled Fetch response + actual Electron',noDiff:true,noAccept:true,unchanged:true})
    }
    await mockedResult(failure('INVALID_MODEL_OUTPUT','TEST_ONLY late result'),1200);const count=await page.evaluate(()=>window.__sfV13Fetch.requests.length);await input.press('Enter');await page.getByRole('button',{name:'停止生成',exact:true}).click();await page.locator('.sf-rewrite[data-state=stopped]').waitFor();await page.waitForTimeout(1400)
    assert.equal(await page.locator('.sf-rewrite').getAttribute('data-state'),'stopped');assert.equal(await page.evaluate(()=>window.__sfV13Fetch.requests.length),count+1);await clearMock();record('AT-74/stopped',{lateResultIgnored:true,requests:1})
    if(live){await input.fill('保留引用，改善表达；只返回选中段落。');await input.press('Enter');await Promise.race([
        page.locator('.sf-rewrite[data-state=ready]').waitFor({timeout:180000}),
        page.locator('.sf-rewrite[data-state=failed]').waitFor({timeout:180000}).then(async()=>{throw Error('Actual provider: '+await page.locator('.sf-rewrite').innerText())})])
      assert.equal((await page.locator('.sf-rewrite-reading').innerText()).includes('[@sf_'),false);await screenshot('real-candidate')
      const range=await a.evaluate(e=>({start:e.selectionStart,end:e.selectionEnd})),before=await a.inputValue()
      await page.getByRole('button',{name:'√ 采用',exact:true}).click();const accepted=await a.inputValue();assert.notEqual(accepted,before)
      await page.getByRole('button',{name:'撤销接受',exact:true}).click();assert.equal(await a.inputValue(),before)
      await page.getByRole('button',{name:'× 放弃',exact:true}).click();record('AT-75/real',{type:'actual configured provider',accepted:true,undoExact:true,discardExact:true,range})
    }else await page.getByRole('button',{name:'× 放弃',exact:true}).click()
    // Current native chat was opened via guide in G2. Close/reopen and tool-to-chat restore.
    const currentSession=await page.locator('.sf-project').getAttribute('data-sf-session-id');assert.equal(currentSession,setup.testSessionId)
    const chat=page.locator('.sf-agent [data-composer-input]');await chat.waitFor();await chat.click();await chat.pressSequentially('中文未发送草稿 TEST_ONLY')
    await page.getByRole('button',{name:'关闭聊天面板',exact:true}).click();await page.getByRole('button',{name:'打开右侧边栏',exact:true}).click();assert.equal(await chat.innerText(),'中文未发送草稿 TEST_ONLY')
    await chat.press('Control+a');await chat.press('Backspace');record('AT-82/restore',{sessionUnchanged:true,draftRetained:true})
    // Requirement panel remains readable across genuine historical failures.
    const taskFile=join(setup.workspace,'.scholarflow/writing/tasks',setup.taskId+'.json');taskBefore=await readFile(taskFile,'utf8')
    await writeFile(taskFile,'{TEST_ONLY corrupted');const damaged=await unwrapped('writingTask.inspect',{context:context()});assert.ok(damaged.spec);assert.equal(damaged.taskDiagnostic.code,'WRITING_TASK_INVALID')
    const budget=JSON.parse(taskBefore);delete budget.questions[0].answered;await writeFile(taskFile,JSON.stringify(budget));const unanswered=await unwrapped('writingTask.inspect',{context:context()});assert.equal(unanswered.task.questions[0].answered,undefined);assert.equal(unanswered.task.status,'completed')
    await writeFile(taskFile,taskBefore);record('AT-78/79',{realBudgetPreserved:true,unansweredNoRestart:true,damagedProgressIndependent:true})
    const prior=(await unwrapped('writingTask.inspect',{context:context()})).spec
    await page.getByRole('button',{name:'课程论文 ▾',exact:true}).click();await page.getByRole('heading',{name:'写作要求',exact:true}).waitFor();const title=page.getByRole('textbox',{name:'论文标题'}),oldTitle=await title.inputValue();await title.fill(oldTitle+' TEST_ONLY');await page.getByRole('button',{name:'保存要求',exact:true}).click();await page.getByText('已保存写作要求。',{exact:true}).waitFor();await title.fill(oldTitle);await page.getByRole('button',{name:'保存要求',exact:true}).click();await page.getByText('已保存写作要求。',{exact:true}).waitFor();const saved=(await unwrapped('writingTask.inspect',{context:context()})).spec;assert.deepEqual(saved,prior);record('AT-80',{save:true,preservedCoverMaterials:true})
    }
    await page.locator('.sf-paper-views').getByRole('button',{name:'编辑',exact:true}).click()
    // Long input uses TEST_ONLY text and never submits that text to a provider.
    const long='# TEST_ONLY\n\n'+('连续写作，验证滚动和输入不会丢字。'.repeat(550))+'\n';await a.fill(long);await a.press('Control+End');let typed='';const started=Date.now()
    while(Date.now()-started<30000){await a.pressSequentially('连续输入测试。');typed+='连续输入测试。';await page.waitForTimeout(200)}
    assert.equal(await a.inputValue(),long+typed);record('AT-84/long-input',{characters:long.length,durationMs:Date.now()-started,typed:typed.length,noDroppedText:true});await wheel(a,200,null);await wheel(a,-100);await page.locator('.sf-paper-views').getByRole('button',{name:'分屏',exact:true}).click();await wheel(preview,-200,null)
    await a.fill(original)
    for(const width of [640,960,360]){await app.evaluate(({BrowserWindow},width)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith("dsh-app://app/"));w.setSize(width+900,960)},width)
      await page.waitForTimeout(200);const box=await middle.boundingBox();const buttons=await page.locator('.sf-type-chip').boundingBox();assert.ok(buttons.height<50);await screenshot('width-'+width);record('AT-83/width-'+width,{actualMiddle:box.width,typeHeight:buttons.height})}
    await app.evaluate(({BrowserWindow,webContents})=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith("dsh-app://app/")).setSize(1500,960);for(const w of webContents.getAllWebContents().filter(w=>w.getType()==='window'))w.setZoomFactor(2)})
    await page.waitForTimeout(250);await screenshot('host-200');await app.evaluate(({webContents})=>{for(const w of webContents.getAllWebContents().filter(w=>w.getType()==='window'))w.setZoomFactor(1)})
    await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});await screenshot('reduced-dark');await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'light'});record('AT-84/media',{reducedMotion:true,darkLight:true})
    assert.deepEqual(errors,[]);await writeFile(join(out,'result.json'),JSON.stringify({rows,errors,requests,frames:frame,provider:'copied desktop selection; unchanged'},null,2))
    return {rows,errors,out}
  }catch(error){
    await screenshot('failure-state');await writeFile(join(out,'failure-state.json'),JSON.stringify({message:error.message,requests,errors,
      candidates:await page.locator('.sf-rewrite').evaluateAll(es=>es.map(e=>({state:e.dataset.state,rect:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height},text:e.textContent.slice(-1000)}))),
      input:await page.getByRole('textbox',{name:'局部修改要求'}).inputValue().catch(()=>''),selection:await a.evaluate(e=>({start:e.selectionStart,end:e.selectionEnd}))},null,2));throw error
  }finally{
    await a.fill(original).catch(()=>{});await page.waitForTimeout(700)
    if(taskBefore)await writeFile(join(setup.workspace,'.scholarflow/writing/tasks',setup.taskId+'.json'),taskBefore)
    const mockRequests=await page.evaluate(()=>{if(!window.__sfV13Fetch)return [];const held=window.__sfV13Fetch;window.fetch=held.original;delete window.__sfV13Fetch;return held.requests});requests.push(...mockRequests)
    await page.unroute(failureRoute);await cdp.send('Page.stopScreencast');await Promise.all(pending)
    if(times.length){const concat=times.map((f,i)=>`file '${f.name}'\nduration ${Math.min(2,Math.max(.04,(times[i+1]?.time??f.time+.5)-f.time))}`).join('\n')+`\nfile '${times.at(-1).name}'\n`;await writeFile(join(frames,'frames.txt'),concat);const encoded=spawnSync('ffmpeg',['-y','-f','concat','-safe','0','-i',join(frames,'frames.txt'),'-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p',join(out,'interaction.mp4')],{windowsHide:true,encoding:'utf8'});await writeFile(join(out,'video-status.json'),JSON.stringify({frames:frame,status:encoded.status}))}
    await writeFile(join(out,'operation-log.json'),JSON.stringify({rows,errors,requests},null,2))
  }
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/,'$1:'))){
  const file=process.argv[process.argv.indexOf('--setup')+1];const setup=JSON.parse(await readFile(file,'utf8'))
  assert.ok(resolve(setup.root).startsWith(resolve('.dsh-tmp')+'/')||resolve(setup.root).startsWith(resolve('.dsh-tmp')+'\\'),'isolated workspace required')
  for(const path of [setup.home,setup.workspace]){const inside=relative(resolve(setup.root),resolve(path));assert.ok(inside&&!inside.startsWith('..')&&!/^[A-Za-z]:/.test(inside),'home and workspace must be inside the isolation root')}
  const env={...process.env,DSH_HOME:setup.home};delete env.ELECTRON_RUN_AS_NODE
  const app=await electron.launch({executablePath:join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness/DeepSeek Harness.exe'),args:[`--user-data-dir=${join(setup.root,'electron')}`],env,timeout:45000})
  const page=await app.firstWindow();page.setDefaultTimeout(15000);await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows()){if(w.webContents.getURL().startsWith('dsh-app://app/')){w.setSize(1500,960);w.restore();w.show();w.focus()}else w.hide()}})
  const rpc=(method,args={})=>page.evaluate(async({method,args})=>{const r=await fetch('api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})});return(await r.json()).result},{method,args})
  page.on('dialog',d=>d.type()==='beforeunload'?d.accept().catch(()=>{}):d.dismiss().catch(()=>{}))
  try{await verifyV13({page,app,setup,rpc,live:process.argv.includes('--live'),afterZoom:process.argv.includes('--after-zoom'),tailOnly:process.argv.includes('--tail-only')})}finally{await app.close()}
}
