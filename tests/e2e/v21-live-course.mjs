// Explicitly authorized on 2026-10-15: ONE real course task, existing DeepSeek account.
// Never enable a fixture model or load the old reference answer into this workspace.
import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {spawn} from 'node:child_process'
import {mkdir,writeFile,readFile,copyFile,symlink} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {digest,json} from '../../src/core/store/files.ts'
import {stringify} from 'yaml'
import {pathToFileURL} from 'node:url'
const resume=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9),root=resume?resolve(resume):resolve('.dsh-tmp/v21-live-course',String(Date.now()))
const profile=join(root,'profiles/live-course'),workspace=join(root,'真实阅读报告验收'),original='C:/Users/19949/Desktop/科技论文写作',pdf='Graph_Convolution-Based_Decoupling_and_Consistency-Driven_Fusion_for_Multimodal_Emotion_Recognition.pdf'
const model={provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'high'},sourceHashes={}
const requirements='阅读指定科技论文 Graph Convolution-Based Decoupling and Consistency-Driven Fusion for Multimodal Emotion Recognition（Electronics, 2025），着重分析论文的结构及各部分承接关系。必须实质覆盖九项：论文题名；作者姓名与通讯地址；摘要；引言；相关工作；方法；实验结果；讨论与结论；参考文献。分析原论文，不要求报告作者开展自己的实验，也不额外强加报告自身摘要、假设或反方章节。约1500字；A4四页，其中封面一页、正文三页。封面含题目、姓名、学号；姓名与学号未提供，保留待填写，不编造个人信息。正文单面，中文宋体，英文 Times New Roman，小四，1.2倍行距，全部单面打印。提交时间10月30日18:00—18:30，地点A-327；年份未说明，提交和打印仅记录清单，不写入正文。页数必须实际查看验证，不能按字数推断。'
if(!resume){await mkdir(join(profile,'node_modules'),{recursive:true});await mkdir(workspace,{recursive:true})
  await copyFile(join(original,pdf),join(workspace,pdf));await writeFile(join(workspace,'已核对作业要求.txt'),requirements)
  for(const name of [pdf,'作业要求/1.jpg','作业要求/2.jpg','作业要求/3.jpg'])sourceHashes[name]=digest(await readFile(join(original,name)))
  await writeFile(join(profile,'package.json'),JSON.stringify({private:true,dependencies:{'dsh-scholarflow':'link:'+resolve('.').replaceAll('\\','/')},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-scholarflow']}}}))
  await writeFile(join(profile,'cordis.yml'),'[]\n');await writeFile(join(profile,'cordis.patch.yml'),stringify([{id:'credentials',name:'@deepseek-ai/dsh-credentials-local',config:{path:join(process.env.USERPROFILE,'.dsh/.credentials.yaml'),watch:false}},{id:'agent-default-model',name:'@deepseek-ai/dsh-agent-default-model',config:model}]))
  await symlink(resolve('.'),join(profile,'node_modules/dsh-scholarflow'),'junction')
  await writeFile(join(root,'frozen-input.json'),json({date:'2026-10-15',scope:'one course task: intake, outline, first draft, checks, necessary candidate revisions, real export',authorization:'user explicitly confirmed this model/range/account funding',model,sourceHashes,referenceAnswerExcluded:true,
    requirementsInput:'visually checked by Codex against original three images; entered as confirmed text, no claim that product OCR ran',requirements,personalFields:'name and student ID unavailable, remain blank',fees:'existing DSH account quota; no invented price',hostHash:digest(await readFile('dist/host.js')),clientHash:digest(await readFile('dist/client.js'))}))
}
const diagnostic=process.argv.includes('--diagnose-transport')?{NODE_OPTIONS:(process.env.NODE_OPTIONS??'')+' --import '+pathToFileURL(resolve('tests/e2e/host-fetch-diagnostics.mjs')).href,SF_NETWORK_DIAGNOSTICS:join(root,'network-facts.jsonl')}:{}
const install=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness'),host=spawn(join(install,'DeepSeek Harness.exe'),['--expose-internals',join(install,'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'live-course','--no-open','--port','0'],{env:{...process.env,...diagnostic,DSH_HOME:root,ELECTRON_RUN_AS_NODE:'1',DSH_PERMISSION_MODE:'workspace-write'},windowsHide:true,stdio:['ignore','pipe','pipe']})
let log='';host.stdout.on('data',b=>log+=b);host.stderr.on('data',b=>log+=b)
const ready=new Promise((done,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Host boot timeout')),30000);host.stdout.on('data',chunk=>{text+=chunk;const found=text.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);if(found){clearTimeout(timer);done(found[1])}});host.once('exit',code=>{clearTimeout(timer);reject(Error('Host exited '+code))})})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1600,height:1000}}),report={root,model,scope:'one authorized live course task',startedAt:new Date().toISOString(),status:'preparing',quality:'pending independent material-based assessment'}
const rpc=(method,args)=>page.evaluate(async({method,args})=>{const r=await fetch('api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})}),v=(await r.json()).result;if(!v.ok||v.value?.ok===false)throw Error(JSON.stringify(v.error??v.value.error));return v.value?.data??v.value},{method,args})
const dismiss=async()=>{for(let i=0;i<4;i++){const d=page.getByRole('dialog').first();try{await d.waitFor({timeout:i?1000:4000})}catch{return}const text=await d.innerText();if(text.startsWith('预览版说明'))await d.getByRole('button',{name:'继续',exact:true}).click();else if(text.startsWith('添加一个 API Key'))await d.getByRole('button',{name:'稍后配置',exact:true}).click();else return;await d.waitFor({state:'hidden'})}}
let context,taskId
try{
  await page.goto(await ready);await page.getByRole('button',{name:'新建会话',exact:true}).first().waitFor({timeout:45000});await dismiss()
  if(resume){({context,taskId}=JSON.parse(await readFile(join(root,'task-context.json'),'utf8')));const row=page.locator(`[data-row-key="workspace:${context.workspaceId}"]`);if(await row.getAttribute('aria-expanded')!=='true')await row.click();await page.locator(`[data-row-key="session:${context.sessionId}"]`).click()
  }else{
    const workspaceId=(await rpc('workspace/create',{request:{path:workspace}})).workspace.workspaceId;await page.reload();await dismiss();await page.locator(`[data-row-key="workspace:${workspaceId}"]`).hover()
    const [created]=await Promise.all([page.waitForResponse(response=>response.request().postDataJSON()?.method==='session/create'),page.locator('button[aria-label*="真实阅读报告验收"][aria-label*="中新建会话"]').click()]);const sessionId=(await created.json()).result.value.sessionId
    context={requestId:'req_live_course_v21',workspaceId,sessionId};await page.locator('button[title="选择新任务使用的 Agent 预设"]').click();await page.locator('[class*="_item_"]').filter({hasText:/^ScholarFlow/}).click();await page.locator('.sf-wizard').waitFor()
    let spec={title:'图卷积解耦与一致性融合论文阅读分析报告',type:'course-paper',language:'zh-CN',format:'docx',requirements,targetLength:1500,materials:[pdf],requirementSources:[{resourceId:'req_verified_text',origin:'workspace',kind:'file',path:'已核对作业要求.txt',members:[],role:'assignment',state:'connected'}],sections:[],online:false,manuscriptDir:'manuscript',
      brief:{task:{nature:'指定科技论文阅读报告',subject:'Graph Convolution-Based Decoupling and Consistency-Driven Fusion for Multimodal Emotion Recognition',deliverable:'结构与承接关系分析报告'},coverage:['论文题名','作者姓名与通讯地址','摘要','引言','相关工作','方法','实验结果','讨论与结论','参考文献'].map((text,i)=>({id:'coverage_'+i,text,kind:'dimension',sourceRef:'作业要求/2.jpg'})),length:{value:1500,unit:'zh-characters',approximate:true,pages:4,coverPages:1,bodyPages:3,sourceRef:'作业要求/3.jpg'},format:{fileFormat:'docx',cover:true},submission:{when:'10月30日18:00—18:30',where:'A-327',how:'全部单面打印',needsConfirmation:['年份未说明']},origins:{'task.nature':'teacher','length.value':'teacher'}},
      cover:{enabled:true,title:'图卷积解耦与一致性融合论文阅读分析报告',fields:[{label:'姓名',value:''},{label:'学号',value:''}],date:''},typography:{bodyFontZh:'宋体',bodyFontEn:'Times New Roman',bodySizePt:12,lineSpacing:1.2,pageSize:'A4',marginsMm:25,headingNumbering:'decimal',tableOfContents:'none',referencePageBreak:false}}
    console.log(JSON.stringify({stage:'live outline preparation',root,model}));report.status='outline-running';await writeFile(join(root,'live-report.json'),json(report))
    const outlined=await rpc('scholarflow.v1/outline.suggest',{request:{context,spec,operationId:'outline_live_'+Date.now()}});await writeFile(join(root,'outline-candidate.json'),json(outlined.candidate))
    const adopted=await rpc('scholarflow.v1/candidates.adopt',{request:{context,spec,candidateId:outlined.candidate.candidateId}});spec=adopted.spec;assert(spec.sections.length)
    await writeFile(join(root,'confirmed-spec.json'),json(spec));const plan=await rpc('scholarflow.v1/creation.prepare',{request:{context,spec,mode:'first-draft',deliveryGoal:'course-delivery',allowTaskStructure:true}}),started=await rpc('scholarflow.v1/creation.start',{request:{context,planId:plan.planId,planHash:plan.planHash}})
    context.projectId=started.projectId;taskId=started.deliveryTaskId;await writeFile(join(root,'task-context.json'),json({context,taskId}))
  }
  let previous=''
  while(true){const value=await rpc('scholarflow.v1/deliveryTask.inspect',{request:{context,taskId}}),state=value.task;report.status=state.status;report.phase=state.phase;report.message=state.message;report.readiness=value.readiness;report.childCalls=state.calls;report.taskId=taskId;await writeFile(join(root,'live-report.json'),json(report))
    const key=state.phase+':'+state.status+':'+state.message;if(key!==previous){previous=key;console.log(JSON.stringify({phase:state.phase,status:state.status,message:state.message,calls:state.calls.length,root}))}
    if(!['running','queued'].includes(state.status)){if(state.candidateId){const image=await rpc('scholarflow.v1/candidate.inspect',{request:{context,taskId,candidateId:state.candidateId,candidateHash:state.candidateHash}});await writeFile(join(root,'candidate-review.md'),image.candidate.text)}break}
    await new Promise(done=>setTimeout(done,2500))
  }
  await page.reload();await dismiss();await page.locator('[data-node="review"]').click();await page.screenshot({path:join(root,'live-state.png'),fullPage:true})
}catch(error){report.status='failed';report.error=String(error.stack);await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});throw error}
finally{const frozen=JSON.parse(await readFile(join(root,'frozen-input.json'),'utf8'));report.sourceHashesUnchanged=true;for(const [path,hash]of Object.entries(frozen.sourceHashes))if(digest(await readFile(join(original,path)))!==hash)report.sourceHashesUnchanged=false;report.finishedAt=new Date().toISOString();await writeFile(join(root,'live-report.json'),json(report));await writeFile(join(root,'host-log.txt'),log.replace(/token=[^\s]+/gu,'token=[redacted]'));await browser.close();host.kill()}
console.log(JSON.stringify({root,status:report.status,phase:report.phase}))
