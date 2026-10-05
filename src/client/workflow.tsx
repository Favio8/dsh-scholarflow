import React, { useEffect, useState } from 'react'
import { AutomaticWorkflow } from './workflow-automatic.tsx'
const labels: Record<string, string> = { requirements: '要求确认', research: '检索与证据', outline: '大纲', drafting: '初稿', review: '审查', revision: '修订建议', delivery: '交付' }
const states: Record<string, string> = { pending: '待开始', ready: '可确认', running: '执行中', blocked: '待处理', completed: '已确认', stale: '输入已变，需重新检查', skipped: '已说明理由跳过', failed: '失败' }
const pages: Record<string, string> = { requirements: 'Overview', research: 'Research', outline: 'Outline', drafting: 'Draft', review: 'Review', revision: 'Review', delivery: 'Export' }
type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; run: (fn: () => Promise<unknown>) => void;
  busy: boolean; refresh: () => Promise<void>; navigate?: (page: string) => void }
export function GuidedWorkflow({ project, context, api, run, busy, refresh, navigate }: Props) {
  const [value, setValue] = useState<any>(), [preview, setPreview] = useState<any>(), [error, setError] = useState('')
  const [question, setQuestion] = useState(''), [noRequirements, setNoRequirements] = useState(''), [reason, setReason] = useState('')
  const [sources, setSources] = useState(1), [evidence, setEvidence] = useState(1)
  const inspect = async () => { const result = await api('workflow.inspect', { context: context() }); setValue(result); setError('') }
  useEffect(() => {
    let live = true
    api('workflow.inspect', { context: context() }).then(result => { if (live) { setValue(result); setError('') } }).catch(e => live && setError(e.message))
    return () => { live = false }
  }, [project.binding.projectId, project.ledger.revision, project.document.contentHash, project.configHash])
  const workflow = value?.workflow, ended = workflow && ['cancelled', 'succeeded', 'completed-with-issues'].includes(workflow.checkpoint.status)
  const action = (action: string, stage?: string, callId?: string) => run(async () => setPreview(await api('workflow.prepareAction', {
    context: context(), workflowId: workflow.input.workflowId, action, ...(stage && { stage }), ...(callId && { callId }), reason,
  })))
  return <section aria-label="七阶段引导任务"><h3>七阶段引导任务</h3>
    <p>按已保存事实确认进度。前往各阶段处理资料、候选与正文，返回后核对检查点。候选需要另行预览并接受；阶段确认保留缺口和原问题。</p>
    <button disabled={busy} onClick={() => run(inspect)}>刷新引导检查点</button>
    {error && <p role="alert">{error}</p>}
    {(!workflow || ended) && <>
      <label>本次研究问题<textarea aria-label="引导研究问题" maxLength={4000} value={question} onChange={e => setQuestion(e.target.value)} /></label>
      <label>最低当前文本来源数<input aria-label="引导最低来源数" type="number" min={1} max={80} value={sources} onChange={e => setSources(Number(e.target.value))} /></label>
      <label>最低定位证据数<input aria-label="引导最低证据数" type="number" min={1} max={1000} value={evidence} onChange={e => setEvidence(Number(e.target.value))} /></label>
      <label>没有正式要求时的说明（有要求则留空）<textarea aria-label="引导无正式要求说明" maxLength={4000} value={noRequirements} onChange={e => setNoRequirements(e.target.value)} /></label>
      <button disabled={busy || question.trim().length < 3} onClick={() => run(async () => setPreview(await api('workflow.prepare', { context: context(), goal: {
        researchQuestion: question, minimumSources: sources, minimumLocatedEvidence: evidence, ...(noRequirements.trim() && { noFormalRequirementsReason: noRequirements }),
      } })))}>预览七阶段目标</button>
    </>}
    {workflow && <>
      <p role="status">{workflow.input.goal.researchQuestion} · {workflow.checkpoint.status} · 检查点 {workflow.checkpoint.revision}</p>
      <AutomaticWorkflow key={`${workflow.input.workflowId}:${project.binding.sessionId}`} project={project} workflow={workflow} context={context} api={api} refresh={refresh} inspectWorkflow={inspect} run={run} busy={busy} />
      {value.budget?.used && <p role="status" aria-label="引导累计预算">模型调用 {value.budget.used.modelCalls}/{value.budget.limits.maxModelCalls} · 查询 {value.budget.used.searchQueries}/{value.budget.limits.maxSearchQueries} · 候选及未知响应预留 {value.budget.used.candidates}/{value.budget.limits.maxCandidateSources} · 模型审查轮次 {value.budget.used.reviewRounds}/{value.budget.maxReviewRounds} · 执行 {Math.ceil(value.budget.used.durationMs / 1000)} 秒/{value.budget.limits.maxDurationMinutes} 分钟</p>}
      {value.budget?.pendingCalls.map((call: any) => <p key={call.callId}>未结算请求：{call.runId} · {labels[call.stage]} · {call.callId}
        <button disabled={busy || reason.trim().length < 10} onClick={() => action('close-unknown-call', undefined, call.callId)}>预览结束无应答请求 {call.callId}</button></p>)}
      {workflow.configChanged && <p role="alert">项目配置已改变，当前任务不能沿用原计划恢复或完成。原记录保留；取消后可明确建立新目标。</p>}
      <ol>{workflow.gates.map((gate: any) => <li key={gate.stage}>
        <b>{labels[gate.stage]} · {states[gate.state]}</b> · {gate.stamp?.outcome ?? gate.outcome}
        {gate.reasons.map((text: string, i: number) => <p key={i}>{text}</p>)}
        {gate.stamp && <p>上次决定：{gate.stamp.decidedAt} · {gate.stamp.reason || '依据已保存事实确认'} · {gate.stamp.artifacts.join('、')}</p>}
        {navigate && <button disabled={busy} onClick={() => navigate(pages[gate.stage])}>前往{labels[gate.stage]}</button>}
        {!ended && <>
          <button disabled={busy || workflow.checkpoint.status !== 'waiting-input' || workflow.configChanged || gate.current || !gate.priorCurrent || !gate.canComplete || (gate.outcome !== 'ready' && reason.trim().length < 10)} onClick={() => action('complete-stage', gate.stage)}>预览确认{labels[gate.stage]}</button>
          {gate.canSkip && <button disabled={busy || gate.current || !gate.priorCurrent || reason.trim().length < 10} onClick={() => action('skip-stage', gate.stage)}>预览跳过修订</button>}
          {gate.stage === 'revision' && <button disabled={busy || workflow.checkpoint.status !== 'waiting-input' || gate.current || !gate.priorCurrent || reason.trim().length < 10} onClick={() => action('stop-revision', gate.stage)}>预览保留问题结束修订</button>}
        </>}
      </li>)}</ol>
      {!ended && <>
        <label>缺口、跳过或结束任务的理由<textarea aria-label="引导阶段决定理由" value={reason} maxLength={4000} onChange={e => setReason(e.target.value)} /></label>
        <button disabled={busy || workflow.checkpoint.status !== 'waiting-input'} onClick={() => action('pause')}>预览暂停引导任务</button>
        <button disabled={busy || workflow.checkpoint.status !== 'paused' || workflow.configChanged} onClick={() => action('resume')}>预览恢复引导任务</button>
        <button disabled={busy || reason.trim().length < 10} onClick={() => action('cancel')}>预览取消引导任务并保留产物</button>
        <button disabled={busy || workflow.configChanged || !workflow.gates.every((gate: any) => gate.current)} onClick={() => action('finish')}>预览结束七阶段交付</button>
      </>}
    </>}
    {preview && <section role="dialog" aria-label="引导任务确认"><h4>{preview.goal ? '确认引导目标' : '确认阶段决定'}</h4>
      {preview.goal && <p>{preview.goal.researchQuestion} · 最低当前文本来源 {preview.goal.minimumSources} · 定位证据 {preview.goal.minimumLocatedEvidence} · {preview.goal.noFormalRequirementsReason}</p>}
      {preview.budget && <p>整份引导目标累计预算：模型调用 {preview.budget.maxModelCalls} · 查询 {preview.budget.maxSearchQueries} · 候选 {preview.budget.maxCandidateSources} · 执行 {preview.budget.maxDurationMinutes} 分钟 · 模型审查 {preview.maxReviewRounds} 轮。格式修复、临时重试及无应答请求计入原额度；阶段预览和读取结果不计费。</p>}
      {preview.action && <p>{preview.action} · {labels[preview.stage] ?? '当前任务'} · {preview.reason}</p>}
      {preview.gate && <p>{preview.gate.outcome} · {preview.gate.reasons.join(' ')}</p>}
      <p>确认保存检查点与决定记录；不接受候选、不修改正文、不关闭审查问题。带缺口的交付保持实际质量标识。</p>
      <button disabled={busy} onClick={() => run(async () => { await api('workflow.confirm', { context: context(), planId: preview.planId, planHash: preview.planHash }); setPreview(undefined); await inspect() })}>确认保存引导检查点</button>
      <button disabled={busy} onClick={() => run(async () => { await api('workflow.dismiss', { planId: preview.planId }); setPreview(undefined) })}>取消引导预览</button>
    </section>}
  </section>
}
