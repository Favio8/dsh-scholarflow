import React, { useEffect, useRef, useState } from 'react'
import { MarkdownView } from './markdown.tsx'
import { projectMarkdown } from '../core/editing/markdown.ts'
import { reviewRunFinished } from './review-run-ui.ts'
import type { EditProposal } from '../shared/editing.ts'
import type { FlowReview, ReviewActivity } from './flow-status.ts'
import type { inspectImprovements } from '../core/review/improvements.ts'

type Image = { proposal: EditProposal; proposalHash: string }
type Improvements = Awaited<ReturnType<typeof inspectImprovements>>
type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>;
  run: (fn: () => Promise<unknown>) => void; busy: boolean; editor?: any; onReview: (value: FlowReview) => void;
  onActivity?: (value: ReviewActivity | undefined) => void; onSuggestions: (count: number) => void; onSources?: () => void }

export function ReviewAssistant({ project, context, api, refresh, run, busy, editor, onReview, onActivity, onSuggestions, onSources }: Props) {
  const [images, setImages] = useState<Image[]>([]), [working, setWorking] = useState(false), [message, setMessage] = useState('')
  const [failure, setFailure] = useState(''), [needsMaterials, setNeedsMaterials] = useState(false)
  const [remaining, setRemaining] = useState(false)
  const [citationLabels, setCitationLabels] = useState<Record<string, string>>()
  const active = useRef<{ context: any; runId: string } | undefined>(undefined), stopped = useRef(false), live = useRef(true)
  const binding = project.binding.projectId + ':' + project.binding.sessionId, scope = useRef(binding); scope.current = binding
  useEffect(() => { live.current = true; return () => { live.current = false; stopped.current = true } }, [])
  useEffect(() => { onSuggestions(images.length) }, [images, onSuggestions])
  useEffect(() => {
    if (busy || working) return
    let current = true
    Promise.all([api('review.improvements', { context: context() }), api('document.citations', { context: context(), text: project.document.text })]).then(([value, citations]: [Improvements, any]) => {
      if (current) { setCitationLabels(citations.labels); setImages(value.proposals); setNeedsMaterials(value.needsMaterials);
        setRemaining(value.groups.some(group => !value.proposals.some(image => group.issueIds.includes(image.proposal.reviewIssue!.issueId)))) }
    }).catch(error => current && setFailure(error.message))
    return () => { current = false }
  }, [binding, project.ledger.revision, project.document.contentHash, busy, working])

  const improve = () => run(async () => {
    const owner = binding, belongs = () => live.current && scope.current === owner
    stopped.current = false; setWorking(true); setFailure(''); setMessage('AI正在检查并整理修改建议…'); onActivity?.('running')
    const start = async (prepare: string, execute: string, data: any = {}) => {
      const captured = context(), plan = await api(prepare, { context: captured, ...data })
      if (stopped.current || !belongs()) return undefined
      active.current = { context: captured, runId: plan.runId }
      try { return await api(execute, { context: captured, planId: plan.planId, planHash: plan.planHash }) }
      finally { active.current = undefined }
    }
    try {
      const changedBuffer = !!editor?.dirty
      if (changedBuffer) await editor.save()
      if (!belongs() || stopped.current) return
      const cached = await api('review.inspect', { context: context() })
      let current: Improvements = await api('review.improvements', { context: context() })
      if (!belongs() || stopped.current) return
      if (!changedBuffer && cached.report?.modelRunId && !cached.stale && current.proposals.length) onReview(cached)
      else {
        const rules = await api('review.run', { context: context() }); if (!belongs()) return
        onReview(rules); await refresh()
        if (stopped.current || !belongs()) return
        const checked = await start('review.prepareModel', 'review.startModel')
        if (!belongs() || stopped.current) return
        if (!checked || !reviewRunFinished(checked.run.status) || !checked.report) {
          onActivity?.(checked?.run.status === 'paused' ? 'paused' : checked?.run.status === 'cancelled' ? 'stopped' : 'failed')
          setMessage(checked?.run.status === 'paused' ? '检查已暂停，可点击重试继续。' : checked?.run.status === 'cancelled' ? '检查已停止。' : '检查中断，已有结果已保留。')
          return
        }
        onReview({ report: checked.report, stale: false }); await refresh()
        current = await api('review.improvements', { context: context() })
      }
      if (!belongs()) return
      setImages(current.proposals); setNeedsMaterials(current.needsMaterials)
      for (const group of current.groups) {
        if (stopped.current || !belongs()) return
        if (current.proposals.some(image => group.issueIds.includes(image.proposal.reviewIssue!.issueId))) continue
        const result = await start('review.prepareFix', 'runs.start', { issueId: group.issueId, instruction: group.instruction })
        if (stopped.current || !belongs()) return
        if (!result?.proposal) {
          onActivity?.(result?.run.status === 'paused' ? 'paused' : result?.run.status === 'cancelled' ? 'stopped' : 'failed')
          setMessage('建议生成中断，已有建议已保留，可点击重试继续。'); return
        }
        if (result.proposal.edits.every((edit: any) => edit.expectedText === edit.replacementText))
          await api('edits.reject', { context: context(), proposalId: result.proposal.id })
        await refresh()
        current = await api('review.improvements', { context: context() })
        if (!belongs()) return
        setImages(current.proposals)
      }
      if (belongs()) { setRemaining(false); onActivity?.(undefined); setMessage(current.proposals.length ? 'AI已准备好修改建议。' : current.needsMaterials ? '有些内容需要补充资料后再检查。' : '本轮检查完成。') }
    } catch (error) {
      if (belongs()) {
        if (stopped.current) { setMessage('检查已停止，已有建议已保留。'); onActivity?.('stopped') }
        else { setFailure((error as Error).message); setMessage('本次检查没有跑完，已有结果已保留。'); onActivity?.('failed') }
      }
    } finally { if (belongs()) { setWorking(false); active.current = undefined; await refresh() } }
  })
  const stop = async () => {
    stopped.current = true
    if (active.current) {
      try { await api('runs.cancel', { context: active.current.context, runId: active.current.runId }) }
      catch (error) { setFailure((error as Error).message); return }
    }
    setMessage('检查已停止，已有建议已保留。'); onActivity?.('stopped')
  }
  const decide = (accept: boolean) => run(async () => {
    const owner = binding, refs = images.map(image => ({ proposalId: image.proposal.id, proposalHash: image.proposalHash }))
    setFailure('')
    try {
      if (accept) await api('review.applyImprovements', { context: context(), proposals: refs })
      else for (const ref of refs) {
        if (!live.current || scope.current !== owner) return
        await api('edits.reject', { context: context(), proposalId: ref.proposalId }); await refresh()
      }
      if (live.current && scope.current === owner) { setImages([]); setMessage(accept ? '修改已采用并保存。' : '已保留原稿。'); await refresh() }
    } catch (error) { if (live.current && scope.current === owner) { setFailure((error as Error).message); setMessage('正文或建议已有更新，请重新检查。') } }
  })
  const stale = project.document.externalChange || images.some(image => image.proposal.baseDocumentHash !== project.document.contentHash)
  const ready = images.length > 0 && !remaining && !stale && !editor?.dirty && !failure
  return <section className="sf-review-assistant" aria-label="AI检查">
    <header className="sf-page-heading"><h2>AI检查</h2></header>
    <p className="sf-muted sf-review-purpose">帮你检查论文，并准备好修改建议。</p>
    {(!ready || working) && <div className="sf-page-actions">{working ? <><span role="status">AI正在检查并整理修改建议…</span><button onClick={stop}>停止</button></> :
      <button className="sf-primary" disabled={busy || project.document.externalChange || editor?.dirty && !editor.canSave} onClick={improve}>{remaining && images.length ? '继续完善' : failure || message.includes('中断') || message.includes('没有跑完') || message.includes('停止') || message.includes('暂停') ? '重试' : '一键检查并完善'}</button>}</div>}
    {!working && message && <p role="status" className="sf-review-outcome">{message}</p>}
    {!working && needsMaterials && <div className="sf-review-materials"><span>有些内容需要补充资料。</span><button onClick={onSources}>补充资料</button></div>}
    {images.length > 0 && <section className="sf-review-preview" aria-label="修改预览"><h3>修改预览</h3>
      {images.map(image => image.proposal.edits.map((edit, index) => <article className="sf-review-edit" key={`${image.proposal.id}_${index}`}>
        <div><span className="sf-muted">原文</span><div className="sf-review-before"><MarkdownView projection={projectMarkdown(edit.expectedText, [], citationLabels)} /></div></div>
        <div><span className="sf-muted">修改后</span><div className="sf-review-after"><MarkdownView projection={projectMarkdown(edit.replacementText, [], citationLabels)} /></div></div>
        {image.proposal.protectedFactChanges.length > 0 && <p className="sf-review-facts">{image.proposal.protectedFactChanges.join(' ')}</p>}
      </article>))}
      {(stale || editor?.dirty) && <p>正文有新修改，请重新检查后再采用。</p>}
      <div className="sf-page-actions"><button className="sf-primary" disabled={busy || working || stale || editor?.dirty} onClick={() => decide(true)}>采用修改</button>
        <button disabled={busy || working} onClick={() => decide(false)}>保留原稿</button></div>
    </section>}
    {failure && <details className="sf-detail"><summary>查看原因</summary><p>{failure}</p></details>}
  </section>
}

