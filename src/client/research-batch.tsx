import React, { useEffect, useState } from 'react'
type Props = { search: any; context: () => any; api: (method: string, request: any) => Promise<any>; run: (fn: () => Promise<unknown>) => void;
  busy: boolean; onSearch: (searchId: string) => Promise<void>; refresh: () => Promise<void> }
const labels: Record<string, string> = { pending: '待执行', running: '执行中', completed: '结果已保存', failed: '失败', cancelled: '已取消', interrupted: '中断',
  paused: '已暂停', 'completed-with-issues': '检索结束，证据仍需确认', succeeded: '完成', queued: '排队', 'waiting-input': '待确认' }
export function ResearchBatch({ search, context, api, run, busy, onSearch, refresh }: Props) {
  const [queries, setQueries] = useState<any[]>([]), [plan, setPlan] = useState<any>(), [history, setHistory] = useState<any>(), [view, setView] = useState<any>()
  const [activeRun, setActiveRun] = useState(''), [message, setMessage] = useState(''), [sequence, setSequence] = useState(0)
  useEffect(() => { let live = true
    api('research.batchList', { context: context() }).then(value => live && setHistory(value)).catch(error => live && setMessage(error.message))
    return () => { live = false }
  }, [sequence])
  useEffect(() => { if (!activeRun) return; let live = true
    const timer = window.setInterval(() => api('research.batchRead', { context: context(), runId: activeRun }).then(value => live && setView(value)).catch(() => {}), 1000)
    return () => { live = false; clearInterval(timer) }
  }, [activeRun])
  const action = (runId: string, kind: string) => run(async () => setPlan(await api('research.batchPrepareAction', { context: context(), runId, action: kind })))
  return <section aria-label="多查询检索"><h4>多查询检索计划</h4>
    <p>将上方填写的查询加入本次计划，核对全部发送范围后执行。各查询独立保存结果；候选仍须逐条说明纳入／排除理由。</p>
    <button disabled={busy || queries.length >= 12 || search.query.trim().length < 3 || !search.purpose.trim()} onClick={() => { setQueries([...queries, structuredClone(search)]); setPlan(undefined) }}>将当前查询加入检索计划</button>
    <ol>{queries.map((item, index) => <li key={index}>{item.query} · 候选上限 {item.limit} · {item.yearFrom ?? '不限'}–{item.yearTo ?? '不限'}<p>用途：{item.purpose}</p>
      <button disabled={busy} aria-label={`移除计划查询 ${index + 1}`} onClick={() => { setQueries(queries.filter((_, i) => i !== index)); setPlan(undefined) }}>移除此查询</button></li>)}</ol>
    <button disabled={busy || !queries.length} onClick={() => run(async () => setPlan(await api('research.batchPrepare', { context: context(), searches: queries })))}>预览多查询检索</button>
    {plan && <section role="dialog" aria-label="多查询检索确认"><h5>{plan.action === 'start' ? '确认检索计划' : plan.action === 'resume' ? '确认恢复检索' : plan.action === 'retry' ? '确认新运行重试' : '确认结束检索'}</h5>
      <p>{plan.destination} · 本次最多 {plan.budget.maxSearchQueries} 次请求、{plan.budget.maxCandidateSources} 个候选、{plan.budget.maxDurationMinutes} 分钟；重试请求也计入预算。</p>
      {plan.previousRunId && <p>原运行 {plan.previousRunId} · 已使用 {plan.usedQueries} 次请求，已保存 {plan.candidatesReceived} 个候选。</p>}
      <ol>{plan.searches.map((item: any) => <li key={item.queryId}>{item.search.query} · 上限 {item.search.limit} · {item.search.yearFrom ?? '不限'}–{item.search.yearTo ?? '不限'}<p>用途：{item.search.purpose}</p></li>)}</ol>
      {plan.queryStates?.map((query: any) => <p key={query.queryId}>{query.queryId} · {labels[query.state]} · {query.attempts.length} 次尝试</p>)}
      {plan.risks.map((risk: string, i: number) => <p key={i}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => {
        const confirmed = plan; setPlan(undefined); if (confirmed.action !== 'close') setActiveRun(confirmed.runId)
        try { const result = await api('research.batchStart', { context: context(), planId: confirmed.planId, planHash: confirmed.planHash })
          setView(result); setMessage(`检索批次：${labels[result.run.status] ?? result.run.status}${result.run.errorCode ? ` · ${result.run.errorCode}` : ''}。已有结果和失败记录已保留。`)
          if (confirmed.action === 'start') setQueries([]); await refresh()
        } finally { setActiveRun(''); setSequence(n => n + 1) }
      })}>确认本次检索操作</button>
      <button disabled={busy} onClick={() => run(async () => { await api('research.batchDismiss', { planId: plan.planId }); setPlan(undefined) })}>取消多查询检索预览</button>
    </section>}
    {!!activeRun && <section aria-label="检索批次控制"><p role="status">检索运行 {activeRun} · {view?.checkpoint?.queriesUsed ?? 0} 次请求已记账</p>
      <button onClick={() => api('runs.pause', { context: context(), runId: activeRun }).then(() => setMessage('已请求暂停；当前请求结束保存后停止调度。')).catch(e => setMessage(e.message))}>暂停当前检索批次</button>
      <button onClick={() => api('runs.cancel', { context: context(), runId: activeRun }).then(() => setMessage('已请求取消；成功结果保留，当前请求收到取消信号。')).catch(e => setMessage(e.message))}>取消当前检索批次</button>
    </section>}
    <button disabled={busy} onClick={() => setSequence(n => n + 1)}>刷新检索批次历史</button>
    {history?.diagnostics.map((warning: string, index: number) => <p key={index} role="alert">{warning}</p>)}
    {history?.runs.map((row: any) => <section key={row.runId} aria-label={`检索批次 ${row.runId}`}><p>{row.runId} · {labels[row.status] ?? row.status}{row.errorCode ? ` · ${row.errorCode}` : ''}{row.parentRunId ? ` · 重试来源 ${row.parentRunId}` : ''}</p>
      <button disabled={busy} onClick={() => run(async () => setView(await api('research.batchRead', { context: context(), runId: row.runId })))}>查看检索批次 {row.runId}</button>
      {['paused', 'interrupted', 'running', 'queued', 'waiting-input'].includes(row.status) && <><button disabled={busy} onClick={() => action(row.runId, 'resume')}>预览恢复检索 {row.runId}</button>
        <button disabled={busy} onClick={() => action(row.runId, 'close')}>预览结束检索 {row.runId}</button></>}
      {['failed', 'cancelled'].includes(row.status) && <button disabled={busy} onClick={() => action(row.runId, 'retry')}>预览关联检索重试 {row.runId}</button>}
    </section>)}
    {view && <section aria-label="检索批次结果"><p role="status">批次 {view.run.runId} · {labels[view.run.status] ?? view.run.status} · 已用 {view.checkpoint.queriesUsed} 次查询 · 已保存 {view.checkpoint.candidatesReceived} 个候选</p>
      {view.checkpoint.queries.map((query: any) => <section key={query.queryId}><p>{view.searches?.find((item: any) => item.queryId === query.queryId)?.search.query ?? query.queryId} · {labels[query.state]}</p>
        {query.attempts.map((attempt: any) => <p key={attempt.searchId}>{attempt.searchId} · {labels[attempt.state]}{attempt.errorCode ? ` · ${attempt.errorCode}` : ''}
          <button disabled={busy} onClick={() => run(async () => onSearch(attempt.searchId))}>查看查询记录 {attempt.searchId}</button></p>)}
        {query.retryNotBefore && <p>重试不得早于 {new Date(query.retryNotBefore).toLocaleString()}</p>}
      </section>)}
    </section>}
    <p role="status">{message}</p>
  </section>
}
