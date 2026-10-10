// Installed Harness, real controller/store/parser/editor/export. Only model seam is TEST_ONLY.
// Builds an isolated package so production dist and the user's profile never receive a mock.
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium,expect} from '@playwright/test'
import {spawn} from 'node:child_process'
import {mkdir,writeFile,readFile,copyFile,cp,symlink} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import JSZip from 'jszip'

const saveOnly=process.argv.indexOf('--save-export-only'),continuation=saveOnly>=0?saveOnly:process.argv.indexOf('--continue-edit'),out=continuation>=0?resolve(process.argv[continuation+1]):resolve('.dsh-tmp/first-draft-host',String(Date.now()))
assert(out.startsWith(resolve('.dsh-tmp/first-draft-host')+'/')||out.startsWith(resolve('.dsh-tmp/first-draft-host')+'\\'))
const profile=join(out,'profiles/p'),workspace=join(out,'Workspace TEST_ONLY'),pkg=join(out,'fixture-plugin'),trace=join(out,'model-trace.jsonl')
await mkdir(join(profile,'node_modules'),{recursive:true});await mkdir(join(pkg,'dist'),{recursive:true});await mkdir(workspace,{recursive:true})
const material='TEST_ONLY：这是一份专供端到端验收的资料。介绍观察、比较与分析，只用于测试。'
if(continuation<0)await writeFile(join(workspace,'材料 TEST_ONLY.md'),material)
await build({entryPoints:['src/host/plugin.ts'],outfile:join(pkg,'dist/host.js'),bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',plugins:[{name:'TEST_ONLY-model-seam',setup(builder){
  builder.onLoad({filter:/[\\/]executor[\\/]model\.ts$/},()=>({loader:'ts',contents:`
    import {appendFile} from 'node:fs/promises'
    import {createUserMessage} from '@deepseek-ai/dsh-llm'
    let generation=0
    const log=event=>appendFile(${JSON.stringify(trace)},JSON.stringify({...event,time:Date.now()})+'\\n')
    export async function selectedModel(ctx,sessionId){const resolved=await ctx.sessionController.resolveAgent(sessionId);if(resolved.error)throw resolved.error;return {selected:{provider:'TEST_ONLY',model:'controlled'},session:resolved.agent.session,contextWindow:100000,maxOutputTokens:4096,imageInput:false}}
    export async function callStageModel(ctx,session,selected,call){
      const data=call.context;call.signal.throwIfAborted()
      session.append('user/message',createUserMessage({source:{kind:'scholarflow-stage-audit',runId:call.runId,phase:'request'},content:[{type:'text',text:'TEST_ONLY controlled model audit; not a new user instruction.'}]}),{surfaceOp:'append'});await ctx.sessions.flush(session)
      if(call.system.includes('学术写作结构规划助手'))return JSON.stringify({taskSummary:'TEST_ONLY controlled outline',targetLength:500,
        sections:[{id:'section_test',title:'TEST_ONLY 分析',purpose:'TEST_ONLY 根据选定材料分析。',targetLength:500,allocationMode:'auto',kind:'body'}],
        requirements:[{id:'r1',text:data.requirements,quote:data.requirements}]})
      if(call.system.includes('独立审查本次大纲'))return JSON.stringify({coverage:data.generated.requirements.map(row=>({itemId:row.id,scope:'sections',sectionIds:['section_test'],status:'covered',reason:'TEST_ONLY controlled semantic assessment'})),issues:[]})
      if(data.blocks)return JSON.stringify({summary:'TEST_ONLY observed material',bibliography:{}})
      if(data.evidence && data.sections)return JSON.stringify({question:{title:'TEST_ONLY ordinary question deferred',options:['TEST_ONLY']},
        claims:data.sections.map(section=>({sectionId:section.id,text:'TEST_ONLY 基于材料的分析',evidenceIds:data.evidence.map(row=>row.id),rationale:'TEST_ONLY actual selected text'}))})
      if(data.target){await log({kind:'rewrite'});return JSON.stringify({replacementText:data.target+'（TEST_ONLY 已改写）'})}
      if(data.sectionContract){
        generation++;await log({kind:'section',generation})
        const key=data.sources[0].citeKey,ids=data.claims.map(row=>row.id)
        const body='TEST_ONLY 首段：'+'依据测试资料讨论观察与比较，保持原意与范围。'.repeat(10)+' [@'+key+']。\\n\\nTEST_ONLY 第二段：'+'进一步说明各部分之间的联系，依据材料解释分析。'.repeat(10)+' [@'+key+']。'
        const raw=JSON.stringify({replacementText:body,limitations:['TEST_ONLY synthetic provider'],sectionId:data.sectionContract.sectionId,
          paragraphClaims:[{paragraphIndex:0,claimIds:ids},{paragraphIndex:1,claimIds:ids}]})
        const cut=raw.indexOf('首段')+2;call.onTextDelta?.(raw.slice(0,cut));await log({kind:'first-delta',generation})
        if(generation===1)await new Promise((done,reject)=>{const timer=setTimeout(done,50000);call.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('TEST_ONLY aborted'))},{once:true})})
        for(let offset=cut;offset<raw.length;offset+=80){call.signal.throwIfAborted();call.onTextDelta?.(raw.slice(offset,offset+80));await new Promise(done=>setTimeout(done,40))}
        await log({kind:'finish',generation});return raw
      }
      throw Error('TEST_ONLY unexpected model stage')
    }
    export async function callStageModelWithImage(){throw Error('TEST_ONLY no image calls')}
  `}))
}}]})
const manifest=JSON.parse(await readFile('package.json','utf8'))
await writeFile(join(pkg,'package.json'),JSON.stringify({...manifest,name:'dsh-scholarflow',private:true}))
for(const file of ['client.js','agent.js','parser-worker.js'])await copyFile(join('dist',file),join(pkg,'dist',file))
await copyFile('cordis.patch.yml',join(pkg,'cordis.patch.yml'))
for(const folder of ['presets','academic-skills','skills','agent-preset','templates']){
  try{await cp(folder,join(pkg,folder),{recursive:true})}catch(error){if(error.code!=='ENOENT')throw error}
}
await writeFile(join(profile,'package.json'),JSON.stringify({private:true,dependencies:{'dsh-scholarflow':'link:'+pkg.replaceAll('\\','/')},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-scholarflow']}}}))
await writeFile(join(profile,'cordis.yml'),'[]\n');try{await symlink(pkg,join(profile,'node_modules/dsh-scholarflow'),'junction')}catch(error){if(error.code!=='EEXIST')throw error}
const install=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness')
const host=spawn(join(install,'DeepSeek Harness.exe'),['--expose-internals',join(install,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'p','--no-open','--port','0'],
  {env:{...process.env,DSH_HOME:out,ELECTRON_RUN_AS_NODE:'1',DSH_PERMISSION_MODE:'workspace-write'},windowsHide:true,stdio:['ignore','pipe','pipe']})
let hostLog='';host.stderr.on('data',chunk=>hostLog+=chunk.toString());host.stdout.on('data',chunk=>hostLog+=chunk.toString())
const ready=new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('boot timeout')),30000);let text='';host.stdout.on('data',chunk=>{text+=chunk.toString();const m=text.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);if(m){clearTimeout(timer);done(m[1])}});host.once('exit',code=>{clearTimeout(timer);reject(Error('exit '+code))})})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}})
const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
const pass=name=>{results.push(name);console.log('PASS '+name)}
try{
  await page.goto(await ready)
  const dismiss=async()=>{for(let i=0;i<3;i++){await page.waitForTimeout(350);const d=page.getByRole('dialog').first();if(!await d.count())break;const t=await d.innerText();if(t.startsWith('预览版说明'))await d.getByRole('button',{name:'继续',exact:true}).click();else if(t.startsWith('添加一个 API Key'))await d.getByRole('button',{name:'稍后配置',exact:true}).click();else break}}
  await dismiss()
  const rpc=(method,args)=>page.evaluate(async({method,args})=>{const r=await fetch('api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})});const result=(await r.json()).result;if(!result.ok||result.value?.ok===false)throw Error(JSON.stringify(result.error??result.value.error));return result.value?.data??result.value},{method,args})
  const workspaceId=(await rpc('workspace/create',{request:{path:workspace}})).workspace.workspaceId;await page.reload();await dismiss()
  await page.locator('button[aria-label="选择工作区"]').click().catch(()=>undefined);await page.waitForTimeout(500)
  await page.evaluate(()=>{const visible=el=>{const r=el.getBoundingClientRect();return r.width&&r.height};const option=[...document.querySelectorAll('*')].filter(el=>visible(el)&&!el.children.length&&(el.innerText??'').includes('Workspace TEST_ONLY')).at(-1);if(!option)throw Error('workspace absent');let target=option;for(let i=0;i<4&&target.parentElement;i++){if(target.tagName==='BUTTON'||target.getAttribute('role')==='menuitem'||String(target.className).includes('_item_'))break;target=target.parentElement}target.click()})
  await page.waitForTimeout(700)
  if(continuation>=0)await expect(page.locator('.sf-paper-page')).toBeVisible()
  else {await page.locator('button[title="选择新任务使用的 Agent 预设"]').click();await page.locator('[class*="_item_"]').filter({hasText:/^ScholarFlow/}).click()}
  if(continuation<0){
  if(process.argv.includes('--from-plan')){
    await page.locator('#sf-field-title').waitFor()
    const sessionId=await page.locator('.sf-project').getAttribute('data-sf-session-id'),context={requestId:'req_test',workspaceId,sessionId}
    const spec={title:'TEST_ONLY 连续初稿',requirements:'TEST_ONLY 阅读选定材料并分析，约500字。',type:'course-paper',language:'zh-CN',format:'markdown',materials:['材料 TEST_ONLY.md'],targetLength:500,
      sections:[{id:'section_test',title:'TEST_ONLY 分析',purpose:'TEST_ONLY 根据已确认规范分析资料',targetLength:500,kind:'body'}]}
    const plan=await rpc('scholarflow.v1/creation.prepare',{request:{context,spec,mode:'first-draft'}})
    await rpc('scholarflow.v1/creation.start',{request:{context,planId:plan.planId,planHash:plan.planHash}})
    await page.reload();await dismiss()
  }else{
  await page.locator('#sf-field-title').fill('TEST_ONLY 连续初稿')
  await page.locator('#sf-field-requirements').fill('TEST_ONLY 阅读选定材料并分析，约500字。')
  await page.getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('checkbox',{name:/材料 TEST_ONLY/}).check()
  await page.getByRole('button',{name:'下一步',exact:true}).click()
  await page.getByRole('button',{name:'采用此大纲',exact:true}).click()
  await page.getByRole('button',{name:'开始生成初稿',exact:true}).click()
  }
  await expect(page.locator('.sf-paper-page')).toContainText('TEST_ONLY 首段')
  assert.equal((await readFile(join(workspace,'manuscript/paper.md'),'utf8')).includes('首段'),false)
  const events=(await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(events.some(e=>e.kind==='finish'),false)
  assert.equal(await page.locator('.sf-overlay-question').count(),0)
  await expect(page.locator('.sf-paper-views').getByRole('button',{name:'编辑',exact:true})).toBeDisabled()
  await page.screenshot({path:join(out,'partial.png')})
  pass('confirmed spec to real first-draft job: partial body visible before response and before manuscript publication')
  await page.getByRole('button',{name:'暂停',exact:true}).click()
  await expect(page.getByText('已暂停，可编辑已保存正文',{exact:true})).toBeVisible()
  await expect(page.locator('.sf-unfinished-preview')).toBeVisible()
  assert.equal((await readFile(join(workspace,'manuscript/paper.md'),'utf8')).includes('首段'),false)
  pass('one pause cancels current request and retains uncommitted preview')
  await page.reload();await dismiss();await expect(page.locator('.sf-unfinished-preview')).toBeVisible()
  assert.equal((await readFile(trace,'utf8')).includes('"generation":2'),false)
  await page.getByRole('button',{name:'继续',exact:true}).click()
  await expect(page.getByText(/初稿就绪/).first()).toBeVisible()
  await expect(page.locator('.sf-paper-page')).toContainText('TEST_ONLY 第二段')
  await expect(page.locator('.sf-paper-views').getByRole('button',{name:'编辑',exact:true})).toBeEnabled()
  assert.equal(await page.locator('.sf-overlay-question').count(),0)
  pass('reload does not replay the model; explicit resume finishes the draft and enables editing')
  }else{
    await expect(page.locator('.sf-paper-page')).toContainText('TEST_ONLY 第二段')
    pass('reopen the already completed fixture without replaying successful generation checks')
  }
  if(saveOnly>=0){
    const sessionId=await page.locator('.sf-project').getAttribute('data-sf-session-id')
    let context={requestId:'req_save_test',workspaceId,sessionId}
    const current=await rpc('scholarflow.v1/project.inspect',{request:{context}})
    context={...context,projectId:current.binding.projectId,expectedLedgerRevision:current.ledger.revision}
    const buffer=await rpc('scholarflow.v1/editor.bufferRead',{request:{context}})
    assert(buffer.buffer?.text.includes('TEST_ONLY 已改写'))
    await rpc('scholarflow.v1/document.saveManual',{request:{context,text:buffer.buffer.text,baseHash:buffer.buffer.baseHash}})
    await page.reload();await dismiss()
    assert((await readFile(join(workspace,'manuscript/paper.md'),'utf8')).includes('TEST_ONLY 已改写'))
    pass('retained accepted editor buffer receives the actual save acknowledgement and survives reload')
  }else{
  await page.locator('.sf-paper-views').getByRole('button',{name:'预览',exact:true}).click()
  await page.evaluate(()=>{const leaf=[...document.querySelectorAll('.sf-paper-page p [data-sf-leaf]')].find(el=>el.textContent.startsWith('TEST_ONLY 首段'));const text=leaf.firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,10);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);leaf.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})
  await page.getByRole('button',{name:'润色',exact:true}).click()
  await page.getByRole('button',{name:'提交修改',exact:true}).click()
  await page.locator('.sf-rewrite [data-sf-accept]').click()
  await page.locator('.sf-paper-views').getByRole('button',{name:'编辑',exact:true}).click()
  await expect(page.getByRole('textbox',{name:'Markdown 手工编辑',exact:true})).toHaveValue(/TEST_ONLY 已改写/)
  await page.getByRole('button',{name:'保存',exact:true}).click()
  await expect.poll(()=>readFile(join(workspace,'manuscript/paper.md'),'utf8')).toContain('TEST_ONLY 已改写')
  const finalBody=await readFile(join(workspace,'manuscript/paper.md'),'utf8');assert(finalBody.includes('TEST_ONLY 已改写'))
  pass('post-draft rendered selection produces a candidate, explicit acceptance and save')
  }
  const downloads=[]
  for(const format of ['Markdown','Word','LaTeX']){
    const main=page.locator('.sf-export-split').getByRole('button').first()
    const [download]=await Promise.all([page.waitForEvent('download'),(async()=>{if((await main.innerText()).includes(format))await main.click();else{await page.getByLabel('更多导出选项',{exact:true}).click();await page.getByRole('button',{name:'导出 '+format,exact:true}).click()}})()])
    const path=join(out,download.suggestedFilename());await download.saveAs(path);downloads.push(path)
  }
  const markdown=await readFile(downloads[0],'utf8');assert(markdown.includes('TEST_ONLY 已改写'))
  const word=await JSZip.loadAsync(await readFile(downloads[1]));assert((await word.file('word/document.xml').async('string')).includes('TEST_ONLY 已改写'))
  assert((await readFile(downloads[2],'utf8')).includes('TEST\\_ONLY 已改写'))
  assert.equal(await readFile(join(workspace,'材料 TEST_ONLY.md'),'utf8'),material)
  pass('real Markdown, Word and LaTeX bytes contain the same accepted edit; selected source is unchanged')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({results,errors,out,paidModelCalls:0},null,2))
}catch(error){await page.screenshot({path:join(out,'failure.png')});throw error}
finally{await writeFile(join(out,'report.json'),JSON.stringify({results,errors},null,2));await writeFile(join(out,'host.log'),hostLog);await browser.close();if(host.exitCode===null){host.kill();await new Promise(done=>host.once('exit',done))}}
