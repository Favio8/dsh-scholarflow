import React, { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { FORMAT_LABELS } from './paper-workspace.tsx'
import type { ExportFormat } from '../shared/presentation.ts'
import { ModelReview } from './model-review.tsx'
import { ReviewFixes } from './review-fixes.tsx'
import {reviewItems} from './review-presentation.ts'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
export function ReviewExport({ project, context, api, refresh, run, busy, mode, onLocate, format = 'markdown', exportTrigger = 0, editor, onSources }: Props & { mode: string; format?: ExportFormat; exportTrigger?: number; onLocate: (location: any) => void; editor?:any; onSources?:()=>void }) {
  const [review, setReview] = useState<any>(), [message, setMessage] = useState('')
  const [lastDelivery,setLastDelivery]=useState<any>()
  const handledTrigger = useRef(0)
  const download = (data: BlobPart, filename: string, type: string) => {
    const url = URL.createObjectURL(new Blob([data], { type })), link = document.createElement('a')
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const bytes = (file: any): string | Uint8Array => file.encoding === 'base64'
    ? Uint8Array.from(atob(file.base64), character => character.charCodeAt(0)) : file.text
  const downloadBundle = async (deliveryId: string) => {
    const result = await api('export.read', { context: context(), deliveryId }), zip = new JSZip()
    for (const file of result.files) zip.file(file.relativePath, bytes(file))
    zip.file('manifest.json', JSON.stringify(result.manifest, null, 2))
    download(new Uint8Array(await zip.generateAsync({ type: 'uint8array' })).buffer, `ScholarFlow-${deliveryId}.zip`, 'application/zip')
  }
  useEffect(() => {
    if (!exportTrigger || exportTrigger === handledTrigger.current) return
    handledTrigger.current = exportTrigger
    run(async () => {
      setMessage('正在导出…')
      const plan = await api('export.preflight', { context: context(), format })
      const result = await api('export.create', { context: context(), planId: plan.planId, planHash: plan.planHash,
        deliveryType: plan.reviewedAllowed ? 'reviewed-draft' : 'working-draft' })
      const delivery = await api('export.read', { context: context(), deliveryId: result.manifest.id })
      const extension = format === 'docx' ? 'docx' : format === 'latex' ? 'tex' : 'md'
      const main = delivery.files.find((file: any) => file.relativePath === 'paper.' + extension)
      if (!main) throw new Error('交付中缺少所选格式的正文。')
      const data = bytes(main)
      if(delivery.files.some((file:any)=>file.relativePath.startsWith('assets/'))||format==='latex')await downloadBundle(result.manifest.id)
      else download(typeof data === 'string' ? data : new Uint8Array(data).buffer, project.config.project.title.replace(/[<>:"/\\|?*]/g, '_') + '.' + extension, main.mediaType)
      setLastDelivery(result.manifest)
      setMessage('已导出 '+(plan.reviewedAllowed?'已审查草稿':'工作草稿')+' · '+FORMAT_LABELS[format]+(plan.reviewState==='review-stale'?' · 审查已过期':plan.unresolvedIssueIds.length?' · 仍有待检查项':' · '+(plan.reviewedAllowed?'审查对应当前版本':'尚未完成全部审查')))
      await refresh()
    })
  }, [exportTrigger])
  const [reasons,setReasons]=useState<Record<string,string>>({}),[fixRequest,setFixRequest]=useState<{issueId:string;request:string}>()
  useEffect(()=>{let live=true
    api('review.inspect',{context:context()}).then(value=>live&&setReview(value)).catch(error=>live&&setMessage(error.message))
    return()=>{live=false}
  },[project.ledger.revision,project.document.contentHash,project.document.externalChange])
  const items=reviewItems(project),passed=review?.report?.checks.filter((check:any)=>check.status==='pass').length??0
  return <>
    {message&&mode!=='Export'&&<div className="sf-editor-notice" role="status">{message}{lastDelivery&&<><button disabled={busy} onClick={()=>run(()=>downloadBundle(lastDelivery.id))}>下载完整交付包</button><button disabled={busy} onClick={()=>run(async()=>{const result=await api('export.read',{context:context(),deliveryId:lastDelivery.id}),file=result.files.find((row:any)=>row.relativePath==='quality-report.md');download(file.text,'quality-report.md','text/markdown;charset=utf-8')})}>下载检查报告</button></>}</div>}
    <section id="sf-panel-Review" className="sf-review-panel" role="tabpanel" hidden={mode!=='Review'} aria-label="检查与修改">
      <header className="sf-page-heading"><h2>检查与修改</h2></header>
      <ModelReview project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} onReview={setReview} editor={editor}/>
      <p className="sf-review-summary" role="status">{review?.stale?'正文或资料已更新，请重新检查。':review?.report?items.length?'发现 '+items.length+' 项需要处理或确认的问题。':'当前没有待处理问题。':'点击检查全文，查看问题与修改建议。'}</p>
      {!!passed&&!review?.stale&&<p className="sf-muted">{passed} 项检查已通过。</p>}
      {items.map(item=><article className="sf-review-item" data-sf-review-id={item.issue.id} key={item.key}>
        <header><span className="sf-review-kind">{item.identity?'待核对':item.issue.severity==='B0'?'需要处理':item.issue.severity==='B2'?'表达建议':'待检查'}</span><small className="sf-muted">{item.method}</small></header>
        <h3>{item.title}</h3>{item.detail!==item.title&&<p>{item.detail}</p>}
        {item.issue.location&&<blockquote>{item.issue.location.quote}</blockquote>}
        {item.issue.suggestedFix&&<p className="sf-review-advice">{item.issue.suggestedFix}</p>}
        <div className="sf-page-actions">
          {item.issue.location&&<><button disabled={busy} onClick={()=>run(async()=>onLocate(await api('review.locateIssue',{context:context(),issueId:item.issue.id})))}>定位正文</button>
            <button disabled={busy} onClick={()=>setFixRequest({issueId:item.issue.id,request:crypto.randomUUID()})}>生成修改建议</button></>}
          {item.sourceId&&<button onClick={onSources}>查看参考来源</button>}
        </div>
        <details className="sf-detail"><summary>暂不修改此问题</summary><label>原因<input value={reasons[item.key]??''} onChange={event=>setReasons({...reasons,[item.key]:event.target.value})}/></label>
          <button disabled={busy||!reasons[item.key]?.trim()} onClick={()=>run(async()=>{const current=context();for(const issueId of item.issueIds){const result=await api('review.decideIssue',{context:current,issueId,state:'accepted-risk',reason:reasons[item.key]});current.expectedLedgerRevision=result.revision}await refresh()})}>保留问题并记录原因</button></details>
      </article>)}
      <ReviewFixes project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} request={fixRequest}/>
    </section>
    {mode==='ReviewHistory'&&<ModelReview project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} onReview={setReview} historyOnly/>}
    <section id="sf-panel-Export" className="sf-history-panel" role="tabpanel" hidden={mode!=='Export'} aria-label="导出记录"><header className="sf-page-heading"><h2>导出记录</h2></header>
      {(Object.values(project.ledger.deliveries) as any[]).reverse().map(delivery=><article className="sf-reference-row" key={delivery.id}><strong>{new Date(delivery.createdAt).toLocaleString()}</strong><p className="sf-muted">{delivery.reviewState==='draft-reviewed'?'已完成工具检查':delivery.reviewState==='review-stale'?'检查对应旧版本':'工作草稿'}</p>
        <button disabled={busy} onClick={()=>run(()=>downloadBundle(delivery.id))}>下载完整交付包</button>
        <details className="sf-detail"><summary>下载单个文件</summary>{delivery.files.map((file:any)=><button key={file.relativePath} disabled={busy} onClick={()=>run(async()=>{const result=await api('export.read',{context:context(),deliveryId:delivery.id}),content=result.files.find((item:any)=>item.relativePath===file.relativePath);download(bytes(content) as BlobPart,file.relativePath,content.mediaType??'text/plain;charset=utf-8')})}>{file.relativePath}</button>)}</details>
      </article>)}
      {!Object.keys(project.ledger.deliveries).length&&<p className="sf-muted">顶部导出后，文件会保存在这里。</p>}
      <p role="status">{message}</p>
    </section>
  </>
}
