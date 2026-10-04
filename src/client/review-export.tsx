import React, { useEffect, useState } from 'react'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
export function ReviewExport({ project, context, api, refresh, run, busy, mode }: Props & { mode: string }) {
  const [review, setReview] = useState<any>(), [plan, setPlan] = useState<any>(), [message, setMessage] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [manualCheck, setManualCheck] = useState(''), [manualStatus, setManualStatus] = useState('unknown'), [manualReason, setManualReason] = useState('')
  const [manualEvidence, setManualEvidence] = useState<string[]>([]), [manualClaims, setManualClaims] = useState<string[]>([]), [manualPlan, setManualPlan] = useState<any>()
  useEffect(() => { let live = true; setPlan(undefined)
    api('review.inspect', { context: context() }).then(value => live && setReview(value)).catch(error => live && setMessage(error.message))
    return () => { live = false }
  }, [project.ledger.revision, project.document.contentHash, project.document.externalChange])
  const issues = Object.values(project.ledger.reviewIssues) as any[]
  return <>
    <section id="sf-panel-Review" role="tabpanel" aria-labelledby="sf-tab-Review" hidden={mode !== 'Review'} aria-label="审查"><h3>审查</h3>
      <p>规则检查、模型辅助与人工判断分别显示。未知项不能当作通过；问题经对应复查后才关闭。</p>
      <button disabled={busy || project.document.externalChange} onClick={() => run(async () => {
        const result = await api('review.run', { context: context() }); setReview(result); await refresh()
      })}>运行确定性审查</button>
      {review?.report ? <><p role="status">审查 {review.report.id} · {review.stale ? '已过期，需按当前版本重跑' : '对应当前版本'}</p>
        <ul aria-label="审查检查结果">{review.report.checks.map((check: any) => <li key={check.id}>{check.status} · {check.method} · {check.detail}</li>)}</ul>
        {review.report.limitations.map((limit: string) => <p key={limit}>{limit}</p>)}</> : <p>当前尚无审查快照。</p>}
      {review?.report && <section aria-label="人工同版本复核"><h4>人工复核与依据</h4>
        <p>只复核当前稿件的可人工判断项；填写具体依据后预览确认。缺失实验、不可用证据与确定性失败须先修复，不能勾选绕过。</p>
        <label>人工复核检查<select aria-label="人工复核检查" value={manualCheck} disabled={busy || review.stale || !!manualPlan} onChange={e => { setManualCheck(e.target.value); setManualEvidence([]); setManualClaims([]); setManualReason('') }}><option value="">请选择</option>
          {review.manualEligible?.map((id: string) => <option key={id} value={id}>{id} · {review.report.checks.find((row: any) => row.id === id)?.status}</option>)}</select></label>
        <label>人工复核结果<select aria-label="人工复核结果" disabled={busy || !!manualPlan} value={manualStatus} onChange={e => setManualStatus(e.target.value)}><option value="unknown">未知／依据不足</option><option value="fail">发现问题</option><option value="pass">已核对，通过此项</option></select></label>
        <label>人工复核依据<textarea aria-label="人工复核依据" rows={4} maxLength={4000} value={manualReason} disabled={busy || !!manualPlan} onChange={e => setManualReason(e.target.value)} /></label>
        <label>人工复核关联证据<select aria-label="人工复核关联证据" multiple size={4} value={manualEvidence} disabled={busy || !!manualPlan} onChange={e => setManualEvidence(Array.from(e.target.selectedOptions, option => option.value))}>
          {(Object.values(project.ledger.evidence) as any[]).map(row => <option key={row.id} value={row.id}>{row.id} · {row.kind} · {row.excerpt.slice(0, 100)}</option>)}</select></label>
        <label>人工复核关联论点<select aria-label="人工复核关联论点" multiple size={4} value={manualClaims} disabled={busy || !!manualPlan} onChange={e => setManualClaims(Array.from(e.target.selectedOptions, option => option.value))}>
          {(Object.values(project.ledger.claims) as any[]).map(row => <option key={row.id} value={row.id}>{row.id} · {row.text.slice(0, 100)}</option>)}</select></label>
        <button disabled={busy || review.stale || !!manualPlan || !manualCheck || manualReason.trim().length < 10} onClick={() => run(async () => setManualPlan(await api('review.prepareManual', { context: context(), reviewId: review.report.id,
          assessments: [{ checkId: manualCheck, status: manualStatus, reason: manualReason.trim(), evidenceIds: manualEvidence, claimIds: manualClaims,
            requirementIds: manualCheck.startsWith('requirement_') ? [manualCheck.slice('requirement_'.length)] : [] }] })))}>预览人工复核结果</button>
        {manualPlan && <section role="dialog" aria-label="人工复核确认"><h4>确认同版本人工结果</h4><p>{manualPlan.reviewId} · {manualPlan.documentHash}</p>
          <pre>{JSON.stringify(manualPlan.assessments, null, 2)}</pre>{manualPlan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
          <button disabled={busy} onClick={() => run(async () => { const result = await api('review.submitManual', { context: context(), planId: manualPlan.planId, planHash: manualPlan.planHash }); setReview(result); setManualPlan(undefined); setManualReason(''); await refresh() })}>确认保存人工复核</button>
          <button disabled={busy} onClick={() => run(async () => { await api('review.dismissManual', { planId: manualPlan.planId }); setManualPlan(undefined) })}>取消人工复核预览</button></section>}
      </section>}
      {issues.map(issue => <section key={issue.id} aria-label={`审查问题 ${issue.id}`}><h4>{issue.severity} · {issue.title}</h4>
        <p>{issue.checkMethod} · {issue.state} · {issue.stale ? '需更新' : '当前'} · {issue.explanation}</p>
        {issue.resolutionReason && <p>处理理由：{issue.resolutionReason}</p>}
        {issue.state !== 'resolved' && <><label>处理理由<input aria-label={`处理理由 ${issue.id}`} value={reasons[issue.id] ?? ''} onChange={e => setReasons({ ...reasons, [issue.id]: e.target.value })} maxLength={2000} /></label>
          {(['accepted-risk', 'dismissed'] as const).map(state => <button key={state} disabled={busy || !(reasons[issue.id] ?? '').trim()} onClick={() => run(async () => {
            await api('review.decideIssue', { context: context(), issueId: issue.id, state, reason: reasons[issue.id] }); await refresh()
          })}>{state === 'accepted-risk' ? '记录接受风险' : '记录不采纳理由'}</button>)}</>}
      </section>)}
    </section>
    <section id="sf-panel-Export" role="tabpanel" aria-labelledby="sf-tab-Export" hidden={mode !== 'Export'} aria-label="导出"><h3>导出</h3><p>支持 Markdown、BibTeX 和质量报告。每次创建独立交付快照，保持主稿不变。</p>
      <button disabled={busy || project.document.externalChange} onClick={() => run(async () => setPlan(await api('export.preflight', { context: context() })))}>预检当前版本导出</button>
      {plan && <section role="dialog" aria-modal="false" aria-label="导出确认"><h4>确认当前稿件快照</h4><p>{plan.revisionId} · {plan.reviewState} · 尚未关闭问题 {plan.unresolvedIssueIds.length} 项</p>
        <p>正文、references.bib 与 quality-report.md 将来自此稿件版本。未知或真实性阻塞项保留在报告中。</p>
        {plan.limitations.map((limit: string) => <p key={limit}>{limit}</p>)}
        <button disabled={busy} onClick={() => run(async () => {
          const result = await api('export.create', { context: context(), planId: plan.planId, planHash: plan.planHash, deliveryType: 'working-draft' })
          setPlan(undefined); setMessage(`工作草稿已导出：${result.manifest.id}`); await refresh()
        })}>确认导出工作草稿</button>
        {plan.reviewedAllowed && <button disabled={busy} onClick={() => run(async () => {
          const result = await api('export.create', { context: context(), planId: plan.planId, planHash: plan.planHash, deliveryType: 'reviewed-draft' })
          setPlan(undefined); setMessage(`已审查草稿已导出：${result.manifest.id}`); await refresh()
        })}>确认导出已审查草稿</button>}
        <button disabled={busy} onClick={() => setPlan(undefined)}>取消导出计划</button></section>}
      {(Object.values(project.ledger.deliveries) as any[]).map(delivery => <div key={delivery.id}><p>{delivery.id} · {delivery.reviewState} · {delivery.revisionId}</p>
        {delivery.files.map((file: any) => <button key={file.relativePath} disabled={busy} onClick={() => run(async () => {
          const result = await api('export.read', { context: context(), deliveryId: delivery.id })
          const content = result.files.find((item: any) => item.relativePath === file.relativePath)
          const url = URL.createObjectURL(new Blob([content.text], { type: 'text/plain;charset=utf-8' }))
          const link = document.createElement('a'); link.href = url; link.download = file.relativePath; document.body.append(link); link.click(); link.remove()
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        })}>下载 {file.relativePath} · {file.sizeBytes} bytes</button>)}</div>)}
      <p role="status">{message}</p>
    </section>
  </>
}
