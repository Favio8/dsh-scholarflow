import React, { useEffect, useState } from 'react'

type Props = { project: any; sourceId: string; context: () => any; api: (method: string, request: any) => Promise<any>;
  refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
export function OnlineResearch({ project, sourceId, context, api, refresh, run, busy }: Props) {
  const [query, setQuery] = useState(''), [purpose, setPurpose] = useState(project.ledger.outline.researchQuestion), [limit, setLimit] = useState('10')
  const [yearFrom, setYearFrom] = useState(''), [yearTo, setYearTo] = useState('')
  const [plan, setPlan] = useState<any>(), [lookup, setLookup] = useState<any>(), [record, setRecord] = useState<any>()
  const [history, setHistory] = useState<any[]>([]), [message, setMessage] = useState(''), [reasons, setReasons] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    api('research.list', { context: context() }).then(rows => live && setHistory(rows)).catch(error => live && setMessage(error.message))
    return () => { live = false }
  }, [project.ledger.revision])
  const source = project.ledger.sources[sourceId]
  return <section aria-label="在线文献元数据"><h4>在线文献元数据</h4>
    <p>Crossref 返回候选元数据。查询前预览发送范围，候选需记录理由后才纳入来源；全文证据仍需另行取得并定位。</p>
    <label>查询词<input aria-label="文献查询词" disabled={busy} value={query} onChange={event => setQuery(event.target.value)} maxLength={1000} /></label>
    <label>与研究问题的关系<textarea aria-label="文献查询用途" disabled={busy} value={purpose} onChange={event => setPurpose(event.target.value)} maxLength={2000} /></label>
    <label>候选上限<input aria-label="文献候选上限" disabled={busy} type="number" min="1" max="20" value={limit} onChange={event => setLimit(event.target.value)} /></label>
    <label>出版年份范围（可留空）<input aria-label="文献起始年份" disabled={busy} type="number" min="1" max="9999" value={yearFrom} onChange={event => setYearFrom(event.target.value)} /> – <input aria-label="文献结束年份" disabled={busy} type="number" min="1" max="9999" value={yearTo} onChange={event => setYearTo(event.target.value)} /></label>
    <button disabled={busy || query.trim().length < 3 || !purpose.trim()} onClick={() => run(async () => setPlan(await api('research.prepare', {
      context: context(), search: { query, purpose, limit: Number(limit), ...(yearFrom && { yearFrom: Number(yearFrom) }), ...(yearTo && { yearTo: Number(yearTo) }) },
    })))}>预览在线文献查询</button>
    {plan && <section role="dialog" aria-label="在线查询确认"><p>提供方：{plan.provider} · {plan.destination}</p>
      <pre>{plan.search.query}</pre><p>用途：{plan.search.purpose} · 候选上限 {plan.search.limit} · 年份 {plan.search.yearFrom ?? '不限'}–{plan.search.yearTo ?? '不限'}</p>
      {plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => {
        const accepted = plan; setPlan(undefined)
        const result = await api('research.execute', { context: context(), planId: accepted.planId, planHash: accepted.planHash })
        setRecord(result); setMessage(`检索 ${result.state}${result.errorCode ? ` · ${result.errorCode}` : ''}；没有自动纳入来源。`)
        setHistory(await api('research.list', { context: context() }))
      })}>确认发送本次查询</button>
      <button disabled={busy} onClick={() => setPlan(undefined)}>取消在线查询</button>
    </section>}
    {!!history.length && <label>检索历史（最近 20 次）<select aria-label="文献检索历史" disabled={busy} value={record?.id ?? ''} onChange={event => {
      const searchId = event.target.value
      if (searchId) run(async () => setRecord(await api('research.read', { context: context(), searchId })))
      else setRecord(undefined)
    }}><option value="">请选择</option>{history.map(row => <option key={row.id} value={row.id}>{row.search.query} · {row.state} · {row.candidateCount} 条</option>)}</select></label>}
    {record && <><p role="status">检索 {record.id} · {record.state} · {record.records.length} 个候选</p>
      {record.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}
      {record.records.map((candidate: any) => <section key={candidate.candidateId} aria-label={`文献候选 ${candidate.candidateId}`}><h5>{candidate.title}</h5>
        <p>{candidate.authors.map((author: any) => author.literal).join('、')} · {candidate.year ?? '年份未知'} · DOI {candidate.recordId} · 仅元数据</p>
        {record.decisions[candidate.candidateId] ? <p>已{record.decisions[candidate.candidateId].decision === 'include' ? '纳入来源' : '排除'}：{record.decisions[candidate.candidateId].reason}</p>
          : <><label>纳入／排除理由<input aria-label={`文献决定理由 ${candidate.candidateId}`} disabled={busy} value={reasons[candidate.candidateId] ?? ''} maxLength={2000} onChange={event => setReasons({ ...reasons, [candidate.candidateId]: event.target.value })} /></label>
            {(['include', 'exclude'] as const).map(decision => <button key={decision} disabled={busy || !(reasons[candidate.candidateId] ?? '').trim()} onClick={() => run(async () => {
              await api('research.decide', { context: context(), searchId: record.id, candidateId: candidate.candidateId, decision, reason: reasons[candidate.candidateId] })
              await refresh(); setRecord(await api('research.read', { context: context(), searchId: record.id }))
            })}>{decision === 'include' ? '确认纳入此来源' : '确认排除此候选'}</button>)}</>}
      </section>)}
    </>}
    <h4>所选来源 DOI 核验</h4>
    <p>{source ? `${source.title} · ${source.identity.status} · ${source.identity.reason ?? ''}` : '先在来源列表选择已登记的来源。'}</p>
    <button disabled={busy || !source?.identifiers.doi} onClick={() => run(async () => setLookup(await api('sources.prepareLookup', { context: context(), sourceId })))}>预览所选来源 DOI 查询</button>
    {lookup && <section role="dialog" aria-label="DOI 查询确认"><p>{lookup.destination} · DOI {lookup.doi}</p>
      {lookup.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => {
        const accepted = lookup; setLookup(undefined)
        const result = await api('sources.lookup', { context: context(), planId: accepted.planId, planHash: accepted.planHash })
        setMessage(result.source ? `DOI 核验：${result.source.identity.status} · ${result.source.identity.reason}` : `核验结果未应用（${result.errorCode}）；请求快照 ${result.attemptId} 已保留，来源没有被覆盖。`); await refresh()
      })}>确认发送 DOI 查询</button>
      <button disabled={busy} onClick={() => setLookup(undefined)}>取消 DOI 查询</button>
    </section>}
    <p role="status">{message}</p>
  </section>
}
