import React, { useEffect, useState } from 'react'

type Props = { project: any; workflow: any; context: () => any; api: (method: string, request: any) => Promise<any>;
  refresh: () => Promise<void>; inspectWorkflow: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
const ended = (state: any) => state && ['failed', 'cancelled', 'succeeded', 'completed-with-issues'].includes(state.status)
export function AutomaticWorkflow({ project, workflow, context, api, refresh, inspectWorkflow, run, busy }: Props) {
  const workflowId = workflow.input.workflowId
  const [value, setValue] = useState<any>(), [preview, setPreview] = useState<any>(), [active, setActive] = useState<any>(), [error, setError] = useState('')
  const [ruleReview, setRuleReview] = useState(true), [delivery, setDelivery] = useState(false), [insufficient, setInsufficient] = useState(false), [stopRevision, setStopRevision] = useState(false)
  const [reason, setReason] = useState(''), [steps, setSteps] = useState(32), [noProgress, setNoProgress] = useState(2)
  const [modelReview, setModelReview] = useState(false)
  const [work, setWork] = useState('none'), [sectionId, setSectionId] = useState(''), [issueId, setIssueId] = useState(''), [sequence, setSequence] = useState<any>()
  const [instruction, setInstruction] = useState('依据已登记证据生成当前范围候选，保留引用、限制和待补项。')
  const [queries, setQueries] = useState(''), [purpose, setPurpose] = useState('为当前已确认研究问题寻找来源元数据候选'), [limit, setLimit] = useState(5)
  const workRequest = () => {
    if (work === 'sequence') return { draftSequenceId: sequence?.input.sequenceId }
    if (work === 'section') return { generation: { instruction, sectionId } }
    if (work === 'revision') return { revision: { issueId, instruction } }
    if (work === 'research') return { searches: queries.split(/\r?\n/u).map(query => query.trim()).filter(Boolean).map(query => ({ query, purpose, limit })) }
    return {}
  }
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
    <p>按已保存事实推进，并可预先授权一个固定检索、章节、修订或五项审查阶段。候选保存后停下审阅；接受后的下一阶段依据实际新稿另行预览，继续使用原目标额度。</p>
    <button disabled={busy} onClick={() => run(inspect)}>刷新自动推进检查点</button>
    {error && <p role="alert">{error}</p>}
    {state && <><p role="status" aria-label="自动推进状态">{state.automaticId} · {state.status} · {state.code ?? ''} · {state.reason}</p>
      {state.steps.some((row: any) => row.state === 'pending') && <p role="alert">一个已登记步骤尚无完成确认；不会重放。请核对实际产物，保留原额度并明确规划新尝试。</p>}
      <details><summary>查看已登记步骤</summary><ol>{state.steps.map((row: any) => <li key={row.stepId}>步骤 {row.number} · {row.stage ?? '结束'} · {row.operation} · {row.state}</li>)}</ol></details>
    </>}
    {limits && <p role="status" aria-label="自动推进原任务额度">已执行 {limits.usedSteps} 步 · 无进展 {limits.noProgress}/{limits.maxNoProgress}；连续无进展时保留结果并暂停。</p>}
    {!taskEnded && (!state || ended(state)) && <>
      <label><input type="checkbox" aria-label="授权自动规则审查" checked={ruleReview} disabled={busy} onChange={e => setRuleReview(e.target.checked)} />自动运行缺少的同版规则审查</label>
      <label>本次固定阶段<select aria-label="自动推进固定阶段" value={work} disabled={busy || !!preview} onChange={e => { setWork(e.target.value); setModelReview(false) }}>
        <option value="none">推进已保存事实／审查</option><option value="research">Crossref 多查询检索</option><option value="sequence">已确认初稿顺序的下一节</option><option value="section">所选大纲章节候选</option><option value="revision">当前定位问题的修订候选</option></select></label>
      {work === 'sequence' && <><button disabled={busy} onClick={() => run(async () => setSequence((await api('draftSequence.inspect', { context: context() })).sequence))}>读取当前已确认初稿顺序</button>
        <p>{sequence ? `${sequence.input.sequenceId} · ${sequence.checkpoint.status} · 原模型 ${sequence.input.model.providerId}/${sequence.input.model.modelId}` : '请先在初稿页确认顺序，再读取。'}</p></>}
      {work === 'section' && <label>生成章节<select aria-label="自动生成章节" value={sectionId} onChange={e => setSectionId(e.target.value)}><option value="">请选择</option>
        {project.ledger.outline.sections.map((section: any) => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>}
      {work === 'revision' && <label>修订问题<select aria-label="自动修订问题" value={issueId} onChange={e => setIssueId(e.target.value)}><option value="">请选择当前定位问题</option>
        {(Object.values(project.ledger.reviewIssues) as any[]).filter(issue => issue.location && !issue.stale && issue.documentHash === project.document.contentHash && issue.state !== 'resolved').map(issue => <option key={issue.id} value={issue.id}>{issue.severity} · {issue.title}</option>)}</select></label>}
      {['section', 'revision'].includes(work) && <label>本次生成指令<textarea aria-label="自动阶段生成指令" maxLength={16000} value={instruction} onChange={e => setInstruction(e.target.value)} /></label>}
      {work === 'research' && <><label>查询词（每行一条，最多 12 条）<textarea aria-label="自动阶段检索查询" value={queries} maxLength={12000} onChange={e => setQueries(e.target.value)} /></label>
        <label>检索用途<input aria-label="自动阶段检索用途" value={purpose} maxLength={2000} onChange={e => setPurpose(e.target.value)} /></label>
        <label>每条候选上限<input aria-label="自动阶段检索候选上限" type="number" min={1} max={20} value={limit} onChange={e => setLimit(Number(e.target.value))} /></label>
        <p>仅发送查询词和数量；不向 Crossref 发送项目正文、资料或记忆。</p></>}
      <label><input type="checkbox" aria-label="授权自动五项模型审查" checked={modelReview} disabled={busy || work !== 'none'} onChange={e => setModelReview(e.target.checked)} />在审查阶段发送当前已保存全文、要求和相关证据，执行一次五项模型审查（预览固定宿主模型）</label>
      <label><input type="checkbox" aria-label="授权自动工作草稿交付" checked={delivery} disabled={busy} onChange={e => setDelivery(e.target.checked)} />自动创建同版工作草稿交付（不标记已审查）</label>
      <label><input type="checkbox" aria-label="明确保留检索不足继续" checked={insufficient} disabled={busy} onChange={e => setInsufficient(e.target.checked)} />未达证据数量时，按以下理由保留不足继续；不允许编造正文</label>
      <label><input type="checkbox" aria-label="明确保留问题结束修订" checked={stopRevision} disabled={busy} onChange={e => setStopRevision(e.target.checked)} />没有可执行修复时，按以下理由保留问题结束修订</label>

      <label>连续无进展上限<input aria-label="自动推进无进展上限" type="number" min={1} max={3} value={limits?.maxNoProgress ?? noProgress} disabled={busy || !!limits} onChange={e => setNoProgress(Number(e.target.value))} /></label>
      <button disabled={busy || workflow.configChanged || workflow.checkpoint.status !== 'waiting-input' || (insufficient || stopRevision) && reason.trim().length < 10 ||
        work === 'sequence' && !sequence || work === 'section' && !sectionId || work === 'revision' && !issueId || work === 'research' && !queries.trim()}
        onClick={() => run(async () => setPreview(await api('automatic.prepare', { context: context(), workflowId, modelReview, ...workRequest(), policy: { ruleReview, workingDraftDelivery: delivery,
          maxSteps: limits?.maxSteps ?? steps, maxNoProgress: limits?.maxNoProgress ?? noProgress,
          ...(insufficient && { insufficientResearchReason: reason }), ...(stopRevision && { stopRevisionReason: reason }) } })))}>预览自动推进已保存阶段</button>
    </>}
    {!taskEnded && state && !ended(state) && <>
      <button disabled={busy || reason.trim().length < 10 || state.steps.some((row: any) => row.state === 'pending')} onClick={() => action('resume')}>预览恢复自动推进</button>
      <button disabled={busy || reason.trim().length < 10} onClick={() => action('close')}>预览结束本次自动推进</button>
    </>}
    {!taskEnded && <label>自动推进保留缺口／恢复／结束理由<textarea aria-label="自动推进决定理由" maxLength={4000} value={reason} disabled={busy || !!preview} onChange={e => setReason(e.target.value)} /></label>}
    {active && <div aria-label="正在自动推进"><p role="status">已开始有限调度，按原预算保存结果。</p>
      <p>暂停等待当前有限调用完成保存后停止后续调度；取消会传到正在执行的调用。已消耗额度与未知响应记录保留。</p>
      {(['pause', 'cancel'] as const).map(action => <button key={action} onClick={() => api('automatic.control', { context: active.context, workflowId, automaticId: active.automaticId, action }).catch(e => setError(e.message))}>{action === 'pause' ? '暂停自动推进' : '取消自动推进'}</button>)}</div>}
    {preview && <section role="dialog" aria-label="自动推进确认"><h4>{preview.action ? '确认恢复／结束' : '确认有限推进范围'}</h4>
      {preview.input && <><p>推进当前已保存事实{preview.input.work ? '及所列固定阶段' : ''}；规则审查 {preview.input.policy.ruleReview ? '允许' : '不允许'} · 工作草稿交付 {preview.input.policy.workingDraftDelivery ? '允许' : '不允许'}。</p>
        <p>连续无进展阈值 {preview.input.policy.maxNoProgress}。</p>
        {preview.input.policy.insufficientResearchReason && <p>保留检索不足：{preview.input.policy.insufficientResearchReason}</p>}
        {preview.input.policy.stopRevisionReason && <p>保留问题结束修订：{preview.input.policy.stopRevisionReason}</p>}
        {preview.input.modelReview ? <><p>模型 {preview.input.modelReview.modelDescriptor.providerId} / {preview.input.modelReview.modelDescriptor.modelId} · 当前范围 {preview.input.modelReview.inputBytes} 字节 · 五项检查：论证、文风、术语、贡献项、摘要／结论与实际正文。</p>
          <p>向此宿主模型发送当前已保存全文、要求、相关定位证据、批准记忆、文风与固定 Skill；不发送未选资料全文。原模型调用与审查轮次预算不重置。</p></> : !preview.input.work && <p>不调用模型。</p>}
        {preview.input.work && <><p>阶段 {preview.input.work.stage} · 范围 {preview.input.work.inputBytes} 字节 · 原目标 {workflowId}</p>
          {preview.input.work.kind === 'generation' ? <><p>宿主模型 {preview.input.work.modelDescriptor.providerId}/{preview.input.work.modelDescriptor.modelId} · {preview.stagePreview.scope}</p>
            <p>指令：{preview.stagePreview.instruction}</p>{preview.stagePreview.sourceText && <pre>{preview.stagePreview.sourceText}</pre>}
            <p>相关证据：{preview.stagePreview.evidenceIds.join('、')}。候选另行接受，正文保留。</p></> : <><p>提供方 Crossref · {preview.stagePreview.destination}</p>
              <ol>{preview.stagePreview.searches.map((row: any) => <li key={row.queryId}>{row.search.query} · 最多 {row.search.limit} 条 · {row.search.purpose}</li>)}</ol></>}
        </>}
        <p>当前输入指纹 {preview.input.dependencyHash}。不接受正文修改。</p></>}
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
