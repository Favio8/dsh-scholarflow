import React, { useEffect, useState, useRef } from 'react'
import type { WritingTask } from '../shared/writing-task.ts'

const STAGES: Record<string, string> = { materials: '读取工作区资料', research: '检索公开文献', evidence: '整理证据与引用', outline: '规划章节内容', drafting: '撰写正文', review: '检查全文', completed: '初稿已生成' }
export function WritingProgress({ api, context, refresh, onTask, taskRevision }: any) {
  const [task, setTask] = useState<WritingTask>(), [answer, setAnswer] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [materialFiles, setMaterialFiles] = useState<any[]>([]), [selectedMaterials, setSelectedMaterials] = useState<string[]>([])
  const latest = useRef({ context, refresh, onTask }); latest.current = { context, refresh, onTask }
  const revision = useRef<number | undefined>(undefined)
  useEffect(() => { let live = true
    const load = async () => { try { const result = await api('writingTask.inspect', { context: latest.current.context() }); if (!live) return
      if (revision.current !== result.task?.revision) { revision.current = result.task?.revision; latest.current.refresh().catch((error: Error) => live && setError(error.message)) }
      setTask(result.task); latest.current.onTask?.(result)
    } catch (error) { if (live) setError((error as Error).message) } }
    load(); const timer = window.setInterval(load, 2000)
    return () => { live = false; clearInterval(timer) }
  }, [context().sessionId, taskRevision])
  const question = task?.questions.find(row => row.answered === undefined)
  useEffect(() => { setAnswer('')
    if (question?.kind !== 'materials') return
    let live = true; setSelectedMaterials(task?.spec.materials ?? [])
    api('creation.materials', { context: latest.current.context() }).then((result: any) => live && setMaterialFiles(result.files.filter((row: any) => row.supported))).catch((error: Error) => live && setError(error.message))
    return () => { live = false }
  }, [question?.id])
  if (!task || task.status === 'cancelled') return null
  const action = async (name: string, value?: string) => { setBusy(true); setError('')
    try { const result = await api('writingTask.action', { context: context(), taskId: task.id, action: name, ...(name === 'answer' && { questionId: question?.id, answer: value ?? answer, ...(question?.kind === 'materials' && { materials: selectedMaterials }) }) }); setTask(result.task); await refresh() }
    catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <section className="sf-writing-progress" aria-label="论文写作进度">
    <div className="sf-writing-line"><span className={`sf-progress-dot ${task.status === 'running' ? 'sf-progress-working' : ''}`} /><strong>{task.status === 'paused' ? '写作已暂停' : task.status === 'interrupted' ? '写作进度已保留' : question ? '需要你的决定' : STAGES[task.stage]}</strong>
      <span className="sf-muted">{task.stage === 'evidence' ? `已检查 ${task.evidenceMaterialIndex} 份资料 · 当前 ${task.evidenceBlockIndex} 个内容单元` : task.stage === 'materials' ? `已处理 ${Math.min(task.materialIndex, task.spec.materials.length)} / ${task.spec.materials.length} 份资料` : task.stage === 'drafting' || task.stage === 'review' || task.stage === 'completed' ? `已完成 ${task.sectionIndex} / ${task.spec.sections.length} 节` : task.stage === 'research' ? `已取得 ${task.onlineSources.length} 份公开全文` : ''}</span>
      <div className="sf-writing-controls">{task.status === 'running' || task.status === 'queued' ? <button disabled={busy} onClick={() => action('pause')}>暂停</button> : task.status !== 'completed' && !question && <button disabled={busy} onClick={() => action('resume')}>继续</button>}
        {task.status !== 'completed' && <button disabled={busy} onClick={() => action('cancel')}>取消</button>}
        {!!task.notes.length && <details><summary>详情</summary><div>{task.notes.map((note, index) => <p key={index}>{note}</p>)}</div></details>}</div>
    </div>
    {question && <div className="sf-writing-question" key={question.id}><h3>{question.title}</h3>{question.kind === 'materials' && <details><summary>选择补充资料</summary><div className="sf-material-checklist">{materialFiles.map(row => <label key={row.relativePath}><input type="checkbox" checked={selectedMaterials.includes(row.relativePath)} onChange={e => setSelectedMaterials(e.target.checked ? [...selectedMaterials, row.relativePath] : selectedMaterials.filter(path => path !== row.relativePath))} /><span>{row.relativePath}</span></label>)}</div></details>}<div className="sf-question-options">{question.options.map(option => <button key={option} disabled={busy} onClick={() => action('answer', option)}>{option}</button>)}</div>
      <div className="sf-question-input"><textarea aria-label="回答写作问题" rows={2} placeholder="也可以补充你的要求…" value={answer} onChange={e => setAnswer(e.target.value)} /><button className="sf-primary" disabled={busy || !answer.trim()} onClick={() => action('answer')}>回答并继续</button></div></div>}
    {error && <p role="alert" className="sf-error">{error.replace(/^[A-Z_]+:\s*/, '')}</p>}
  </section>
}
export const PROGRESS_CSS = `.sf-writing-progress{flex:none;border-bottom:1px solid #8882;padding:9px 22px;font-size:12px}.sf-writing-line{display:flex;align-items:center;gap:10px}.sf-progress-dot{width:7px;height:7px;background:#4f9d73;border-radius:50%;flex:none}.sf-progress-working{animation:sf-progress-pulse 1.4s infinite}.sf-writing-controls{margin-left:auto;display:flex;align-items:center;gap:8px}.sf-writing-controls button{border:0!important;padding:4px 6px!important;font-size:12px}.sf-writing-controls details{position:relative}.sf-writing-controls details>div{position:absolute;right:0;z-index:40;top:24px;width:360px;max-height:260px;overflow:auto;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 5px 18px #0002;border:1px solid #8883;border-radius:8px;padding:12px}.sf-writing-question{max-width:760px;margin:12px auto;padding:18px;border:1px solid #4475e730;border-radius:12px;background:#4475e705}.sf-writing-question h3{font-size:15px;margin:0 0 12px;line-height:1.7}.sf-question-options{display:flex;flex-wrap:wrap;gap:8px}.sf-question-input{display:flex;align-items:flex-end;gap:10px;margin-top:12px}.sf-question-input textarea{flex:1;font-size:13px!important}.sf-question-input button{flex:none}.sf-cowrite-inline{border:1px solid #4475e730;border-radius:10px;margin:12px;padding:12px;background:var(--dsw-alias-bg-base,#fff);font-size:13px;max-height:350px;overflow:auto}.sf-cowrite-inline header{display:flex;align-items:center;gap:10px}.sf-cowrite-inline header strong{flex:1}.sf-cowrite-inline pre{font-family:inherit;font-size:13px;line-height:1.7;margin:8px 0;padding:10px;border-radius:5px}.sf-cowrite-before{background:#d451510a;color:#aa4343;white-space:pre-wrap;overflow-wrap:anywhere}.sf-cowrite-after{background:#3ca36f0a;white-space:pre-wrap;overflow-wrap:anywhere}.sf-cowrite-bar{display:flex;align-items:center;gap:8px;padding:7px 15px;border-bottom:1px solid #8882;font-size:12px}.sf-cowrite-bar input{flex:1;padding:6px 9px;border:1px solid #8883;border-radius:6px;background:transparent;color:inherit}.sf-chapter-nav{position:relative;margin-right:auto}.sf-chapter-nav>div{position:absolute;z-index:30;left:0;top:28px;min-width:220px;max-height:320px;overflow:auto;display:flex;flex-direction:column;padding:8px;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8883;border-radius:8px;box-shadow:0 6px 20px #0001}.sf-chapter-nav button{text-align:left;border:0!important;font-size:12px;padding:7px!important}@keyframes sf-progress-pulse{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.sf-progress-working{animation:none}}`
