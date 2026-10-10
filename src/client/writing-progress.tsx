import React, { useEffect, useState, useRef } from 'react'
import { writingReadPaths, type WritingTask } from '../shared/writing-task.ts'
import { activeWritingQuestion } from './writing-task-ui.ts'
import { groupIssues, mapLegacyNotes } from '../core/pipeline/task-issues.ts'

const STAGES: Record<string, string> = { materials: '读取工作区资料', research: '检索公开文献', evidence: '整理证据与引用', outline: '规划章节内容', drafting: '撰写正文', review: '检查全文', completed: '初稿已生成' }

/**
 * The compact progress line and the detail list (SPEC v1.2 §7, §9). The question itself lives
 * in the middle column's bottom overlay, so this component never grows a large card that
 * pushes the text down; it reports real counts and keeps technical text one level deeper.
 */
export function WritingProgress({ api, context, refresh, onTask, taskRevision, onManage }: any) {
  const [task, setTask] = useState<WritingTask>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [command,setCommand] = useState<string>()
  const latest = useRef({ context, refresh, onTask }); latest.current = { context, refresh, onTask }
  const revision = useRef<number | undefined>(undefined)
  useEffect(() => { let live = true
    const load = async () => { try { const result = await api('writingTask.inspect', { context: latest.current.context() }); if (!live) return
      if (revision.current !== result.task?.revision) { revision.current = result.task?.revision; latest.current.refresh().catch((error: Error) => live && setError(error.message)) }
      setTask(result.task); setError(result.taskDiagnostic?.message ?? ''); setElapsed(result.task?.elapsedMs ?? 0); latest.current.onTask?.(result)
    } catch (error) { if (live) setError((error as Error).message) } }
    load(); const timer = window.setInterval(load, 2000)
    return () => { live = false; clearInterval(timer) }
  }, [context().sessionId, taskRevision])
  const question = activeWritingQuestion(task)
  useEffect(()=>{if(command && ['pause','cancel'].includes(command) && task && !['running','queued'].includes(task.status))setCommand(undefined)},[task?.status,command])
  // A running task's elapsed time is shown as it grows; it is telemetry, never a deadline.
  useEffect(() => {
    if (task?.status !== 'running') return
    const started = Date.now(), base = task.elapsedMs
    const timer = window.setInterval(() => setElapsed(base + Date.now() - started), 1000)
    return () => clearInterval(timer)
  }, [task?.status, task?.revision])
  if (!task) return error ? <details className="sf-writing-progress"><summary>历史任务进度暂不可用</summary>{error}</details> : null
  const action = async (name: string) => { if(busy || command)return; setBusy(true); setCommand(name); setError('')
    try { const result = await api('writingTask.action', { context: context(), taskId: task.id, action: name }); setTask(result.task); latest.current.onTask?.(result); await refresh(); if(!result.stopping)setCommand(undefined) }
    catch (error) { setError((error as Error).message);setCommand(undefined) } finally { setBusy(false) }
  }
  const handleIssue = async (issue: WritingTask['issues'][number], op: string) => {
    if (op === 'view-review') { onManage('Review'); return }
    if (['paste-text', 'reconnect-source'].includes(op)) { onManage('Overview'); return }
    if (op === 'answer-materials') { onManage('Research'); return }
    if (['resolve-conflict', 'answer-keep-gap'].includes(op)) { onManage('Draft'); return }
    setBusy(true); setError('')
    try {
      await api('writingTask.issueAction', { context: context(), taskId: task.id, issueId: issue.id, op })
      const result = await api('writingTask.inspect', { context: context() }); setTask(result.task); await refresh()
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  // A task stored before this field existed still has to render, so absence is an empty list.
  const issues = task.issues?.length ? task.issues : mapLegacyNotes(task.notes ?? [], task.updatedAt)
  const { needsAction, inProgress, handled } = groupIssues(issues)
  const main = command==='pause' ? '正在暂停，已请求停止当前生成' : command==='cancel' ? '正在停止，已有正文保留'
    : task.mode==='first-draft' && task.status==='completed' ? (task.outcome==='draft-with-gaps'?'初稿就绪，有待补或待核对内容':'初稿就绪，可选文修改')
    : task.mode==='first-draft' && ['paused','interrupted','cancelled'].includes(task.status) ? (task.status==='cancelled'?'已停止，已有正文保留':'已暂停，可编辑已保存正文')
    : task.status === 'cancelled' ? '旧版写作已停止，已有内容保留'
    : task.status === 'paused' ? '写作已暂停'
    : task.status === 'interrupted' ? '写作进度已保留'
    : task.status === 'waiting-input' && !question ? '进度已保留，可继续'
    : question ? '等待你的决定：已放到中栏底部'
    : task.status === 'completed' ? (needsAction.length ? '生成结束，仍有待处理问题' : '已完成本次可验证检查')
    : STAGES[task.stage]
  return <section className="sf-writing-progress" aria-label="论文写作进度">
    <div className="sf-writing-line">
      <span className={`sf-progress-dot ${task.status === 'running' ? 'sf-progress-working' : ''}`} />
      <strong>{main}</strong>
      {task.mode !== 'first-draft' && <span className="sf-muted">旧任务 · 引导模式</span>}
      <span className="sf-muted">{countsOf(task)}</span>
      <span className="sf-muted sf-progress-elapsed">已用 {formatElapsed(elapsed)} · 调用 {task.usedModelCalls} 次</span>
      <div className="sf-writing-controls">
        {task.status === 'running' || task.status === 'queued' ? <button disabled={busy || !!command} onClick={() => action('pause')}>暂停</button>
          : task.status !== 'completed' && !(task.status === 'cancelled' && task.mode !== 'first-draft') && !question && <button disabled={busy || !!command} onClick={() => action('resume')}>继续</button>}
        {!['completed','cancelled','failed'].includes(task.status) && <button disabled={busy || !!command} onClick={() => action('cancel')}>停止</button>}
        {task.mode!=='first-draft' && !['running','queued','completed'].includes(task.status) && <><button disabled={busy || !!command} onClick={()=>action('start-first-draft')}>按新方式继续初稿</button><span className="sf-muted">所选文件分别保留，缺项待补继续，成稿后修改。</span></>}
        {task.mode==='first-draft' && task.diagnostic?.code==='FIRST_DRAFT_APPROVAL_STALE' && <button disabled={busy || !!command} onClick={()=>action('start-first-draft')}>重新确认当前资料并继续</button>}
        {!!issues.length && <details><summary>详情（{needsAction.length} 项待处理）</summary>
          <div className="sf-issue-popover">
            {!!task.deferredIssues?.length && <details><summary>成稿后处理（{task.deferredIssues.length}）</summary>{task.deferredIssues.map((row,index)=><p key={index}>{row.message}</p>)}</details>}
            <IssueGroup title="需要处理" rows={needsAction} tone="needs" onAction={handleIssue} disabled={busy || task.status === 'running'} />
            <IssueGroup title="继续中" rows={inProgress} tone="working" />
            <IssueGroup title="已处理" rows={handled} tone="done" collapsed />
          </div></details>}
      </div>
    </div>
    {error && <p role="alert" className="sf-error">{error.replace(/^[A-Z_]+:\s*/, '')}</p>}
    {task.mode==='first-draft' && task.diagnostic && <p role="alert" className="sf-error">{task.diagnostic.message} <small>{task.diagnostic.code}</small></p>}
  </section>
}

function IssueGroup({ title, rows, tone, collapsed, onAction, disabled }: { title: string; rows: WritingTask['issues']; tone: string; collapsed?: boolean;
  onAction?: (issue: WritingTask['issues'][number], op: string) => void; disabled?: boolean }) {
  if (!rows.length) return null
  return <details className="sf-issue-group" data-tone={tone} open={!collapsed}>
    <summary>{title}（{rows.length}）</summary>
    {rows.map(issue => <article key={issue.id} className="sf-issue-row">
      <p className="sf-issue-what">{issue.what}{issue.occurrences > 1 ? `（出现 ${issue.occurrences} 次，已合并）` : ''}</p>
      {!!issue.impact && <p className="sf-issue-impact">{issue.impact}</p>}
      {!!issue.actions.length && onAction && <div className="sf-issue-actions">{issue.actions.map(entry => <button key={entry.op} disabled={disabled}
        onClick={() => onAction(issue, entry.op)}>{entry.op === 'paste-text' ? '补充要求文字' : entry.op === 'reconnect-source' ? '管理要求来源' : entry.label}</button>)}</div>}
      {!!issue.detail && <details><summary>技术详情</summary><pre>{issue.detail}</pre></details>}
    </article>)}
  </details>
}

/** Real counts with the right denominator; a folder is never counted as a file. */
function countsOf(task: WritingTask) {
  if (task.stage === 'materials') {
    const paths = writingReadPaths(task.spec)
    const requirements = paths.filter(path => !task.spec.materials.includes(path)).length
    return `已处理 ${task.materialIndex} / ${paths.length} 个文件（要求 ${requirements}，参考材料 ${task.spec.materials.length}）`
  }
  if (task.stage === 'evidence') return `已检查 ${task.evidenceMaterialIndex} 份资料 · 当前第 ${task.evidenceBlockIndex} 个内容单元`
  if (task.stage === 'research') return `已登记 ${task.onlineSources.length} 个来源（不等于已取得全文）`
  if (['drafting', 'review', 'completed'].includes(task.stage)) return `已写入 ${task.sectionIndex} / ${task.spec.sections.length} 节`
  return ''
}
function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

export const PROGRESS_CSS = `.sf-writing-progress{flex:none;border-bottom:1px solid var(--sf-border);padding:var(--sf-space-2) var(--sf-space-5);font-size:var(--sf-font-sm)}
.sf-writing-line{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap}
.sf-progress-dot{width:7px;height:7px;background:var(--sf-ok);border-radius:50%;flex:none}
.sf-progress-working{animation:sf-progress-pulse 1.4s infinite}
.sf-progress-elapsed{font-variant-numeric:tabular-nums}
.sf-progress-note{max-width:760px;margin:var(--sf-space-2) auto 0;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-writing-controls{margin-left:auto;display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap}
.sf-writing-controls button{border:0!important;padding:var(--sf-space-1) var(--sf-space-2)!important;font-size:var(--sf-font-sm)}
.sf-writing-controls details{position:relative}
.sf-issue-popover{position:absolute;right:0;z-index:40;top:var(--sf-space-5);width:400px;max-height:420px;overflow:auto;background:var(--dsw-alias-bg-base,var(--sf-surface));box-shadow:var(--sf-shadow-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-lg);padding:var(--sf-space-3);text-align:left}
.sf-issue-group{margin:0 0 var(--sf-space-2)}
.sf-issue-group>summary{cursor:pointer;font-size:var(--sf-font-sm);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-issue-row{border:1px solid var(--sf-border);border-radius:var(--sf-radius-lg);padding:var(--sf-space-2);margin:var(--sf-space-2) 0}
.sf-issue-group[data-tone=needs] .sf-issue-row{border-color:var(--sf-warn-border);background:var(--sf-warn-soft)}
.sf-issue-group[data-tone=working] .sf-issue-row{border-color:var(--sf-accent-border);background:var(--sf-accent-soft)}
.sf-issue-group[data-tone=done] .sf-issue-row{opacity:var(--sf-disabled-opacity)}
.sf-issue-what{margin:0 0 var(--sf-space-1);font-size:var(--sf-font-sm);line-height:var(--sf-leading-body)}
.sf-issue-impact{margin:0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-issue-actions{display:flex;flex-wrap:wrap;gap:var(--sf-space-2);margin-top:var(--sf-space-2)}
.sf-issue-actions button{font-size:var(--sf-font-xs);padding:var(--sf-space-hair) var(--sf-space-2)!important;border:1px solid var(--sf-border-strong)!important;border-radius:var(--sf-radius-md);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-issue-row pre{margin:var(--sf-space-1) 0 0;padding:var(--sf-space-2);background:var(--sf-fill);border-radius:var(--sf-radius-md);font-size:var(--sf-font-xs);overflow:auto;white-space:pre-wrap}
.sf-cowrite-inline{border:1px solid var(--sf-accent-border);border-radius:var(--sf-radius-lg);margin:var(--sf-space-3);padding:var(--sf-space-3);background:var(--dsw-alias-bg-base,var(--sf-surface));font-size:var(--sf-font-md);max-height:350px;overflow:auto}
.sf-cowrite-inline header{display:flex;align-items:center;gap:var(--sf-space-2)}.sf-cowrite-inline header strong{flex:1}
.sf-cowrite-inline pre{font-family:inherit;font-size:var(--sf-font-md);line-height:var(--sf-leading-prose);margin:var(--sf-space-2) 0;padding:var(--sf-space-2);border-radius:var(--sf-radius-sm)}
.sf-cowrite-before{background:var(--sf-danger-soft);color:var(--sf-danger);white-space:pre-wrap;overflow-wrap:anywhere}
.sf-cowrite-after{background:var(--sf-ok-soft);white-space:pre-wrap;overflow-wrap:anywhere}
.sf-cowrite-bar{display:flex;align-items:center;gap:var(--sf-space-2);padding:var(--sf-space-2) var(--sf-space-4);border-bottom:1px solid var(--sf-border);font-size:var(--sf-font-sm)}
.sf-cowrite-hint{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,var(--sf-text-faint));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-pending-list{max-height:320px;overflow:auto}
.sf-chapter-nav{position:relative}
.sf-chapter-nav>div{position:absolute;z-index:30;left:0;top:var(--sf-space-6);min-width:220px;max-height:320px;overflow:auto;display:flex;flex-direction:column;padding:var(--sf-space-2);background:var(--dsw-alias-bg-base,var(--sf-surface));border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-lg);box-shadow:var(--sf-shadow-2)}
.sf-chapter-nav button{text-align:left;border:0!important;font-size:var(--sf-font-sm);padding:var(--sf-space-2)!important}
@keyframes sf-progress-pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.sf-progress-working{animation:none}}`