export const REVIEW_ASSISTANT_CSS = `
.sf-review-assistant{padding-block:var(--sf-space-2);max-width:960px}
.sf-review-assistant .sf-review-purpose{margin:var(--sf-space-2) 0 var(--sf-space-4)}
.sf-review-outcome{margin:var(--sf-space-4) 0;color:var(--sf-text)}
.sf-review-materials{display:flex;align-items:center;gap:var(--sf-space-3);margin-block:var(--sf-space-4);color:var(--sf-muted)}
.sf-review-preview{margin-top:var(--sf-space-5)}
.sf-review-edit{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--sf-space-4);padding-block:var(--sf-space-4);border-top:1px solid var(--sf-border-soft)}
.sf-review-edit>div{min-width:0}.sf-review-edit .sf-prose{font-family:var(--sf-family-sans);font-size:var(--sf-font-md);padding-top:var(--sf-space-2);overflow-wrap:anywhere}
.sf-review-before{color:var(--sf-muted)}.sf-review-after{border-left:2px solid var(--sf-accent-border);padding-left:var(--sf-space-3)}
.sf-review-facts{grid-column:1/-1;color:var(--sf-warn-text);font-size:var(--sf-font-sm);margin:0}
.sf-review-details{margin-top:var(--sf-space-5)}
@container sf-workbench (max-width:600px){.sf-review-edit{grid-template-columns:minmax(0,1fr)}.sf-review-materials{flex-wrap:wrap}}
`
