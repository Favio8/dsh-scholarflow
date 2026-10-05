import React, { useEffect, useRef, useState } from 'react'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean; onReview: (value: any) => void }
export function ModelReview({ project, context, api, refresh, run, busy, onReview }: Props) {
  const [plan, setPlan] = useState<any>(), [actionPlan, setActionPlan] = useState<any>(), [history, setHistory] = useState<any>(), [historyVersion, setHistoryVersion] = useState(0)
  const [active, setActive] = useState<any>(), [progress, setProgress] = useState<any>(), [message, setMessage] = useState('')
  const binding = `${project.binding.projectId}:${project.binding.sessionId}`, liveBinding = useRef(binding); liveBinding.current = binding
  useEffect(() => { let live = true
    api('runs.list', { context: context() }).then(value => live && setHistory(value)).catch(error => live && setMessage(error.message))
    return () => { live = false }
  }, [project.ledger.revision, historyVersion, binding])
  useEffect(() => {
    if (!active) return
    let live = true, pending = false
    const timer = setInterval(async () => {
      if (pending) return; pending = true
      try { const value = await api('runs.inspect', { context: active.context, runId: active.runId }); if (live) setProgress(value) }
      catch { /* A transaction may still be publishing; keep the running request visible. */ }
      finally { pending = false }
    }, 1000)
    return () => { live = false; clearInterval(timer) }
  }, [active?.runId])
  const execute = (preview: any, action = false) => run(async () => {
    const captured = context(), scope = binding, running = { runId: preview.runId, context: captured }
    setActive(running); setProgress(undefined); setMessage('正在登记审查运行与输入检查点。'); setPlan(undefined); setActionPlan(undefined)
    try { const result = await api(action ? 'review.confirmAction' : 'review.startModel', { context: captured, planId: preview.planId, planHash: preview.planHash })
      if (liveBinding.current === scope) { onReview(result); setMessage(result.paused ? '审查已暂停，冻结输入与已计费调用保留；继续前须预览恢复。' : `模型审查 ${result.run.runId} · ${result.run.status} · 调用 ${result.run.usedModelCalls} 次`); await refresh() }
    } catch (error) {
      if (liveBinding.current === scope) setMessage('审查未完成；历史保留实际终态与计费次数。可刷新后预览关联重试，正文未由审查改变。')
      throw error
    } finally { if (liveBinding.current === scope) { setActive(undefined); setHistoryVersion(value => value + 1) } }
  })
  const rows = history?.runs.filter((row: any) => row.stage === 'review') ?? []
  const preview = actionPlan ?? plan
  return <section aria-label="模型辅助审查"><h4>模型辅助审查</h4>
    <p>按当前全部已保存正文执行论证和文风审查；未保存编辑不进入本轮。问题须有真实源码位置，模型结果不能替代人工核对或实验记录。</p>
    <button disabled={busy || project.document.externalChange || !!preview} onClick={() => run(async () => setPlan(await api('review.prepareModel', { context: context() })))}>预览模型辅助审查</button>
    {preview && <section role="dialog" aria-label="模型审查确认"><h4>{actionPlan ? actionPlan.action === 'resume' ? '确认恢复原审查' : '确认关联新审查' : '确认模型审查范围'}</h4>
      <p>{preview.model.providerId} / {preview.model.modelId}{preview.model.reasoningEffort ? ` · ${preview.model.reasoningEffort}` : ''} · 段落 {preview.blocks} · 输入约 {preview.inputBytes} bytes</p>
      <p>正文版本：{preview.documentHash} · 证据 {preview.evidenceIds.length} · 实际引用来源 {preview.sourceIds.length} · 调用上限 {preview.budget.maxModelCalls} · {preview.budget.maxDurationMinutes} 分钟</p>
      {preview.workflowId && <p>计入引导任务 {preview.workflowId} 的原累计预算与模型审查轮次；未知响应不推定未计费。</p>}
      <p>每次调用输出上限：{preview.model.maxOutputTokens ?? 4096} tokens，包含提供方计费的推理输出；达到上限会停止并保留失败记录。</p>
      {preview.skillDigests.map((skill: any) => <p key={skill.qualifiedId}>固定审查 Skill：{skill.qualifiedId} · {skill.digest}</p>)}
      {actionPlan && <p>原运行 {actionPlan.originalRunId} · 已计费调用 {actionPlan.recoveredCalls}；{actionPlan.existingReportId ? '已保存报告只恢复终态，不再次调用模型或发布报告。' : '恢复保留原预算；关联新运行使用预览中的新预算。'}</p>}
      {preview.retryNotBefore && <p>提供方等待窗口：{new Date(preview.retryNotBefore).toLocaleString()}</p>}
      {preview.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      {preview.documentHash !== project.document.contentHash && !preview.existingReportId && <p role="alert">正文已改变，请取消旧预览并重新规划。</p>}
      <button disabled={busy || preview.documentHash !== project.document.contentHash && !preview.existingReportId} onClick={() => execute(preview, !!actionPlan)}>确认执行模型审查</button>
      <button disabled={busy} onClick={() => run(async () => { await api(actionPlan ? 'review.dismissAction' : 'review.dismissModel', { planId: preview.planId }); setActionPlan(undefined); setPlan(undefined) })}>取消模型审查预览</button></section>}
    {active && <section aria-label="当前模型审查"><p role="status">审查 {active.runId} · {progress?.run.status ?? '登记中'} · 已调用 {progress?.run.usedModelCalls ?? 0} 次</p>
      {!!progress?.checkpoint?.transientRetries && <p>临时错误重试 {progress.checkpoint.transientRetries} / 2</p>}
      <button onClick={() => api('runs.pause', { context: active.context, runId: active.runId }).then(() => setMessage('已请求暂停，等待当前调用结束后保留检查点。')).catch(error => setMessage(error.message))}>暂停当前模型审查</button>
      <button onClick={() => api('runs.cancel', { context: active.context, runId: active.runId }).then(() => setMessage('已请求取消，等待权威终态保存。')).catch(error => setMessage(error.message))}>取消当前模型审查</button></section>}
    <button disabled={busy} onClick={() => setHistoryVersion(value => value + 1)}>刷新模型审查历史</button>
    {history?.diagnostics.map((warning: string, index: number) => <p role="alert" key={index}>{warning}</p>)}
    {rows.map((row: any) => <section aria-label={`模型审查运行 ${row.runId}`} key={row.runId}><p>{row.runId} · {row.status} · 模型调用 {row.usedModelCalls}{row.parentRunId ? ` · 重试来源 ${row.parentRunId}` : ''}{row.errorCode ? ` · ${row.errorCode}` : ''}</p>
      {row.reviewId && <p>审查产物：{row.reviewId}</p>}
      {row.inheritedArchive && <p>副本来源历史，只读；旧身份 {row.projectId}，不接管或重放请求。</p>}
      {!row.inheritedArchive && ['paused', 'interrupted', 'running', 'queued', 'waiting-input'].includes(row.status) && <button disabled={busy || !!preview} onClick={() => run(async () => setActionPlan(await api('review.prepareAction', { context: context(), runId: row.runId, action: 'resume' })))}>预览恢复模型审查 {row.runId}</button>}
      {!row.inheritedArchive && ['failed', 'cancelled'].includes(row.status) && <button disabled={busy || !!preview} onClick={() => run(async () => setActionPlan(await api('review.prepareAction', { context: context(), runId: row.runId, action: 'retry' })))}>预览关联模型审查重试 {row.runId}</button>}
    </section>)}
    {!rows.length && <p>本项目尚无模型审查运行；未知检查不能冒充已执行。</p>}
    <p role="status">{message}</p>
  </section>
}
