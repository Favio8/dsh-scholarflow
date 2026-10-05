import React, { useEffect, useState } from 'react'
type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; run: (fn: () => Promise<unknown>) => void;
  busy: boolean; dirty: boolean; onGenerationPlan: (plan: any) => void; onProposal: (proposal: any) => void }
const stateLabels: Record<string, string> = { pending: '待生成', preserved: '已有正文，保留', dispatched: '等待章节运行或接受候选', accepted: '已接受并保存' }
export function DraftSequence({ project, context, api, run, busy, dirty, onGenerationPlan, onProposal }: Props) {
  const [sequence, setSequence] = useState<any>(), [preview, setPreview] = useState<any>(), [error, setError] = useState('')
  const [instruction, setInstruction] = useState('逐节起草，只使用给定证据；保留限定与引用，没有真实结果时明确保留待补。')
  const [summaryIds, setSummaryIds] = useState<string[]>([]), [reason, setReason] = useState('')
  const inspect = async () => { const result = await api('draftSequence.inspect', { context: context() }); setSequence(result.sequence); setError('') }
  useEffect(() => {
    let live = true
    api('draftSequence.inspect', { context: context() }).then(result => { if (live) { setSequence(result.sequence); setError('') } }).catch(e => live && setError(e.message))
    return () => { live = false }
  }, [project.binding.projectId, project.ledger.revision, project.document.contentHash])
  const ended = sequence && ['cancelled', 'completed-with-issues'].includes(sequence.checkpoint.status)
  const action = (action: string) => run(async () => {
    const plan = await api('draftSequence.prepareAction', { context: context(), sequenceId: sequence.input.sequenceId, action, reason })
    if (plan.runId) onGenerationPlan(plan); else setPreview(plan)
  })
  return <section aria-label="按节初稿"><h4>按节初稿</h4>
    <p>先在概览确认引导目标与总预算。每节候选审阅接受后，再起草后续章节；已有正文保留。章节进度不代表研究完成或审查通过。</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => run(inspect)}>刷新按节初稿进度</button>
    {(!sequence || ended) && <>
      <label>初稿写作指令<textarea aria-label="初稿写作指令" maxLength={12000} value={instruction} onChange={e => setInstruction(e.target.value)} /></label>
      <fieldset><legend>选择在正文之后生成的摘要／结论</legend><p>明确勾选实际摘要和结论；顺序不会按标题猜测。未勾选的章节按大纲顺序执行。</p>
        {project.ledger.outline.sections.map((section: any) => <label key={section.id}><input type="checkbox" aria-label={`正文之后生成 ${section.title}`} checked={summaryIds.includes(section.id)}
          onChange={e => setSummaryIds(ids => e.target.checked ? [...ids, section.id] : ids.filter(id => id !== section.id))} />{section.title}</label>)}</fieldset>
      <button disabled={busy || dirty || project.ledger.outline.confirmation !== 'confirmed' || !instruction.trim()} onClick={() => run(async () =>
        setPreview(await api('draftSequence.prepare', { context: context(), instruction, summarySectionIds: summaryIds }))) }>预览按节初稿顺序</button>
    </>}
    {sequence && <>
      <p role="status" aria-label="按节初稿进度">{sequence.checkpoint.status} · 已保存章节 {sequence.checkpoint.steps.filter((step: any) => ['accepted', 'preserved'].includes(step.state)).length}/{sequence.checkpoint.steps.length}</p>
      <ol>{sequence.input.sections.map((section: any) => { const step = sequence.checkpoint.steps.find((row: any) => row.sectionId === section.sectionId)
        return <li key={section.sectionId}>{section.title} · {stateLabels[step.state]}{section.summary ? ' · 依据实际正文总结' : ''}
          {step.gaps.map((gap: string, index: number) => <p key={index}>缺口：{gap}</p>)}</li> })}</ol>
      {sequence.diagnostics.map((message: string, index: number) => <p role="alert" key={index}>{message}</p>)}
      {sequence.childRun && <p>当前章节运行 {sequence.childRun.runId} · {sequence.childRun.status}；未结束运行可从下方历史预览恢复。</p>}
      {sequence.pendingProposalIds.map((proposalId: string) => <button key={proposalId} disabled={busy} onClick={() => run(async () =>
        onProposal(await api('edits.read', { context: context(), proposalId }))) }>审阅本节建议 {proposalId}</button>)}
      {!ended && <>
        <button disabled={busy || dirty || sequence.checkpoint.status !== 'waiting-input'} onClick={() => action('next')}>预览下一节或结束初稿顺序</button>
        <button disabled={busy || sequence.checkpoint.status !== 'waiting-input'} onClick={() => action('pause')}>预览暂停按节初稿</button>
        <button disabled={busy || dirty || sequence.checkpoint.status !== 'paused'} onClick={() => action('resume')}>预览恢复按节初稿</button>
        <label>取消顺序的理由<textarea aria-label="取消初稿顺序理由" maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button disabled={busy || reason.trim().length < 10} onClick={() => action('cancel')}>预览取消初稿顺序并保留稿件</button>
      </>}
    </>}
    {preview && <section role="dialog" aria-label="按节初稿顺序确认"><h4>{preview.action === 'start' ? '确认初稿顺序' : '确认初稿顺序操作'}</h4>
      {preview.input && <><p>宿主模型 {preview.input.model.providerId} / {preview.input.model.modelId} · 累计目标 {preview.input.workflowId}</p>
        <ol>{preview.input.sections.map((section: any) => <li key={section.sectionId}>{section.title} · {section.preserve ? '已有正文原样保留' : '逐节生成并审阅'}{section.summary ? ' · 正文之后总结' : ''}</li>)}</ol></>}
      {preview.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy || dirty && !['pause', 'cancel'].includes(preview.action)} onClick={() => run(async () => {
        await api('draftSequence.confirm', { context: context(), planId: preview.planId, planHash: preview.planHash }); setPreview(undefined); await inspect()
      })}>确认初稿顺序操作</button>
      <button disabled={busy} onClick={() => run(async () => { await api('draftSequence.dismiss', { planId: preview.planId }); setPreview(undefined) })}>取消初稿顺序预览</button>
    </section>}
  </section>
}
