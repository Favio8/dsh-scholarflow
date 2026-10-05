import React, { useEffect, useState } from 'react'

type Props = { workflow: any; context: () => any; api: (method: string, request: any) => Promise<any>;
  refresh: () => Promise<void>; inspectWorkflow: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
const ended = (state: any) => state && ['failed', 'cancelled', 'succeeded', 'completed-with-issues'].includes(state.status)
export function AutomaticWorkflow({ workflow, context, api, refresh, inspectWorkflow, run, busy }: Props) {
  const workflowId = workflow.input.workflowId
  const [value, setValue] = useState<any>(), [preview, setPreview] = useState<any>(), [active, setActive] = useState<any>(), [error, setError] = useState('')
  const [ruleReview, setRuleReview] = useState(true), [delivery, setDelivery] = useState(false), [insufficient, setInsufficient] = useState(false), [stopRevision, setStopRevision] = useState(false)
  const [reason, setReason] = useState(''), [steps, setSteps] = useState(32), [noProgress, setNoProgress] = useState(2)
  const inspect = async () => { const result = await api('automatic.inspect', { context: context(), workflowId }); setValue(result); setError('') }
  useEffect(() => { let live = true
    api('automatic.inspect', { context: context(), workflowId }).then(result => { if (live) { setValue(result); setError('') } }).catch(e => live && setError(e.message))
    return () => { live = false }
  }, [workflowId, workflow.checkpoint.revision])
  const automatic = value?.automatic, state = automatic?.state, limits = workflow.checkpoint.automaticBudget ?? automatic?.limits
  const taskEnded = ['cancelled', 'succeeded', 'completed-with-issues'].includes(workflow.checkpoint.status)
  const action = (action: string) => run(async () => setPreview(await api('automatic.prepareAction', { context: context(), workflowId,
    automaticId: state.automaticId, action, reason })))
  return <section aria-label="有限自动推进"><h4>有限自动推进</h4>
    <p>当前支持按已保存事实自动推进、规则审查和工作草稿交付；模型生成与在线检索仍由各阶段的明确计划执行。未确认大纲、缺章节、证据不足或输入变化会停止。</p>
    <button disabled={busy} onClick={() => run(inspect)}>刷新自动推进检查点</button>
    {error && <p role="alert">{error}</p>}
    {state && <><p role="status" aria-label="自动推进状态">{state.automaticId} · {state.status} · {state.code ?? ''} · {state.reason}</p>
      {state.steps.some((row: any) => row.state === 'pending') && <p role="alert">一个已登记步骤尚无完成确认；不会重放。请核对实际产物，保留原额度并明确规划新尝试。</p>}
      <details><summary>查看已登记步骤</summary><ol>{state.steps.map((row: any) => <li key={row.stepId}>步骤 {row.number} · {row.stage ?? '结束'} · {row.operation} · {row.state}</li>)}</ol></details>
    </>}
    {limits && <p role="status" aria-label="自动推进原任务额度">步骤 {limits.usedSteps}/{limits.maxSteps} · 无进展 {limits.noProgress}/{limits.maxNoProgress}；新尝试不重置上限。</p>}
    {!taskEnded && (!state || ended(state)) && <>
      <label><input type="checkbox" aria-label="授权自动规则审查" checked={ruleReview} disabled={busy} onChange={e => setRuleReview(e.target.checked)} />自动运行缺少的同版规则审查</label>
      <label><input type="checkbox" aria-label="授权自动工作草稿交付" checked={delivery} disabled={busy} onChange={e => setDelivery(e.target.checked)} />自动创建同版工作草稿交付（不标记已审查）</label>
      <label><input type="checkbox" aria-label="明确保留检索不足继续" checked={insufficient} disabled={busy} onChange={e => setInsufficient(e.target.checked)} />未达证据数量时，按以下理由保留不足继续；不允许编造正文</label>
      <label><input type="checkbox" aria-label="明确保留问题结束修订" checked={stopRevision} disabled={busy} onChange={e => setStopRevision(e.target.checked)} />没有可执行修复时，按以下理由保留问题结束修订</label>
      <label>整份目标步骤上限<input aria-label="自动推进步骤上限" type="number" min={7} max={64} value={limits?.maxSteps ?? steps} disabled={busy || !!limits} onChange={e => setSteps(Number(e.target.value))} /></label>
      <label>连续无进展上限<input aria-label="自动推进无进展上限" type="number" min={1} max={3} value={limits?.maxNoProgress ?? noProgress} disabled={busy || !!limits} onChange={e => setNoProgress(Number(e.target.value))} /></label>
      <button disabled={busy || workflow.configChanged || workflow.checkpoint.status !== 'waiting-input' || (insufficient || stopRevision) && reason.trim().length < 10}
        onClick={() => run(async () => setPreview(await api('automatic.prepare', { context: context(), workflowId, policy: { ruleReview, workingDraftDelivery: delivery,
          maxSteps: limits?.maxSteps ?? steps, maxNoProgress: limits?.maxNoProgress ?? noProgress,
          ...(insufficient && { insufficientResearchReason: reason }), ...(stopRevision && { stopRevisionReason: reason }) } })))}>预览自动推进已保存阶段</button>
    </>}
    {!taskEnded && state && !ended(state) && <>
      <button disabled={busy || reason.trim().length < 10 || state.steps.some((row: any) => row.state === 'pending')} onClick={() => action('resume')}>预览恢复自动推进</button>
      <button disabled={busy || reason.trim().length < 10} onClick={() => action('close')}>预览结束本次自动推进</button>
    </>}
    {!taskEnded && <label>自动推进保留缺口／恢复／结束理由<textarea aria-label="自动推进决定理由" maxLength={4000} value={reason} disabled={busy || !!preview} onChange={e => setReason(e.target.value)} /></label>}
    {active && <div aria-label="正在自动推进"><p role="status">已开始有限调度，按原预算保存结果。</p>
      {(['pause', 'cancel'] as const).map(action => <button key={action} onClick={() => api('automatic.control', { context: active.context, workflowId, automaticId: active.automaticId, action }).catch(e => setError(e.message))}>{action === 'pause' ? '暂停自动推进' : '取消自动推进'}</button>)}</div>}
    {preview && <section role="dialog" aria-label="自动推进确认"><h4>{preview.action ? '确认恢复／结束' : '确认有限推进范围'}</h4>
      {preview.input && <><p>只推进当前已保存事实；规则审查 {preview.input.policy.ruleReview ? '允许' : '不允许'} · 工作草稿交付 {preview.input.policy.workingDraftDelivery ? '允许' : '不允许'}。</p>
        <p>原步骤上限 {preview.input.policy.maxSteps} · 无进展上限 {preview.input.policy.maxNoProgress}。</p>
        {preview.input.policy.insufficientResearchReason && <p>保留检索不足：{preview.input.policy.insufficientResearchReason}</p>}
        {preview.input.policy.stopRevisionReason && <p>保留问题结束修订：{preview.input.policy.stopRevisionReason}</p>}
        <p>当前输入指纹 {preview.input.dependencyHash}。不调用模型或在线检索，不接受正文修改。</p></>}
      {preview.action && <p>{preview.action} · {preview.reason}</p>}
      {preview.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => {
        const confirmed = preview, captured = context(); setPreview(undefined)
        setActive({ context: captured, automaticId: confirmed.input?.automaticId ?? confirmed.automaticId })
        try { await api('automatic.confirm', { context: captured, planId: confirmed.planId, planHash: confirmed.planHash }) }
        finally { setActive(undefined); await refresh(); await inspect(); await inspectWorkflow() }
      })}>确认执行有限自动推进</button>
      <button disabled={busy} onClick={() => run(async () => { await api('automatic.dismiss', { planId: preview.planId }); setPreview(undefined) })}>取消自动推进预览</button>
    </section>}
  </section>
}
