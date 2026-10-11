import React, { useEffect, useRef, useState } from 'react'
import { ProposalRevision } from './proposal-revision.tsx'

type Props={project:any;context:()=>any;api:(method:string,request:any)=>Promise<any>;refresh:()=>Promise<void>;run:(fn:()=>Promise<unknown>)=>void;busy:boolean;request?:{issueId:string;request:string}}
export function ReviewFixes({project,context,api,refresh,run,busy,request}:Props){
  const [proposal,setProposal]=useState<any>(),[active,setActive]=useState<any>(),[message,setMessage]=useState(''),[issueId,setIssueId]=useState('')
  const handled=useRef('')
  const generate=(id:string)=>run(async()=>{
    setIssueId(id);setProposal(undefined);setMessage('正在生成修改建议…')
    const captured=context(),plan=await api('review.prepareFix',{context:captured,issueId:id,instruction:'修复所列问题，保留事实、限定范围、引用和人工内容；仅返回目标完整段落候选。'})
    setActive({context:captured,runId:plan.runId})
    try{const result=await api('runs.start',{context:captured,planId:plan.planId,planHash:plan.planHash})
      if(result.proposal)setProposal(result)
      setMessage(result.paused?'生成已暂停，可在历史中继续。':result.proposal?'请比较原文和修改后内容，再选择采用。':'生成尚未完成，可在历史中查看。')
      await refresh()
    }finally{setActive(undefined)}
  })
  useEffect(()=>{if(request&&request.request!==handled.current){handled.current=request.request;generate(request.issueId)}},[request?.request])
  return <section className="sf-review-fix" aria-label="修改建议">
    {active&&<div className="sf-review-running"><span>正在生成修改建议…</span><button onClick={()=>api('runs.pause',{context:active.context,runId:active.runId}).then(()=>setMessage('已请求暂停。')).catch(error=>setMessage(error.message))}>暂停</button>
      <button onClick={()=>api('runs.cancel',{context:active.context,runId:active.runId}).then(()=>setMessage('已请求停止。')).catch(error=>setMessage(error.message))}>停止</button></div>}
    {message&&<p role="status">{message}</p>}
    {proposal&&<section className="sf-change" aria-label="问题修复差异"><h3>修改建议</h3>
      {proposal.proposal.edits.map((edit:any,index:number)=><div key={index}><b>原文</b><pre>{edit.expectedText}</pre><b>修改后</b><pre>{edit.replacementText}</pre></div>)}
      {proposal.proposal.protectedFactChanges.map((change:string)=><p key={change}>{change}</p>)}
      {proposal.proposal.checks.filter((check:any)=>check.status!=='pass').map((check:any)=><p key={check.id}>{check.detail}</p>)}
      <ProposalRevision key={proposal.proposal.id} image={proposal} context={context} api={api} run={run} busy={busy}
        disabled={project.document.externalChange||proposal.proposal.baseDocumentHash!==project.document.contentHash||project.ledger.proposalStates[proposal.proposal.id]?.state!=='pending'}
        onRevised={async image=>{setProposal(image);await refresh();setMessage('建议已更新，请比较后采用。')}}/>
      {!!(proposal.proposal.citationChanges.added.length+proposal.proposal.citationChanges.removed.length)&&<p>新增 {proposal.proposal.citationChanges.added.length} 条引用，移除 {proposal.proposal.citationChanges.removed.length} 条引用。</p>}
      <div className="sf-page-actions">{project.ledger.proposalStates[proposal.proposal.id]?.state==='pending'&&<>
        <button className="sf-primary" disabled={busy||project.document.externalChange||proposal.proposal.baseDocumentHash!==project.document.contentHash} onClick={()=>run(async()=>{const result=await api('edits.apply',{context:context(),proposalId:proposal.proposal.id,proposalHash:proposal.proposalHash});setProposal(undefined);setMessage(result.recheck?.status==='needs-attention'?'修改已采用，需要重新检查。':'修改已采用，规则检查已更新。');await refresh()})}>采用修改</button>
        <button disabled={busy} onClick={()=>run(async()=>{await api('edits.reject',{context:context(),proposalId:proposal.proposal.id});setProposal(undefined);setMessage('已放弃修改建议。');await refresh()})}>放弃</button></>}
        <button disabled={busy} onClick={()=>generate(issueId)}>重新生成</button><button onClick={()=>setProposal(undefined)}>关闭</button></div>
    </section>}
  </section>
}
