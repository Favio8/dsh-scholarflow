import React,{useEffect,useRef,useState} from 'react'
import {MarkdownView} from './markdown.tsx'
import {projectMarkdown} from '../core/editing/markdown.ts'
const labels:Record<string,string>={'needs-check':'待检查','needs-adoption':'待采用','needs-materials':'需要补充材料','needs-verification':'有项目待核对',ready:'本次要求已核对，待你确认交付','research-incomplete':'科研初稿已准备，仍有研究待补'}
export function DeliveryProgress({project,api,context,refresh,onState,onOpen,dirty}:any){
  const [value,setValue]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const latest=useRef({context,refresh,onState,project});latest.current={context,refresh,onState,project}
  useEffect(()=>{let live=true,timer:number|undefined,lastSignature=''
    const load=async()=>{try{const result=await api('deliveryTask.inspect',{context:latest.current.context()});if(!live)return
      const signature=JSON.stringify([result.task?.id,result.task?.revision,result.ledgerRevision,result.documentHash,result.readiness,result.inputProblem,result.candidateReview?.stale,result.candidateReview?.report?.id])
      if(signature!==lastSignature){lastSignature=signature;setValue(result);latest.current.onState(result);if(result.ledgerRevision!==undefined&&result.ledgerRevision!==latest.current.project.ledger.revision)await latest.current.refresh()}
      setError('')
    }catch(e){if(live)setError((e as Error).message)}finally{if(live)timer=window.setTimeout(load,1500)}}
    void load();return()=>{live=false;window.clearTimeout(timer)}
  },[project.binding.projectId,project.binding.sessionId])
  const task=value?.task
  if(!task)return error?<span role="alert">交付状态读取未完成</span>:null
  const running=['running','queued'].includes(task.status),pending=task.calls.some((call:any)=>['pending','unknown'].includes(call.status)&&!task.acknowledgedUnknownCalls?.[call.runId])
  const action=async(name:string)=>{setBusy(true);try{const unknown=name==='resume'&&pending;if(unknown&&!window.confirm('有模型请求回执不明。继续会重新发送未完成请求，可能产生额外费用。是否继续？'))return
    await api('deliveryTask.action',{context:context(),taskId:task.id,action:name,expectedTaskRevision:task.revision,acknowledgeUnknownCall:unknown});await refresh()
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <section className="sf-writing-progress sf-progress-pill sf-delivery-progress" aria-label="交付任务进度" data-alert={!running&&value.readiness?.state!=='ready'||undefined}>
    <style>{'.sf-toolbar-progress:has(.sf-delivery-progress)>.sf-writing-progress:not(.sf-delivery-progress){display:none}.sf-result-preview{max-height:65vh;overflow:auto;overflow-wrap:anywhere}.sf-result-preview table{max-width:100%}'}</style>
    <span className={`sf-progress-dot ${running?'sf-progress-working':''}`}/><span className="sf-progress-summary" role="status">{dirty?'正文有未保存修改，保存后需核对':running?task.message:task.pendingStructure?'结构调整待确认':task.status==='paused'?'已暂停':task.status==='cancelled'?'已停止':labels[value.readiness?.state]??task.message}</span>
    <details className="sf-progress-details"><summary>详情</summary><div className="sf-issue-popover"><p>{task.message}</p>
      {running?<><button disabled={busy} onClick={()=>void action('pause')}>暂停</button><button disabled={busy} onClick={()=>void action('cancel')}>停止</button></>:!['succeeded','completed-with-issues','cancelled'].includes(task.status)&&<>{value.recovery!=='adoption-committed'&&<button disabled={busy||task.phase==='awaiting-adoption'||task.pendingStructure} onClick={()=>void action('resume')}>继续当前任务</button>}<button disabled={busy} onClick={()=>void action('cancel')}>停止当前任务</button></>}
      {value.recovery==='adoption-committed'&&<button disabled={busy} onClick={()=>void action('resume')}>继续保存后的复查</button>}
      <button onClick={onOpen}>查看修改与交付</button>{error&&<p role="alert">{error}</p>}
      <details><summary>当前核对与运行依据</summary>{value.readiness?.reasons.map((reason:string)=><p key={reason}>{reason}</p>)}<p>{task.calls.filter((call:any)=>call.status==='succeeded').length} 个已返回子调用；首稿调用保留原任务身份。</p></details>
    </div></details>
  </section>
}
export function DeliveryCandidate({value,project,api,context,refresh,run,busy,editor,onSources}:any){
  const task=value?.task,[candidate,setCandidate]=useState<any>(),[plan,setPlan]=useState<any>(),[message,setMessage]=useState(''),[citationLabels,setCitationLabels]=useState<any>(),[factChanges,setFactChanges]=useState<string[]>([]),[claimChanges,setClaimChanges]=useState<any[]>([])
  useEffect(()=>{if(task?.phase==='finished')setMessage('')},[task?.phase])
  useEffect(()=>{let live=true;setPlan(undefined);setCandidate(undefined);if(!task?.candidateId)return
    api('candidate.inspect',{context:context(),taskId:task.id,candidateId:task.candidateId,candidateHash:task.candidateHash}).then(async(result:any)=>{const citations=await api('document.citations',{context:context(),text:result.candidate.text}),preview=task.phase==='awaiting-adoption'&&!value.inputProblem&&!value.candidateReview?.stale?await api('candidate.prepareAdoption',{context:context(),taskId:task.id,candidateId:task.candidateId,candidateHash:task.candidateHash,checkId:task.checkId}):undefined;if(live){setCandidate(result.candidate);setCitationLabels(citations.labels);setFactChanges(result.factChanges);setClaimChanges(result.claimChanges??[]);setPlan(preview)}}).catch((e:Error)=>live&&setMessage(e.message))
    return()=>{live=false}
  },[task?.candidateId,task?.candidateHash,task?.phase,project.binding.projectId,value.inputProblem?.code,value.candidateReview?.stale])
  if(!task)return null
  const dirty=editor?.dirty,stale=!task.adoptionDecided&&(candidate&&candidate.baseDocumentHash!==project.document.contentHash||value.candidateReview?.stale||value.inputProblem)
  const candidateAction=async(action:string)=>{const unknown=task.calls.some((call:any)=>['pending','unknown'].includes(call.status)&&!task.acknowledgedUnknownCalls?.[call.runId]);if(unknown&&!window.confirm('有模型请求回执不明。继续会重新发送未完成请求，可能产生额外费用。是否继续？'))return;await api('deliveryTask.action',{context:context(),taskId:task.id,action,expectedTaskRevision:task.revision,acknowledgeUnknownCall:unknown});await refresh()}
  const adopt=async()=>{const bufferHash=editor?.adoptionHash?await editor.adoptionHash():project.document.contentHash,result=await api('candidate.adopt',{context:context(),taskId:task.id,candidateId:candidate.id,candidateHash:task.candidateHash,planId:plan.planId,planHash:plan.planHash,bufferHash});setMessage(result.recheck==='needs-attention'?'修改已保存，实际复查需要继续。':'修改已保存，正在实际复查与准备文件。');setPlan(undefined);await refresh()}
  return <section aria-label="连续任务的检查与交付"><header className="sf-page-heading"><h2>{task.goal==='course-delivery'?'课程论文交付':'已有结果成稿'}</h2></header><p role="status">{task.message}</p>
    {value.readiness?.state&&<p>{labels[editor?.dirty?'needs-check':value.readiness.state]}</p>}
    {task.missingMaterials.length>0&&<button onClick={onSources}>补充研究结果与材料</button>}
    {value.inputProblem&&<p role="status">{value.inputProblem.message}</p>}
    {!task.adoptionDecided&&!value.candidateReview?.stale&&value.candidateReview?.report?.checks.some((check:any)=>check.id==='own_result_units'&&check.status!=='pass')&&<p>用于正文的数值结果还缺少确认的单位或无量纲口径。<button onClick={onSources}>核对研究结果</button></p>}
    {candidate&&(task.phase==='awaiting-adoption'||task.pendingStructure)&&<><section aria-label={task.pendingStructure?'结构调整预览':'最终修改预览'} className="sf-review-preview"><h3>{task.pendingStructure?'结构调整预览（尚未完成核对）':'最终修改预览'}</h3><div className="sf-review-edit">
      <div className="sf-result-preview"><strong>当前已保存主稿</strong><MarkdownView projection={projectMarkdown(project.document.text,[],citationLabels)}/></div>
      <div className="sf-result-preview"><strong>{task.pendingStructure?'本次结构调整候选（未采用、待核对）':'本次最终候选（未采用）'}</strong><MarkdownView projection={projectMarkdown(candidate.text,[],citationLabels)}/></div>
    </div>{factChanges.map(text=><p key={text}>{text}</p>)}{claimChanges.length>0&&<details><summary>本次还将更新 {claimChanges.length} 个关联论点的表述与依据</summary>{claimChanges.map(change=><div key={change.id}><p>原表述：{change.before}</p><p>候选表述：{change.after}</p></div>)}</details>}</section>
      {(dirty||stale)&&<p>正文有新修改，请先保存并重新建立候选基准。</p>}
      {task.pendingStructure?<><p>本轮尚未授权此结构调整。当前主稿保持原样；允许后继续检查，最终仍需一次采用。</p><button disabled={busy||dirty||stale} onClick={()=>run(()=>candidateAction('allow-structure'))}>允许本次结构调整并继续核对</button><button disabled={busy||dirty||stale} onClick={()=>run(()=>candidateAction('keep-structure'))}>保持原结构继续</button></>:<><button className="sf-primary" disabled={busy||dirty||stale||!plan} onClick={()=>run(adopt)}>采用修改</button><button disabled={busy||dirty||stale} onClick={()=>run(()=>candidateAction('keep-original'))}>保留原稿</button></>}
    </>}
    {candidate&&task.phase!=='awaiting-adoption'&&!task.pendingStructure&&!task.adoptionDecided&&<details className="sf-detail"><summary>查看已保留的候选</summary><p>候选尚未完成核对，当前主稿保持原样。</p><MarkdownView projection={projectMarkdown(candidate.text,[],citationLabels)}/></details>}
    {!task.adoptionDecided&&value.candidateReview&&<details className="sf-detail"><summary>候选核对详情</summary>{value.candidateReview.stale?<p>这份检查对应先前候选或依据，需按当前输入重新核对。</p>:value.candidateReview.report.checks.filter((check:any)=>check.status!=='pass'&&!task.advisoryCheckIds.includes(check.id)).map((check:any)=><p key={check.id}>{check.status==='fail'?'需处理':'待核对'}：{check.detail}</p>)}</details>}
    {value.candidateReview?.stale&&!value.inputProblem&&!task.adoptionDecided&&!task.pendingStructure&&candidate?.baseDocumentHash===project.document.contentHash&&<button disabled={busy||dirty||['queued','running'].includes(task.status)} onClick={()=>run(()=>candidateAction('recheck'))}>重新核对当前候选</button>}
    {(value.inputProblem||!task.adoptionDecided&&(value.candidateReview?.stale||candidate&&candidate.baseDocumentHash!==project.document.contentHash))&&<DeliveryStart key={task.id} {...{project,api,context,run,busy,refresh,editor}} currentTask={task}/>}
    {task.deliveryId&&<p>交付文件已保存，可从顶部导出或版本历史中的导出记录下载同快照文件。</p>}
    {task.deliveryId&&<ArtifactVerification {...{value,api,context,run,busy,refresh}}/>}
    {message&&<p role="status">{message}</p>}
    <details className="sf-detail"><summary>查看当前未完成项</summary>{value.readiness?.reasons.map((reason:string)=><p key={reason}>{reason}</p>)}</details>
  </section>
}
export function DeliveryStart({project,api,context,run,busy,refresh,editor,currentTask}:any){
  const [goal,setGoal]=useState(currentTask?.goal??(project.config.project.type==='research-paper'?'research-results':'course-delivery')),[kind,setKind]=useState(currentTask?.researchKind??'ai-method'),[allow,setAllow]=useState(currentTask?.allowStructure??false),[plan,setPlan]=useState<any>(),[message,setMessage]=useState('')
  const start=async()=>{try{if(editor?.adoptionHash)await editor.adoptionHash();if(currentTask){const latest=await api('deliveryTask.inspect',{context:context()});if(latest.task?.id!==currentTask.id)throw Error('当前任务已变化，请重新读取后预览。');if(!['succeeded','completed-with-issues','failed','cancelled'].includes(latest.task.status))await api('deliveryTask.action',{context:context(),taskId:currentTask.id,action:'cancel',expectedTaskRevision:latest.task.revision})}await api('deliveryTask.start',{context:context(),planId:plan.planId,planHash:plan.planHash});setPlan(undefined);setMessage('本次任务已在后台开始。');await refresh()}catch(error){setPlan(undefined);setMessage('新任务未开始，请刷新状态并重新预览；原稿、旧任务和候选历史均已保留。');await refresh();throw error}}
  return <details className="sf-detail"><summary>{currentTask?'按当前输入重新预览任务':'开始本次完整交付任务'}</summary><p>按已保存要求和当前选用材料继续检查与完善。旧任务不会自动升级；最终修改集中预览后由你一次采用。</p>{currentTask&&<p>确认新计划时会停止旧任务，保留旧候选和全部历史，再按当前输入开始。</p>}
    <label>本次完整目标<select value={goal} onChange={e=>{setGoal(e.target.value);setPlan(undefined)}}><option value="course-delivery">课程论文完整交付</option><option value="research-results">用已有研究结果写初稿</option></select></label>
    {goal==='research-results'&&<label>研究类型<select value={kind} onChange={e=>{setKind(e.target.value);setPlan(undefined)}}><option value="ai-method">AI 方法研究</option><option value="systems">系统研究</option><option value="benchmark">数据集或基准研究</option><option value="theoretical">理论研究</option></select></label>}
    <label><input type="checkbox" checked={allow} onChange={e=>{setAllow(e.target.checked);setPlan(undefined)}}/>允许按当前要求调整本次候选结构</label>
    {editor?.dirty&&<p>请先保存当前人工编辑，再建立任务基准。</p>}
    <button disabled={busy||editor?.dirty||project.document.initialPlaceholder&&goal==='course-delivery'} onClick={()=>run(async()=>{setPlan(await api('deliveryTask.prepare',{context:context(),goal,researchKind:kind,allowStructure:allow}));setMessage('')})}>预览本次任务</button>
    {plan&&<><p>{plan.scope}</p><p>模型：{plan.model.providerId} / {plan.model.modelId}；联网：{plan.online?'沿用已确认提供方':'关闭'}。调用消耗沿用当前宿主账号。</p><button disabled={busy||editor?.dirty} onClick={()=>run(start)}>{currentTask?'确认停止旧任务并按新计划继续':'确认开始连续任务'}</button></>}
    {message&&<p role="status">{message}</p>}
  </details>
}
function ArtifactVerification({value,api,context,run,busy,refresh}:any){
  const [viewer,setViewer]=useState(''),[reason,setReason]=useState(''),[pages,setPages]=useState(''),[cover,setCover]=useState(''),[body,setBody]=useState('')
  const checks=value.artifacts?.checks??[],pagination=checks.find((check:any)=>check.id==='rendered_pagination')
  return <details className="sf-detail"><summary>实际文件与排版核对</summary>{checks.map((check:any)=><p key={check.id}>{check.status==='pass'?'已核对':check.status==='fail'?'需处理':'待核对'}：{check.detail}</p>)}
    {pagination&&<><p>先在 Word 或等效环境打开当前导出文件，再填写实际看到的页数；不能按正文长度估算。</p>
      <label>实际查看环境<input value={viewer} onChange={e=>setViewer(e.target.value)} placeholder="例如 Word 桌面版"/></label>
      <label>总页数<input type="number" min="1" value={pages} onChange={e=>setPages(e.target.value)}/></label><label>封面页数<input type="number" min="0" value={cover} onChange={e=>setCover(e.target.value)}/></label><label>正文页数<input type="number" min="1" value={body} onChange={e=>setBody(e.target.value)}/></label>
      <label>查看与核对依据<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={busy||!viewer.trim()||reason.trim().length<10||!pages||!cover||!body} onClick={()=>run(async()=>{await api('export.confirmLayout',{context:context(),deliveryId:value.task.deliveryId,viewer,reason,pages:Number(pages),coverPages:Number(cover),bodyPages:Number(body)});await refresh()})}>记录实际查看结果</button>
    </>}
  </details>
}
