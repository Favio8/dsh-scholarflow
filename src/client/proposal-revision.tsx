import React, { useState } from 'react'

type Props = { image: any; context: () => any; api: (method: string, request: any) => Promise<any>; run: (fn: () => Promise<unknown>) => void;
  busy: boolean; disabled?: boolean; onRevised: (image: any) => Promise<void> }
export function ProposalRevision({ image, context, api, run, busy, disabled, onRevised }: Props) {
  const original = image.proposal
  const [editing, setEditing] = useState(false), [text, setText] = useState(original.section?.body ?? original.edits[0]?.replacementText ?? '')
  const [mapping, setMapping] = useState(JSON.stringify(original.section?.paragraphClaims ?? [], null, 2))
  const [reason, setReason] = useState('用户编辑候选并明确请求重新校验。'), [plan, setPlan] = useState<any>()
  if (original.edits.length !== 1) return <p>多条修改候选暂不支持整体编辑，请逐条审阅。</p>
  return <section aria-label="编辑候选并重新校验">
    {original.derivedFrom && <p>编辑来源：{original.derivedFrom.proposalId} · {original.derivedFrom.proposalHash}</p>}
    <button disabled={busy || disabled || editing} onClick={() => setEditing(true)}>编辑候选并重新校验</button>
    {editing && <>
      <label>编辑候选正文<textarea aria-label="编辑候选正文" rows={8} maxLength={2 * 1024 * 1024} value={text} disabled={busy || !!plan} onChange={e => setText(e.target.value)} /></label>
      {original.section && <label>候选段落论点映射 JSON<textarea aria-label="候选段落论点映射 JSON" rows={6} value={mapping} disabled={busy || !!plan} onChange={e => setMapping(e.target.value)} /></label>}
      <label>候选编辑原因<input aria-label="候选编辑原因" value={reason} maxLength={4000} disabled={busy || !!plan} onChange={e => setReason(e.target.value)} /></label>
      <button disabled={busy || disabled || !!plan || !text.trim() || !reason.trim()} onClick={() => run(async () => {
        const paragraphClaims = original.section ? JSON.parse(mapping) : undefined
        setPlan(await api('edits.prepareRevision', { context: context(), proposalId: original.id, proposalHash: image.proposalHash, replacementText: text, reason, ...(paragraphClaims && { paragraphClaims }) }))
      })}>预览编辑校验</button>
      <button disabled={busy || !!plan} onClick={() => setEditing(false)}>取消候选编辑</button>
    </>}
    {plan && <section role="dialog" aria-label="编辑候选校验确认"><h4>校验后的新候选</h4>
      <p>原建议 {original.id} 将保留。主稿只在随后明确接受新候选时改变。</p>
      {plan.proposal.edits.map((edit: any, index: number) => <div key={index}><b>− 当前主稿原文</b><pre>{edit.expectedText}</pre><b>+ 编辑后的候选</b><pre>{edit.replacementText}</pre></div>)}
      {plan.proposal.checks.map((check: any) => <p key={check.id}>{check.status} · {check.detail}</p>)}
      {plan.proposal.protectedFactChanges.map((change: string) => <p key={change}>{change}</p>)}
      <p>引用新增 {plan.proposal.citationChanges.added.join('、') || '无'}；删除 {plan.proposal.citationChanges.removed.join('、') || '无'}。</p>
      {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy || disabled} onClick={() => run(async () => {
        const result = await api('edits.publishRevision', { context: context(), planId: plan.planId, planHash: plan.planHash })
        setPlan(undefined); setEditing(false); await onRevised(result)
      })}>确认保存新候选</button>
      <button disabled={busy} onClick={() => run(async () => { await api('edits.dismissRevision', { planId: plan.planId }); setPlan(undefined) })}>取消编辑校验预览</button>
    </section>}
  </section>
}
