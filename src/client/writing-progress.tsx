import React, { useEffect, useState, useRef } from 'react'
import type { WritingTask } from '../shared/writing-task.ts'
import { groupIssues, mapLegacyNotes } from '../core/pipeline/task-issues.ts'

const STAGES: Record<string, string> = { materials: '读取工作区资料', research: '检索公开文献', evidence: '整理证据与引用', outline: '规划章节内容', drafting: '撰写正文', review: '检查全文', completed: '初稿已生成' }

/**
 * The compact progress line and the detail list (SPEC v1.2 §7, §9). The question itself lives
 * in the middle column's bottom overlay, so this component never grows a large card that
 * pushes the text down; it reports real counts and keeps technical text one level deeper.
 */
export function WritingProgress({ api, context, refresh, onTask, taskRevision }: any) {
  const [task, setTask] = useState<WritingTask>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const latest = useRef({ context, refresh, onTask }); latest.current = { context, refresh, onTask }
  const revision = useRef<number | undefined>(undefined)
  useEffect(() => { let live = true
    const load = async () => { try { const result = await api('writingTask.inspect', { context: latest.current.context() }); if (!live) return
      if (revision.current !== result.task?.revision) { revision.current = result.task?.revision; latest.current.refresh().catch((error: Error) => live && setError(error.message)) }
      setTask(result.task); setElapsed(result.task?.elapsedMs ?? 0); latest.current.onTask?.(result)
    } catch (error) { if (live) setError((error as Error).message) } }
    load(); const timer = window.setInterval(load, 2000)
    return () => { live = false; clearInterval(timer) }
  }, [context().sessionId, taskRevision])
  const question = task?.questions.find(row => row.answered === undefined)
  // A running task's elapsed time is shown as it grows; it is telemetry, never a deadline.
  useEffect(() => {
    if (task?.status !== 'running') return
    const started = Date.now(), base = task.elapsedMs
    const timer = window.setInterval(() => setElapsed(base + Date.now() - started), 1000)
    return () => clearInterval(timer)
  }, [task?.status, task?.revision])
  if (!task || task.status === 'cancelled') return null
  const action = async (name: string) => { setBusy(true); setError('')
    try { const result = await api('writingTask.action', { context: context(), taskId: task.id, action: name }); setTask(result.task); await refresh() }
    catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  const issues = task.issues.length ? task.issues : mapLegacyNotes(task.notes, task.updatedAt)
  const { needsAction, inProgress, handled } = groupIssues(issues)
  const main = task.status === 'paused' ? '写作已暂停'
    : task.status === 'interrupted' ? '写作进度已保留'
    : question ? '等待你的决定：已放到中栏底部'
    : task.status === 'completed' ? (needsAction.length ? '生成结束，仍有待处理问题' : '已完成本次可验证检查')
    : STAGES[task.stage]
  return <section className="sf-writing-progress" aria-label="论文写作进度">
    <div className="sf-writing-line">
      <span className={`sf-progress-dot ${task.status === 'running' ? 'sf-progress-working' : ''}`} />
      <strong>{main}</strong>
      <span className="sf-muted">{countsOf(task)}</span>
      <span className="sf-muted sf-progress-elapsed">已用 {formatElapsed(elapsed)} · 调用 {task.usedModelCalls} 次</span>
      <div className="sf-writing-controls">
        {task.status === 'running' || task.status === 'queued' ? <button disabled={busy} onClick={() => action('pause')}>暂停</button>
          : task.status !== 'completed' && !question && <button disabled={busy} onClick={() => action('resume')}>继续</button>}
        {task.status !== 'completed' && <button disabled={busy} onClick={() => action('cancel')}>停止</button>}
        {!!issues.length && <details><summary>详情（{needsAction.length} 项待处理）</summary>
          <div className="sf-issue-popover">
            <IssueGroup title="需要处理" rows={needsAction} tone="needs" />
            <IssueGroup title="继续中" rows={inProgress} tone="working" />
            <IssueGroup title="已处理" rows={handled} tone="done" collapsed />
          </div></details>}
      </div>
    </div>
    {task.status === 'completed' && <p className="sf-progress-note" role="status">
      执行结束、内容检查结果和导出状态分别报告；「已完成本次可验证检查」不代表老师认可或引用已全部人工核验。</p>}
    {error && <p role="alert" className="sf-error">{error.replace(/^[A-Z_]+:\s*/, '')}</p>}
  </section>
}

function IssueGroup({ title, rows, tone, collapsed }: { title: string; rows: WritingTask['issues']; tone: string; collapsed?: boolean }) {
  if (!rows.length) return null
  return <details className="sf-issue-group" data-tone={tone} open={!collapsed}>
    <summary>{title}（{rows.length}）</summary>
    {rows.map(issue => <article key={issue.id} className="sf-issue-row">
      <p className="sf-issue-what">{issue.what}{issue.occurrences > 1 ? `（出现 ${issue.occurrences} 次，已合并）` : ''}</p>
      {!!issue.impact && <p className="sf-issue-impact">{issue.impact}</p>}
      {!!issue.actions.length && <div className="sf-issue-actions">{issue.actions.map(entry => <span key={entry.op}>{entry.label}</span>)}</div>}
      {!!issue.detail && <details><summary>技术详情</summary><pre>{issue.detail}</pre></details>}
    </article>)}
  </details>
}

/** Real counts with the right denominator; a folder is never counted as a file. */
function countsOf(task: WritingTask) {
  if (task.stage === 'materials') return `已读取 ${Math.min(task.materialIndex, task.spec.materials.length)} / ${task.spec.materials.length} 份参考材料`
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

export const PROGRESS_CSS = `.sf-writing-progress{flex:none;border-bottom:1px solid #8882;padding:9px 22px;font-size:12px}
.sf-writing-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sf-progress-dot{width:7px;height:7px;background:#4f9d73;border-radius:50%;flex:none}
.sf-progress-working{animation:sf-progress-pulse 1.4s infinite}
.sf-progress-elapsed{font-variant-numeric:tabular-nums}
.sf-progress-note{max-width:760px;margin:8px auto 0;font-size:12px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-writing-controls{margin-left:auto;display:flex;align-items:center;gap:8px}
.sf-writing-controls button{border:0!important;padding:4px 6px!important;font-size:12px}
.sf-writing-controls details{position:relative}
.sf-issue-popover{position:absolute;right:0;z-index:40;top:24px;width:400px;max-height:420px;overflow:auto;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 5px 18px #0002;border:1px solid #8883;border-radius:8px;padding:12px;text-align:left}
.sf-issue-group{margin:0 0 10px}
.sf-issue-group>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-issue-row{border:1px solid #8882;border-radius:8px;padding:9px 10px;margin:7px 0}
.sf-issue-group[data-tone=needs] .sf-issue-row{border-color:#e8a33d55;background:#e8a33d0f}
.sf-issue-group[data-tone=working] .sf-issue-row{border-color:#4475e755;background:#4475e70d}
.sf-issue-group[data-tone=done] .sf-issue-row{opacity:.75}
.sf-issue-what{margin:0 0 4px;font-size:12.5px;line-height:1.6}
.sf-issue-impact{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#727780)}
.sf-issue-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.sf-issue-actions span{font-size:11.5px;padding:2px 7px;border:1px solid #8884;border-radius:6px;color:var(--dsw-alias-label-secondary,#727780)}
.sf-issue-row pre{margin:6px 0 0;padding:7px;background:#88808;border-radius:6px;font-size:11px;overflow:auto;white-space:pre-wrap}
.sf-cowrite-inline{border:1px solid #4475e730;border-radius:10px;margin:12px;padding:12px;background:var(--dsw-alias-bg-base,#fff);font-size:13px;max-height:350px;overflow:auto}
.sf-cowrite-inline header{display:flex;align-items:center;gap:10px}.sf-cowrite-inline header strong{flex:1}
.sf-cowrite-inline pre{font-family:inherit;font-size:13px;line-height:1.7;margin:8px 0;padding:10px;border-radius:5px}
.sf-cowrite-before{background:#d451510a;color:#aa4343;white-space:pre-wrap;overflow-wrap:anywhere}
.sf-cowrite-after{background:#3ca36f0a;white-space:pre-wrap;overflow-wrap:anywhere}
.sf-cowrite-bar{display:flex;align-items:center;gap:10px;padding:7px 15px;border-bottom:1px solid #8882;font-size:12px}
.sf-cowrite-hint{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#8b9099);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-pending-list{max-height:320px;overflow:auto}
.sf-chapter-nav{position:relative}
.sf-chapter-nav>div{position:absolute;z-index:30;left:0;top:28px;min-width:220px;max-height:320px;overflow:auto;display:flex;flex-direction:column;padding:8px;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8883;border-radius:8px;box-shadow:0 6px 20px #0001}
.sf-chapter-nav button{text-align:left;border:0!important;font-size:12px;padding:7px!important}
@keyframes sf-progress-pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.sf-progress-working{animation:none}}`
