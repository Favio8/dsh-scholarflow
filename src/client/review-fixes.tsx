import React, { useEffect, useState } from 'react'
import { ProposalRevision } from './proposal-revision.tsx'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
export function ReviewFixes({ project, context, api, refresh, run, busy }: Props) {
  const [issueId, setIssueId] = useState(''), [instruction, setInstruction] = useState('修复所列问题，保留事实、限定范围、引用和人工内容；仅返回目标完整段落候选。')
  const [plan, setPlan] = useState<any>(), [proposal, setProposal] = useState<any>(), [active, setActive] = useState<any>(), [message, setMessage] = useState(''), [history, setHistory] = useState<any>()
  const eligible = (Object.values(project.ledger.reviewIssues) as any[]).filter(issue => issue.location && !issue.stale && issue.documentHash === project.document.contentHash && issue.state !== 'resolved')
  useEffect(() => { let live = true
    api('review.fixes', { context: context() }).then(value => live && setHistory(value)).catch(error => live && setMessage(error.message))
    return () => { live = false }
  }, [project.ledger.revision])
  return <section aria-label="问题修复候选"><h4>问题修复与复查</h4>
    <p>当前可定位的普通段落可生成修复候选。范围为完整问题段落，保留其引用；接受后复查规则，语义问题需明确再审查，接受建议不会自动关闭问题。</p>
    <label>选择修复问题<select aria-label="选择修复问题" value={issueId} disabled={busy || !!plan} onChange={e => setIssueId(e.target.value)}><option value="">请选择当前问题</option>
      {eligible.map(issue => <option key={issue.id} value={issue.id}>{issue.id} · {issue.severity} · {issue.title}</option>)}</select></label>
    <label>问题修复指令<textarea aria-label="问题修复指令" value={instruction} maxLength={12000} disabled={busy || !!plan} onChange={e => setInstruction(e.target.value)} /></label>
    <button disabled={busy || !!plan || !eligible.some(issue => issue.id === issueId) || !instruction.trim() || project.document.externalChange} onClick={() => run(async () => setPlan(await api('review.prepareFix', { context: context(), issueId, instruction })))}>预览所选问题修复</button>
    {plan && <section role="dialog" aria-label="问题修复确认"><h4>确认问题和完整段落范围</h4>
      <p>{plan.reviewIssueId} · {plan.model.providerId} / {plan.model.modelId} · 源码 [{plan.scope.startUtf16}, {plan.scope.endUtf16}) · 输入约 {plan.inputBytes} bytes</p>
      <p>本次输出上限 {plan.model.maxOutputTokens ?? 4096} token，包含提供方计入的推理输出；结果截断不自动重试。{plan.workflowId && `调用计入引导目标 ${plan.workflowId} 的原累计额度。`}</p>
      <pre>{plan.sourceText}</pre><p>调用上限 {plan.budget.maxModelCalls} · {plan.budget.maxDurationMinutes} 分钟</p>
      {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => { const confirmed = plan, captured = context(); setPlan(undefined); setActive({ context: captured, runId: confirmed.runId }); setMessage('正在生成待审阅修复，不修改主稿。')
        try { const result = await api('runs.start', { context: captured, planId: confirmed.planId, planHash: confirmed.planHash }); if (result.proposal) setProposal(result); setMessage(result.paused ? '修复生成已暂停；在正文运行历史预览恢复。' : '修复候选已保存，请逐项核对差异。'); await refresh() }
        catch (error) { setMessage('修复未完成；运行历史保留已计费调用，主稿只在明确接受后改变。'); throw error }
        finally { setActive(undefined) }
      })}>确认生成问题修复候选</button>
      <button disabled={busy} onClick={() => setPlan(undefined)}>取消问题修复预览</button></section>}
    {active && <section aria-label="当前问题修复"><p role="status">修复运行 {active.runId} 正在执行</p>
      <button onClick={() => api('runs.pause', { context: active.context, runId: active.runId }).then(() => setMessage('已请求暂停修复，等待当前调用保存检查点。')).catch(error => setMessage(error.message))}>暂停问题修复</button>
      <button onClick={() => api('runs.cancel', { context: active.context, runId: active.runId }).then(() => setMessage('已请求取消修复，等待终态保存。')).catch(error => setMessage(error.message))}>取消问题修复</button></section>}
    {history?.fixes.map((fix: any) => <p key={fix.proposalId}>{fix.issueId} · {fix.state} · {fix.proposalId}
      <button disabled={busy || !!proposal} onClick={() => run(async () => setProposal(await api('edits.read', { context: context(), proposalId: fix.proposalId })))}>查看问题修复建议 {fix.proposalId}</button></p>)}
    {history?.diagnostics.map((warning: string, index: number) => <p role="alert" key={index}>{warning}</p>)}
    {proposal && <section aria-label="问题修复差异"><h4>{proposal.proposal.reviewIssue?.issueId} · {proposal.proposal.id}</h4>
      {proposal.proposal.edits.map((edit: any, index: number) => <div key={index}><p>源码 [{edit.startUtf16}, {edit.endUtf16})</p><b>− 原文</b><pre>{edit.expectedText}</pre><b>+ 修复候选</b><pre>{edit.replacementText}</pre></div>)}
      {proposal.proposal.protectedFactChanges.map((change: string) => <p key={change}>{change}</p>)}
      {proposal.proposal.checks.map((check: any) => <p key={check.id}>{check.status} · {check.detail}</p>)}
      <ProposalRevision key={proposal.proposal.id} image={proposal} context={context} api={api} run={run} busy={busy}
        disabled={project.document.externalChange || proposal.proposal.baseDocumentHash !== project.document.contentHash || project.ledger.proposalStates[proposal.proposal.id]?.state !== 'pending'}
        onRevised={async image => { setProposal(image); await refresh(); setMessage('修复编辑已保存为新候选，保留问题关联和原建议；主稿未改变。') }} />
      <p>引用新增 {proposal.proposal.citationChanges.added.join('、') || '无'}；删除 {proposal.proposal.citationChanges.removed.join('、') || '无'}。问题只有复查通过才能关闭。</p>
      {(project.ledger.proposalStates[proposal.proposal.id]?.state === 'pending') && <>
        <button disabled={busy || project.document.externalChange || proposal.proposal.baseDocumentHash !== project.document.contentHash} onClick={() => run(async () => {
          const result = await api('edits.apply', { context: context(), proposalId: proposal.proposal.id, proposalHash: proposal.proposalHash }); setProposal(undefined); setMessage(result.recheck?.detail ?? '建议状态已保存，请查看当前版本审查。'); await refresh()
        })}>接受问题修复并复查规则</button>
        <button disabled={busy} onClick={() => run(async () => { await api('edits.reject', { context: context(), proposalId: proposal.proposal.id }); setProposal(undefined); setMessage('已拒绝修复候选，正文未改变，问题仍待复查。'); await refresh() })}>拒绝问题修复候选</button></>}
      <button disabled={busy} onClick={() => setProposal(undefined)}>关闭问题修复差异</button></section>}
    <p role="status">{message}</p>
  </section>
}
