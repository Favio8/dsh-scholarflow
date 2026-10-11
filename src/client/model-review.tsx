import React, { useEffect, useRef, useState } from 'react'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean; onReview: (value: any) => void; historyOnly?:boolean; editor?:any }
export function ModelReview({ project, context, api, refresh, run, busy, onReview, historyOnly=false,editor }: Props) {
  const [actionPlan,setActionPlan]=useState<any>(),[history,setHistory]=useState<any>(),[version,setVersion]=useState(0)
  const [active,setActive]=useState<any>(),[progress,setProgress]=useState<any>(),[message,setMessage]=useState('')
  const binding=project.binding.projectId+':'+project.binding.sessionId,liveBinding=useRef(binding);liveBinding.current=binding
  useEffect(()=>{if(!historyOnly)return;let live=true
    api('runs.list',{context:context()}).then(value=>live&&setHistory(value)).catch(error=>live&&setMessage(error.message))
    return()=>{live=false}
  },[historyOnly,project.ledger.revision,version,binding])
  useEffect(()=>{
    if(!active)return
    let live=true,pending=false
    const timer=setInterval(async()=>{if(pending)return;pending=true
      try{const value=await api('runs.inspect',{context:active.context,runId:active.runId});if(live)setProgress(value)}
      catch{ /* The running request owns the final result; retain its progress during publication. */ }
      finally{pending=false}
    },1000)
    return()=>{live=false;clearInterval(timer)}
  },[active?.runId])
  const execute=async(preview:any,captured:any,action=false)=>{
    const scope=binding
    setActive({context:captured,runId:preview.runId});setProgress(undefined);setActionPlan(undefined);setMessage('正在检查全文…')
    try{
      const result=await api(action?'review.confirmAction':'review.startModel',{context:captured,planId:preview.planId,planHash:preview.planHash})
      if(liveBinding.current===scope){
        if(result.report)onReview({report:result.report,stale:false})
        setMessage(result.paused?'检查已暂停，可在历史中继续。':result.run.status==='completed'?'全文检查已完成。':'检查尚未完成，可在历史中查看原因。')
        await refresh()
      }
    }finally{if(liveBinding.current===scope){setActive(undefined);setVersion(value=>value+1)}}
  }
  const check=()=>run(async()=>{
    setMessage('正在检查结构与引用…')
    if(editor?.dirty)await editor.save()
    const captured=context(),rules=await api('review.run',{context:captured})
    onReview(rules);await refresh()
    const current={...captured,expectedLedgerRevision:rules.revision}
    try{
      const preview=await api('review.prepareModel',{context:current})
      await execute(preview,current)
    }catch(error){setMessage('规则检查已完成；AI 检查未完成：'+(error as Error).message);await refresh()}
  })
  const rows=history?.runs.filter((row:any)=>row.stage==='review')??[]
  return <section className={historyOnly?'sf-review-history':'sf-review-action'} aria-label={historyOnly?'检查运行历史':'检查全文'}>
    {!historyOnly&&<><button className="sf-primary" disabled={busy||project.document.externalChange||editor?.dirty&&!editor.canSave} onClick={check}>{editor?.dirty?'保存并检查全文':'检查全文'}</button>
      <span className="sf-muted">检查已保存正文与引用，使用当前会话模型。</span></>}
    {active&&<div className="sf-review-running"><span role="status">{progress?.run.status==='paused'?'正在暂停…':'正在检查全文…'}</span>
      <button onClick={()=>api('runs.pause',{context:active.context,runId:active.runId}).then(()=>setMessage('已请求暂停。')).catch(error=>setMessage(error.message))}>暂停</button>
      <button onClick={()=>api('runs.cancel',{context:active.context,runId:active.runId}).then(()=>setMessage('已请求停止。')).catch(error=>setMessage(error.message))}>停止</button></div>}
    {historyOnly&&<><header className="sf-page-heading"><h3>检查运行</h3><button disabled={busy} onClick={()=>setVersion(value=>value+1)}>刷新</button></header>
      {rows.map((row:any)=><article className="sf-reference-row" key={row.runId}><strong>{new Date(row.startedAt).toLocaleString()} · {({completed:'已完成',paused:'已暂停',failed:'未完成',cancelled:'已停止',interrupted:'已中断',running:'进行中',queued:'准备中'} as Record<string,string>)[row.status]??'等待处理'}</strong>
        {!row.inheritedArchive&&['paused','interrupted','running','queued','waiting-input','failed','cancelled'].includes(row.status)&&<button disabled={busy||!!actionPlan} onClick={()=>run(async()=>setActionPlan(await api('review.prepareAction',{context:context(),runId:row.runId,action:['failed','cancelled'].includes(row.status)?'retry':'resume'})))}>继续检查</button>}
        <details className="sf-detail"><summary>运行详情</summary><p>{row.runId} · 模型调用 {row.usedModelCalls} 次{row.errorCode?' · '+row.errorCode:''}</p></details>
      </article>)}
      {!rows.length&&<p className="sf-muted">尚无检查运行记录。</p>}
      {history?.diagnostics.map((warning:string,index:number)=><p role="alert" key={index}>{warning}</p>)}</>}
    {actionPlan&&<section role="dialog" aria-label="继续检查确认"><h4>继续检查</h4><p>{actionPlan.existingReportId?'已有结果会直接恢复。':'使用已保存的检查范围和当前会话模型。'}</p>
      <button disabled={busy} onClick={()=>run(()=>execute(actionPlan,context(),true))}>继续</button><button disabled={busy} onClick={()=>run(async()=>{await api('review.dismissAction',{planId:actionPlan.planId});setActionPlan(undefined)})}>取消</button></section>}
    {message&&<p role="status">{message}</p>}
  </section>
}
