import React, { useEffect, useMemo, useRef, useState } from 'react'
import { projectMarkdown, wordStats } from '../core/editing/markdown.ts'
import { MarkdownView, captureSelection } from './markdown.tsx'
import type { SelectionPayload } from '../shared/editing.ts'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
const buffers = new Map<string, { text: string; baseHash: string }>()
function readLocalBuffer(key: string) {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? 'null')
    if (value && typeof value.text === 'string' && value.text.length <= 2 * 1024 * 1024 && /^sha256:[0-9a-f]{64}$/.test(value.baseHash)) return value as { text: string; baseHash: string }
  } catch { /* Host temporary buffer remains available when browser storage fails. */ }
}
export function Draft({ project, context, api, refresh, run, busy }: Props) {
  const projectId = project.binding.projectId
  const bufferKey = `sf-editor:${projectId}:${project.binding.sessionId}`
  const cached = buffers.get(bufferKey) ?? readLocalBuffer(bufferKey)
  if (cached && !buffers.has(bufferKey)) buffers.set(bufferKey, cached)
  const [text, setText] = useState(cached?.text ?? project.document.text)
  const [baseHash, setBaseHash] = useState(cached?.baseHash ?? project.document.contentHash)
  const [selection, setSelection] = useState<SelectionPayload>()
  const [message, setMessage] = useState('')
  const [instruction, setInstruction] = useState('改善表达，保留事实、适用范围和引用。')
  const [plan, setPlan] = useState<any>()
  const [proposal, setProposal] = useState<any>()
  const [activeRun, setActiveRun] = useState('')
  const [progress, setProgress] = useState<any>()
  const [bufferReady, setBufferReady] = useState(false), [bufferMessage, setBufferMessage] = useState('正在读取宿主暂存缓冲…'), [recoverable, setRecoverable] = useState<any>()
  const bufferHash = useRef<string | null>(null), hostDirty = useRef(false), persistence = useRef(Promise.resolve()), persistenceBlocked = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const dirty = text !== project.document.text || baseHash !== project.document.contentHash
  const projection = useMemo(() => projectMarkdown(project.document.text), [project.document.contentHash])
  const statistics = useMemo(() => wordStats(project.document.text), [project.document.contentHash])
  useEffect(() => {
    if (!buffers.has(bufferKey)) { setText(project.document.text); setBaseHash(project.document.contentHash) }
    setSelection(undefined); setPlan(undefined)
  }, [project.document.contentHash])
  useEffect(() => {
    let live = true
    api('editor.bufferRead', { context: context() }).then(result => {
      if (!live) return
      bufferHash.current = result.bufferHash; hostDirty.current = result.buffer?.state === 'dirty'
      const local = buffers.get(bufferKey)
      if (hostDirty.current && result.buffer.text !== project.document.text && (!local || local.text !== result.buffer.text || local.baseHash !== result.buffer.baseHash)) setRecoverable(result.buffer)
      setBufferReady(true); setBufferMessage(cached ? '已保留本页面的未提交编辑；等待同步到宿主暂存区。' : hostDirty.current ? '宿主有未提交编辑，可先比较再恢复。' : '未提交编辑将暂存到宿主，主稿只在明确保存后改变。')
    }).catch(error => live && setBufferMessage(`暂存读取失败，当前编辑仍保留在本页面：${error.message}`))
    return () => { live = false }
  }, [bufferKey])
  useEffect(() => {
    if (!bufferReady || persistenceBlocked.current || recoverable || (!dirty && !hostDirty.current)) return
    const timer = window.setTimeout(() => {
      const edit = { text, baseHash, state: dirty ? 'dirty' as const : 'cleared' as const }
      persistence.current = persistence.current.then(async () => {
        if (persistenceBlocked.current) return
        const result = await api('editor.bufferWrite', { context: context(), ...edit, baseBufferHash: bufferHash.current })
        bufferHash.current = result.bufferHash; hostDirty.current = result.buffer.state === 'dirty'
        const latest = buffers.get(bufferKey)
        if (!latest || (latest.text === edit.text && latest.baseHash === edit.baseHash)) setBufferMessage(edit.state === 'dirty' ? '未提交编辑已暂存到宿主；主稿尚未改变。' : '宿主暂存缓冲已清理；主稿版本保持一致。')
      }).catch(error => { persistenceBlocked.current = true; setBufferMessage(`暂存未完成，保留本页面编辑：${error.message}`) })
    }, 500)
    return () => clearTimeout(timer)
  }, [text, baseHash, project.document.contentHash, bufferReady, recoverable])
  const remember = (value?: { text: string; baseHash: string }) => {
    if (value) buffers.set(bufferKey, value); else buffers.delete(bufferKey)
    try { if (value) window.sessionStorage.setItem(bufferKey, JSON.stringify(value)); else window.sessionStorage.removeItem(bufferKey) }
    catch { setBufferMessage('浏览器临时备份不可用；请等宿主暂存完成后再刷新。') }
  }
  useEffect(() => {
    // Only explicit edits create a buffer. A server revision renders before the
    // adoption effect settles; caching that intermediate old state would turn
    // an accepted proposal into a spurious stale manual buffer.
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [text, baseHash, project.document.contentHash])
  useEffect(() => {
    if (!activeRun) return
    let live = true
    const timer = window.setInterval(() => api('runs.inspect', { context: context(), runId: activeRun }).then(result => live && setProgress(result.run)).catch(() => {}), 1000)
    return () => { live = false; clearInterval(timer) }
  }, [activeRun])
  const capture = () => {
    if (dirty) { setMessage('先保存或处理手工编辑缓冲，再选择已保存正文改写。'); return }
    try {
      if (!window.getSelection()?.toString()) return
      const payload = captureSelection(root.current!, projection, project.document, projectId)
      setSelection(payload); setMessage('已捕获源码范围；预览会显示实际修改内容。')
    } catch (error) { setSelection(undefined); setMessage((error as Error).message) }
  }
  const prepare = (whole: boolean) => run(async () => {
    if (!whole && !selection) throw new Error('请先选择已保存的渲染正文。')
    setPlan(await api('writing.prepare', { context: context(), instruction, ...(!whole && { selection }) }))
  })
  return <section aria-label="正文编辑"><h3>正文编辑</h3>
    <p>Markdown 是主稿事实源。手工编辑与模型建议均校验当前版本；主稿不会被旧缓冲自动覆盖。</p>
    <label>Markdown 手工编辑<textarea aria-label="Markdown 手工编辑" rows={10} disabled={busy} value={text} onChange={e => {
      const edited = project.document.lineEnding === 'crlf' ? e.target.value.replace(/\r\n|\r|\n/g, '\r\n') : e.target.value
      setText(edited)
      if (edited === project.document.text && baseHash === project.document.contentHash) remember()
      else remember({ text: edited, baseHash })
    }} /></label>
    {baseHash !== project.document.contentHash && <p role="alert">服务端稿件版本已改变，当前未保存缓冲已保留。请复制比较后显式采用当前版本。</p>}
    <button disabled={busy || !dirty || baseHash !== project.document.contentHash} onClick={() => run(async () => {
      const result = await api('document.saveManual', { context: context(), text, baseHash })
      remember(); setBaseHash(result.documentHash); setMessage('手工稿已保存，审查需按新版本重跑。'); await refresh()
    })}>保存手工稿</button>
    <button disabled={busy} onClick={() => { if ((dirty || recoverable) && !window.confirm('放弃当前未保存缓冲并采用服务端稿件？')) return; remember(); setRecoverable(undefined); setText(project.document.text); setBaseHash(project.document.contentHash); setMessage('已采用当前服务端稿件。') }}>显式采用服务端版本</button>
    <button disabled={busy || project.document.initialPlaceholder || dirty} onClick={() => run(async () => {
      await api('document.undo', { context: context(), revisionId: project.document.revisionId, baseHash: project.document.contentHash }); remember(); await refresh()
    })}>撤销当前版本为新修订</button>
    <p role="status" aria-label="编辑暂存状态">{bufferMessage}</p>
    {recoverable && <section aria-label="宿主未提交缓冲恢复"><h4>发现宿主未提交编辑</h4><p>这份缓冲不会自动写入主稿。恢复后仍需比较当前版本并显式保存；旧基础哈希会阻止覆盖新稿。</p>
      <pre>{recoverable.text.slice(0, 16000)}{recoverable.text.length > 16000 ? '\n[仅展示前16000字符；恢复会保留全文]' : ''}</pre>
      <button disabled={busy} onClick={() => { if (dirty && !window.confirm('用宿主未提交缓冲替换当前未保存编辑？')) return; setText(recoverable.text); setBaseHash(recoverable.baseHash); remember({ text: recoverable.text, baseHash: recoverable.baseHash }); setRecoverable(undefined); setBufferMessage('已恢复宿主缓冲，请核对版本后明确保存。') }}>恢复宿主未提交缓冲</button>
    </section>}
    <button disabled={busy || !persistenceBlocked.current} onClick={() => run(async () => {
      const result = await api('editor.bufferRead', { context: context() }); bufferHash.current = result.bufferHash; hostDirty.current = result.buffer?.state === 'dirty'
      persistenceBlocked.current = false; setBufferReady(true); setRecoverable(result.buffer?.state === 'dirty' ? result.buffer : undefined); setBufferMessage('已重读宿主缓冲，请比较保留的本页面编辑与宿主副本。')
    })}>重读冲突暂存缓冲</button>
    <p>{statistics.chineseCharacters} 汉字 · {statistics.westernWords} 西文词元。{statistics.detail}</p>
    <h4>已保存主稿预览</h4><div ref={root} onMouseUp={capture} onKeyUp={capture}><MarkdownView projection={projection} /></div>
    {selection && <section aria-label="已捕获选区"><h4>实际改写范围 [{selection.sourceRange.startUtf16}, {selection.sourceRange.endUtf16})</h4><pre>{selection.sourceText}</pre><p>引用：{selection.citationKeys.join('、') || '无'} · 段落 {selection.blockIds.join('、')}</p></section>}
    <label>改写／生成指令<textarea aria-label="改写生成指令" value={instruction} onChange={e => setInstruction(e.target.value)} /></label>
    <button disabled={busy || dirty || !selection || !instruction.trim()} onClick={() => prepare(false)}>预览选区改写计划</button>
    <button disabled={busy || dirty || !instruction.trim()} onClick={() => prepare(true)}>预览全文生成计划</button>
    {plan && <section role="dialog" aria-modal="false" aria-label="模型生成确认"><h4>确认宿主模型调用</h4>
      <p>{plan.model.providerId} / {plan.model.modelId} · 输入约 {plan.inputBytes} bytes · 源码范围 [{plan.scope.startUtf16}, {plan.scope.endUtf16})</p>
      <p>模型调用预算 {plan.budget.maxModelCalls}；运行时限 {plan.budget.maxDurationMinutes} 分钟；仅生成待审阅建议。</p>
      {plan.sourceText && <pre>{plan.sourceText}</pre>}{plan.risks.map((risk: string) => <p key={risk}>{risk}</p>)}
      <button disabled={busy} onClick={() => run(async () => {
        const confirmedPlan = plan
        setPlan(undefined); setActiveRun(confirmedPlan.runId); setProgress(undefined)
        try { const result = await api('runs.start', { context: context(), planId: confirmedPlan.planId, planHash: confirmedPlan.planHash }); setProposal(result); await refresh() }
        finally { setActiveRun('') }
      })}>确认生成建议</button>
      <button disabled={busy} onClick={() => setPlan(undefined)}>取消生成计划</button></section>}
    {activeRun && <section aria-label="当前生成运行"><p role="status">运行 {activeRun} · {progress?.status ?? '准备开始'} · 已调用模型 {progress?.usedModelCalls ?? 0} 次</p>
      <button onClick={() => api('runs.cancel', { context: context(), runId: activeRun }).then(() => setMessage('已请求取消，等待阶段保存检查点。')).catch(e => setMessage(e.message))}>取消当前生成</button></section>}
    {(Object.values(project.ledger.proposalStates) as any[]).filter(state => state.state === 'pending').map(state => <button key={state.proposalId} disabled={busy} onClick={() => run(async () => setProposal(await api('edits.read', { context: context(), proposalId: state.proposalId })))}>查看待审阅建议 {state.proposalId}</button>)}
    {proposal && <section aria-label="建议差异"><h4>待审阅差异 · {proposal.proposal.id}</h4><p>范围：{proposal.proposal.scope}。接受会使旧审查过期。</p>
      {proposal.proposal.edits.map((edit: any, index: number) => <div key={index}><p>源码 [{edit.startUtf16}, {edit.endUtf16})</p><b>− 原文</b><pre>{edit.expectedText}</pre><b>+ 新文</b><pre>{edit.replacementText}</pre></div>)}
      <p>引用新增：{proposal.proposal.citationChanges.added.join('、') || '无'}；删除：{proposal.proposal.citationChanges.removed.join('、') || '无'}。</p>
      {proposal.proposal.protectedFactChanges.map((change: string) => <p key={change}>{change}</p>)}
      {proposal.proposal.checks.map((check: any) => <p key={check.id}>{check.status} · {check.detail}</p>)}
      <button disabled={busy || dirty} onClick={() => run(async () => { await api('edits.apply', { context: context(), proposalId: proposal.proposal.id, proposalHash: proposal.proposalHash }); remember(); setProposal(undefined); await refresh() })}>接受此条建议</button>
      <button disabled={busy} onClick={() => run(async () => { await api('edits.reject', { context: context(), proposalId: proposal.proposal.id }); setProposal(undefined); await refresh() })}>拒绝此条建议</button></section>}
    <p role="status">{message}</p>
  </section>
}
