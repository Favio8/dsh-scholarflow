import React, { useEffect, useState } from 'react'
import { presetSections, type CreationSpec } from '../shared/writing-task.ts'
import { FORMAT_LABELS, TYPE_LABELS } from './paper-workspace.tsx'

export function WritingRequirements({ project, api, context, refresh, onFormat }: any) {
  const [spec, setSpec] = useState<CreationSpec>(), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => { let live = true
    api('writingTask.inspect', { context: context() }).then((result: any) => { if (live) setSpec(result.spec ?? {
      ...project.config.project, format: project.config.output.defaultFormat ?? 'markdown', requirements: Object.values(project.ledger.requirements).map((row: any) => row.description).join('\n') || '完善当前论文。',
      materials: project.config.materials.include, online: false, targetLength: 4000, sections: presetSections(project.config.project.type, 4000), manuscriptDir: project.config.paths.manuscriptDir,
    }) }).catch((error: Error) => live && setMessage(error.message))
    return () => { live = false }
  }, [project.binding.projectId])
  if (!spec) return <p>{message || '正在读取写作要求…'}</p>
  const update = (value: Partial<CreationSpec>) => setSpec({ ...spec, ...value })
  return <section className="sf-wizard sf-requirements-panel"><h2>写作要求</h2><label>论文标题<input value={spec.title} onChange={e => update({ title: e.target.value })} /></label>
    <div className="sf-wizard-row"><label>论文类型<select value={spec.type} onChange={e => update({ type: e.target.value as CreationSpec['type'] })}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>语言<select value={spec.language} onChange={e => update({ language: e.target.value as CreationSpec['language'] })}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
      <label>提交格式<select value={spec.format} onChange={e => update({ format: e.target.value as CreationSpec['format'] })}>{Object.entries(FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <label>写作要求<textarea rows={8} value={spec.requirements} onChange={e => update({ requirements: e.target.value })} /></label>
    <label>目标篇幅<input type="number" min={200} max={60000} value={spec.targetLength} onChange={e => update({ targetLength: Number(e.target.value) })} /></label>
    <button className="sf-primary" disabled={busy || !spec.title.trim() || !spec.requirements.trim()} onClick={async () => { setBusy(true); setMessage('')
      try { await api('writingTask.preferences', { context: context(), spec }); onFormat(spec.format); await refresh(); setMessage('已保存写作要求。') }
      catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
    }}>保存要求</button><p role="status">{message}</p>
  </section>
}
