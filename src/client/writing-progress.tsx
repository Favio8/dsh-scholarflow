import React, { useEffect, useState, useRef } from 'react'
import { writingReadPaths, type WritingTask } from '../shared/writing-task.ts'
import { activeWritingQuestion } from './writing-task-ui.ts'
import { groupIssues, mapLegacyNotes } from '../core/pipeline/task-issues.ts'
import {draftChecklist} from './draft-checklist.ts'
import {WorkbenchIcon} from './workbench-chrome.tsx'

const STAGES: Record<string, string> = { materials: '读取工作区资料', research: '检索公开文献', evidence: '整理证据与引用', outline: '规划章节内容', drafting: '撰写正文', review: '检查全文', completed: '初稿已生成' }

/**
 * The compact progress line and the detail list (SPEC v1.2 §7, §9). The question itself lives
 * in the middle column's bottom overlay, so this component never grows a large card that
 * pushes the text down; it reports real counts and keeps technical text one level deeper.
 */
export function WritingProgress({ api, context, refresh, onTask, taskRevision, onManage,project,onRecords,onCheck,variant,enabled=true,visible=true }: any) {
  const [task, setTask] = useState<WritingTask>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [command,setCommand] = useState<string>()
  const latest = useRef({ context, refresh, onTask }); latest.current = { context, refresh, onTask }
  const revision = useRef<number | undefined>(undefined)
  useEffect(() => { if(!enabled||!visible)return;let live = true,timer:number|undefined
    const load = async () => { try { if(document.hidden)return;const result = await api('writingTask.inspect', { context: latest.current.context() }); if (!live) return
      if (revision.current !== result.task?.revision) { revision.current = result.task?.revision; latest.current.refresh().catch((error: Error) => live && setError(error.message)) }
      setTask(result.task); setError(result.taskDiagnostic?.message ?? ''); setElapsed(result.task?.elapsedMs ?? 0); latest.current.onTask?.(result)
    } catch (error) { if (live) setError((error as Error).message) } finally{if(live)timer=window.setTimeout(load,2000)} }
    void load()
    return () => { live = false; clearTimeout(timer) }
  }, [context().sessionId, taskRevision,enabled,visible])
  const question = activeWritingQuestion(task)
  useEffect(()=>{if(command && ['pause','cancel'].includes(command) && task && !['running','queued'].includes(task.status))setCommand(undefined)},[task?.status,command])
  // A running task's elapsed time is shown as it grows; it is telemetry, never a deadline.
  useEffect(() => {
    if (task?.status !== 'running') return
    const started = Date.now(), base = task.elapsedMs
    const timer = window.setInterval(() => setElapsed(base + Date.now() - started), 1000)
    return () => clearInterval(timer)
  }, [task?.status, task?.revision])
  if (!task) return error ? <details className="sf-writing-progress sf-progress-pill"><summary>历史任务进度暂不可用</summary>{error}</details> : null
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
  // v1.20: the progress line and the toolbar share one grid row, so the same report renders as a
  // pill inside the work bar. Only the wrapper changes; polling, actions and the onTask hand-off
  // stay exactly where they were, which is why both shapes keep the .sf-writing-progress class.
  const pill = variant === 'pill'
  // A problem must not hide behind the disclosure: the bar has one line to say it in, so the state
  // itself turns amber and the badge stops being a neutral count.
  const pillBox = (status: string, badge: string, body: React.ReactNode, alert = false) =>
    <section className="sf-writing-progress sf-progress-pill" data-alert={alert || undefined} aria-label="论文写作进度">
      <span className={`sf-progress-dot ${alert?'sf-progress-alert':''}`} /><span className="sf-progress-summary" role="status">{status}</span>
      <details className="sf-progress-details"><summary aria-label="写作进度详情"><WorkbenchIcon kind="down" />{badge}</summary>
        <div className="sf-issue-popover">{body}</div></details>
    </section>
  if(task.mode==='first-draft'){
    const running=['running','queued'].includes(task.status),complete=task.status==='completed',checks=complete?draftChecklist(task,project):[]
    const section=task.spec.sections[task.sectionIndex]
    const status=command==='pause'?'正在暂停…':command==='cancel'?'正在停止…':complete?'初稿已生成':running?STAGES[task.stage]:task.status==='cancelled'?'写作已停止':'写作已暂停'
    const notes=<>{running&&<span className="sf-muted">{task.stage==='drafting'&&section?`${section.title} · `:''}{countsOf(task)}</span>}
      {complete&&<span className="sf-muted">{task.sectionIndex} / {task.spec.sections.length} 节</span>}</>
    const controls=<div className="sf-writing-controls">{running?<><button disabled={busy||!!command} onClick={()=>action('pause')}>暂停</button><button disabled={busy||!!command} onClick={()=>action('cancel')}>停止</button></>
        :!complete&&<button disabled={busy||!!command} onClick={()=>action(task.diagnostic?.code==='FIRST_DRAFT_APPROVAL_STALE'?'start-first-draft':'resume')}>继续生成</button>}
        {complete&&<details className="sf-review-checklist"><summary><WorkbenchIcon kind="down" />{checks.length?`核对清单 · ${checks.length} 项`:'核对与修改'}</summary><div className="sf-issue-popover">
          <header><strong>初稿核对</strong><button onClick={()=>onManage('Review')}>检查全文</button></header>
          {!checks.length&&<p className="sf-muted">可通读初稿，选中文字让 AI 修改。</p>}
          {checks.map(row=><article key={row.key} className="sf-checklist-row"><strong>{row.title}</strong><p>{row.detail}</p><button onClick={()=>onCheck?onCheck(row):onManage(row.page)}>查看{row.page==='Research'?'资料与引用':row.page==='Review'?'对应问题':row.page==='Overview'?'写作要求':'正文'}</button></article>)}
        </div></details>}
        {!running&&onRecords&&<button className="sf-ghost" onClick={onRecords}>运行记录</button>}
      </div>
    const reports=<>{!complete&&task.diagnostic&&<p role="alert" className="sf-error">{task.diagnostic.message}</p>}
      {error&&<p role="alert" className="sf-error">{error.replace(/^[A-Z_]+:\s*/,'')}</p>}</>
    const alert=!!error||(!complete&&!!task.diagnostic)
    if(pill) return pillBox(status, alert?'需处理':complete&&checks.length?`核对 ${checks.length} 项`:'详情', <>{notes}{controls}{reports}</>, alert)
    return <section className="sf-writing-progress" aria-label="论文写作进度"><div className="sf-writing-line">
      <span className={`sf-progress-dot ${running?'sf-progress-working':''}`} />
      <strong>{status}</strong>
      {notes}{controls}
    </div>{reports}
    </section>
  }
  const main = command==='pause' ? '正在暂停，已请求停止当前生成' : command==='cancel' ? '正在停止，已有正文保留'


    : task.status === 'cancelled' ? '旧版写作已停止，已有内容保留'
    : task.status === 'paused' ? '写作已暂停'
    : task.status === 'interrupted' ? '写作进度已保留'
    : task.status === 'waiting-input' && !question ? '进度已保留，可继续'
    : question ? '等待你的决定：已放到中栏底部'
    : task.status === 'completed' ? (needsAction.length ? '生成结束，仍有待处理问题' : '已完成本次可验证检查')
    : STAGES[task.stage]
  const notes=<><span className="sf-muted">引导模式</span>
    <span className="sf-muted">{countsOf(task)}</span>
    <span className="sf-muted sf-progress-elapsed">已用 {formatElapsed(elapsed)} · 调用 {task.usedModelCalls} 次</span></>
  const controls=<div className="sf-writing-controls">
      {task.status === 'running' || task.status === 'queued' ? <button disabled={busy || !!command} onClick={() => action('pause')}>暂停</button>
        : task.status !== 'completed' && task.status !== 'cancelled' && !question && <button disabled={busy || !!command} onClick={() => action('resume')}>继续</button>}
      {!['completed','cancelled','failed'].includes(task.status) && <button disabled={busy || !!command} onClick={() => action('cancel')}>停止</button>}
      {!['running','queued','completed'].includes(task.status) && <><button disabled={busy || !!command} onClick={()=>action('start-first-draft')}>按新方式继续初稿</button><span className="sf-muted">所选文件分别保留，缺项待补继续，成稿后修改。</span></>}
      {!!issues.length && <details><summary>详情（{needsAction.length} 项待处理）</summary>
        <div className="sf-issue-popover">
          {!!task.deferredIssues?.length && <details><summary>成稿后处理（{task.deferredIssues.length}）</summary>{task.deferredIssues.map((row,index)=><p key={index}>{row.message}</p>)}</details>}
          <IssueGroup title="需要处理" rows={needsAction} tone="needs" onAction={handleIssue} disabled={busy || task.status === 'running'} />
          <IssueGroup title="继续中" rows={inProgress} tone="working" />
          <IssueGroup title="已处理" rows={handled} tone="done" collapsed />
        </div></details>}
    </div>
  const reports=<>{error && <p role="alert" className="sf-error">{error.replace(/^[A-Z_]+:\s*/, '')}</p>}</>
  if(pill) return pillBox(main, error?'需处理':needsAction.length?`${needsAction.length} 项待处理`:issues.length?`${issues.length} 项`:'详情',
    <>{notes}{controls}{reports}</>, !!error||!!needsAction.length)
  return <section className="sf-writing-progress" aria-label="论文写作进度">
    <div className="sf-writing-line">
      <span className={`sf-progress-dot ${task.status === 'running' ? 'sf-progress-working' : ''}`} />
      <strong>{main}</strong>
      {notes}{controls}
    </div>{reports}
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

export const PROGRESS_CSS = `/* Status band: tint, no rule. A hairline under every running status stacks with the
   header and toolbar rules into stripes, and the progress line is the least structural of them. */
.sf-writing-progress{flex:none;padding:var(--sf-space-1) var(--sf-space-4);font-size:var(--sf-font-sm);background:var(--sf-plane-1)}
.sf-writing-line{display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap}
.sf-progress-dot{width:7px;height:7px;background:var(--sf-ok);border-radius:50%;flex:none}
.sf-progress-working{animation:sf-progress-pulse 1.4s infinite}
.sf-progress-elapsed{font-variant-numeric:tabular-nums}
.sf-progress-note{max-width:760px;margin:var(--sf-space-2) auto 0;font-size:var(--sf-font-sm);color:var(--sf-muted)}
.sf-writing-controls{margin-left:auto;display:flex;align-items:center;gap:var(--sf-space-2);flex-wrap:wrap}
.sf-writing-controls button{border:0!important;padding:0 var(--sf-space-2);font-size:var(--sf-font-sm)}
.sf-writing-controls details{position:relative}
.sf-issue-popover{position:absolute;right:0;z-index:40;top:var(--sf-space-5);width:min(400px,calc(100vw - 48px));max-height:420px;overflow:auto;background:var(--sf-surface);box-shadow:var(--sf-shadow-2);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-lg);padding:var(--sf-space-3);text-align:left}
/* v1.20: the pill carries every action inside one popover. A nested popover would float over the
   panel that already opened it, so a popover inside a popover returns to the normal flow. */
.sf-issue-popover .sf-issue-popover{position:static;width:auto;max-height:none;box-shadow:none;border:0;padding:var(--sf-space-2) 0 0}
.sf-issue-popover .sf-writing-controls{margin-left:0;justify-content:flex-start}
.sf-review-checklist>summary{display:flex;align-items:center;gap:var(--sf-space-1);cursor:pointer;list-style:none;color:var(--sf-accent-text)}.sf-review-checklist>summary::-webkit-details-marker{display:none}.sf-review-checklist[open]>summary>svg{transform:rotate(180deg)}
.sf-issue-popover>header{display:flex;justify-content:space-between;align-items:center;padding:var(--sf-space-2) 0}.sf-checklist-row{padding:var(--sf-space-3) 0;border-top:1px solid var(--sf-border-soft)}.sf-checklist-row>p{margin:var(--sf-space-1) 0;color:var(--sf-muted);line-height:var(--sf-leading-body)}
.sf-issue-group{margin:0 0 var(--sf-space-2)}
.sf-issue-group>summary{cursor:pointer;font-size:var(--sf-font-sm);color:var(--sf-muted)}
/* Groups are separated by space and a weight change on their own heading. With the row borders
   gone, a rule here would be the only line in the popover, which is what a group boundary wants. */
.sf-issue-group+.sf-issue-group{border-top:1px solid var(--sf-border-soft);padding-top:var(--sf-space-2)}
/* An issue is a paragraph, not a card. Each row used to draw its own border inside a bordered
   popover, so eleven issues read as eleven stacked stickers; the tone tint alone separates a
   row from the group it sits in. */
.sf-issue-row{border:0;border-radius:var(--sf-radius-lg);padding:var(--sf-space-2) var(--sf-space-3);margin:var(--sf-space-2) 0}
.sf-issue-group[data-tone=needs] .sf-issue-row{background:var(--sf-warn-soft)}
.sf-issue-group[data-tone=working] .sf-issue-row{background:var(--sf-accent-soft)}
.sf-issue-group[data-tone=done] .sf-issue-row{opacity:var(--sf-disabled-opacity);padding-top:0;padding-bottom:0;margin:0}
.sf-issue-what{margin:0 0 var(--sf-space-1);font-size:var(--sf-font-sm);line-height:var(--sf-leading-body)}
.sf-issue-impact{margin:0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-body);color:var(--sf-muted)}
.sf-issue-actions{display:flex;flex-wrap:wrap;gap:var(--sf-space-2);margin-top:var(--sf-space-2)}
.sf-issue-actions button{font-size:var(--sf-font-xs);padding:0 var(--sf-space-2);border:0!important;border-radius:var(--sf-radius-md);color:var(--sf-muted);background:var(--sf-fill-strong)}
.sf-issue-row pre{margin:var(--sf-space-1) 0 0;padding:var(--sf-space-2);background:var(--sf-fill);border-radius:var(--sf-radius-md);font-size:var(--sf-font-xs);overflow:auto;white-space:pre-wrap}
.sf-cowrite-inline{border:1px solid var(--sf-accent-border);border-radius:var(--sf-radius-lg);margin:var(--sf-space-3);padding:var(--sf-space-3);background:var(--sf-surface);font-size:var(--sf-font-md);max-height:350px;overflow:auto}
.sf-cowrite-inline header{display:flex;align-items:center;gap:var(--sf-space-2)}.sf-cowrite-inline header strong{flex:1}
.sf-cowrite-inline pre{font-family:inherit;font-size:var(--sf-font-md);line-height:var(--sf-leading-prose);margin:var(--sf-space-2) 0;padding:var(--sf-space-2);border-radius:var(--sf-radius-sm)}
.sf-cowrite-before{background:var(--sf-danger-soft);color:var(--sf-danger);white-space:pre-wrap;overflow-wrap:anywhere}
.sf-cowrite-after{background:var(--sf-ok-soft);white-space:pre-wrap;overflow-wrap:anywhere}
.sf-cowrite-hint{flex:1;min-width:0;color:var(--sf-text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-pending-list{max-height:320px;overflow:auto}
/* The pill. It sits in the work bar's grid row, so its job is to report the run without asking
   for a band of its own; everything actionable waits one click away, behind the caret. */
.sf-progress-pill{display:flex;align-items:center;gap:var(--sf-space-2);padding:0 var(--sf-space-1);background:transparent;font-size:var(--sf-font-sm);white-space:nowrap}
.sf-progress-pill .sf-progress-summary{overflow:hidden;text-overflow:ellipsis;max-width:20ch}
.sf-progress-pill .sf-writing-line,.sf-progress-pill .sf-muted{flex-wrap:wrap}
.sf-progress-details{position:relative}
.sf-progress-details>summary{display:flex;align-items:center;gap:var(--sf-space-1);cursor:pointer;list-style:none;color:var(--sf-accent-text);padding:0 var(--sf-space-1)}
.sf-progress-details>summary::-webkit-details-marker{display:none}
.sf-progress-details[open]>summary>svg{transform:rotate(180deg)}
/* The pill sits at the right edge of the work bar, so its panel grows leftwards from the caret.
   Anchored the other way it ran 300px past the viewport and took its own buttons with it. */
.sf-progress-details>.sf-issue-popover{top:calc(100% + var(--sf-space-2));right:0;left:auto}
.sf-progress-pill[data-alert] .sf-progress-summary{color:var(--sf-warn-text);font-weight:600}
.sf-progress-pill[data-alert] .sf-progress-details>summary{color:var(--sf-warn-text);font-weight:600}
.sf-progress-alert{background:var(--sf-warn)!important;animation:sf-progress-pulse 1.4s infinite}
.sf-progress-details .sf-progress-summary,.sf-progress-details .sf-writing-line{display:flex}
.sf-progress-details .sf-writing-line{margin-bottom:var(--sf-space-2)}
@container sf-workbench (max-width:850px){.sf-progress-pill .sf-progress-summary{max-width:12ch}}
.sf-chapter-nav{position:relative}
.sf-chapter-nav>div{position:absolute;z-index:30;left:0;top:var(--sf-space-6);min-width:220px;max-height:320px;overflow:auto;display:flex;flex-direction:column;padding:var(--sf-space-2);background:var(--sf-surface);border:1px solid var(--sf-border-strong);border-radius:var(--sf-radius-lg);box-shadow:var(--sf-shadow-2)}
.sf-chapter-nav button{text-align:left;border:0!important;font-size:var(--sf-font-sm);padding:var(--sf-space-2)}
@keyframes sf-progress-pulse{50%{opacity:.35}}
@media(prefers-reduced-motion:reduce){.sf-progress-working{animation:none}}`
