import React, { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import { FORMAT_LABELS } from './paper-workspace.tsx'
import type { ExportFormat } from '../shared/presentation.ts'
import { ModelReview } from './model-review.tsx'
import { ReviewFixes } from './review-fixes.tsx'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
export function ReviewExport({ project, context, api, refresh, run, busy, mode, onLocate, format = 'markdown', exportTrigger = 0 }: Props & { mode: string; format?: ExportFormat; exportTrigger?: number; onLocate: (location: any) => void }) {
  const [review, setReview] = useState<any>(), [message, setMessage] = useState('')
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
      download(typeof data === 'string' ? data : new Uint8Array(data).buffer, project.config.project.title.replace(/[<>:"/\\|?*]/g, '_') + '.' + extension, main.mediaType)
      if (format === 'latex') { const bib = delivery.files.find((file: any) => file.relativePath === 'references.bib'); if (bib) download(bib.text, 'references.bib', 'text/plain;charset=utf-8') }
      setMessage('已导出 ' + FORMAT_LABELS[format] + (plan.unresolvedIssueIds.length ? ' · 有待检查项，可在正文审查中查看。' : ''))
      await refresh()
    })
  }, [exportTrigger])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [manualCheck, setManualCheck] = useState(''), [manualStatus, setManualStatus] = useState('unknown'), [manualReason, setManualReason] = useState('')
  const [manualEvidence, setManualEvidence] = useState<string[]>([]), [manualClaims, setManualClaims] = useState<string[]>([]), [manualPlan, setManualPlan] = useState<any>()
  useEffect(() => { let live = true
    api('review.inspect', { context: context() }).then(value => live && setReview(value)).catch(error => live && setMessage(error.message))
    return () => { live = false }
  }, [project.ledger.revision, project.document.contentHash, project.document.externalChange])
  const issues = Object.values(project.ledger.reviewIssues) as any[]
  return <>
    {message && mode !== 'Export' && <div className="sf-editor-notice" role="status">{message}</div>}
    <section id="sf-panel-Review" role="tabpanel"  hidden={mode !== 'Review'} aria-label="审查"><h3>审查</h3>
      <p>规则检查、模型辅助与人工判断分别显示。未知项不能当作通过；问题经对应复查后才关闭。</p>
      <button disabled={busy || project.document.externalChange} onClick={() => run(async () => {
        const result = await api('review.run', { context: context() }); setReview(result); await refresh()
      })}>运行确定性审查</button>
      <ModelReview project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} onReview={setReview} />
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
        {issue.location && <blockquote>位置：{issue.location.sourceRange.startUtf16}–{issue.location.sourceRange.endUtf16}<br />{issue.location.quote}</blockquote>}
        {issue.location && <button disabled={busy || issue.stale || issue.documentHash !== project.document.contentHash} onClick={() => run(async () => onLocate(await api('review.locateIssue', { context: context(), issueId: issue.id })))}>定位正文问题 {issue.id}</button>}
        {issue.suggestedFix && <p>修订建议：{issue.suggestedFix}</p>}
        {issue.resolutionReason && <p>处理理由：{issue.resolutionReason}</p>}
        {issue.state !== 'resolved' && <><label>处理理由<input aria-label={`处理理由 ${issue.id}`} value={reasons[issue.id] ?? ''} onChange={e => setReasons({ ...reasons, [issue.id]: e.target.value })} maxLength={2000} /></label>
          {(['accepted-risk', 'dismissed'] as const).map(state => <button key={state} disabled={busy || !(reasons[issue.id] ?? '').trim()} onClick={() => run(async () => {
            await api('review.decideIssue', { context: context(), issueId: issue.id, state, reason: reasons[issue.id] }); await refresh()
          })}>{state === 'accepted-risk' ? '记录接受风险' : '记录不采纳理由'}</button>)}</>}
      </section>)}
      <ReviewFixes project={project} context={context} api={api} refresh={refresh} run={run} busy={busy} />
    </section>
    <section id="sf-panel-Export" role="tabpanel" hidden={mode !== 'Export'} aria-label="交付历史"><h3>交付历史</h3><p>正文、引用库和质量报告保存在同一稿件快照中。</p>
      {(Object.values(project.ledger.deliveries) as any[]).map(delivery => <div key={delivery.id}><p>{delivery.id} · {delivery.reviewState} · {delivery.revisionId}</p>
        <button disabled={busy} onClick={() => run(() => downloadBundle(delivery.id))}>下载完整交付包</button>
        {delivery.files.map((file: any) => <button key={file.relativePath} disabled={busy} onClick={() => run(async () => {
          const result = await api('export.read', { context: context(), deliveryId: delivery.id })
          const content = result.files.find((item: any) => item.relativePath === file.relativePath)
          download(bytes(content) as BlobPart, file.relativePath, content.mediaType ?? 'text/plain;charset=utf-8')
        })}>下载 {file.relativePath} · {file.sizeBytes} bytes</button>)}</div>)}
      <p role="status">{message}</p>
    </section>
  </>
}
