import React, { useEffect, useState } from 'react'
import { presetSections, type CreationSpec } from '../shared/writing-task.ts'
import { FORMAT_LABELS, TYPE_LABELS } from './paper-workspace.tsx'
import { requirementsFallback } from '../core/pipeline/requirements-fallback.ts'
import { ErrorNotice } from './application-error.tsx'

export function WritingRequirements({ project, api, context, refresh, onFormat }: any) {
  const [spec, setSpec] = useState<ReturnType<typeof requirementsFallback>>(), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [error, setError] = useState<Error>()
  const [baseSpecHash, setBaseSpecHash] = useState<string | null>()
  const [savedVersion, setSavedVersion] = useState<{ spec: CreationSpec; baseSpecHash: string | null }>()
  useEffect(() => { let live = true
    api('writingTask.requirements', { context: context() }).then((result: any) => { if (live) {
      setSpec(result.spec ?? requirementsFallback(project)); setBaseSpecHash(result.baseSpecHash); setError(undefined)
    } }).catch((error: Error) => live && setError(error))
    return () => { live = false }
  }, [project.binding.projectId])
  if (!spec) return error ? <ErrorNotice error={error} /> : <p>正在读取写作要求…</p>
  const update = (value: Partial<CreationSpec>) => { setSpec({ ...spec, ...value }); setError(undefined); setMessage('') }
  return <section className="sf-wizard sf-requirements-panel"><h2>写作要求</h2><label>论文标题<input value={spec.title} onChange={e => update({ title: e.target.value })} /></label>
    <div className="sf-wizard-row"><label>论文类型<select value={spec.type} onChange={e => update({ type: e.target.value as CreationSpec['type'] })}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>语言<select value={spec.language} onChange={e => update({ language: e.target.value as CreationSpec['language'] })}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
      <label>提交格式<select value={spec.format} onChange={e => update({ format: e.target.value as CreationSpec['format'] })}>{Object.entries(FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <label>写作要求<textarea rows={8} value={spec.requirements} onChange={e => update({ requirements: e.target.value })} /></label>
    <label>目标篇幅<input type="number" min={200} max={60000} value={spec.targetLength ?? ''} placeholder="原项目未记录篇幅" onChange={e => update({ targetLength: Number(e.target.value) })} /></label>
    {!spec.sections.length && <button disabled={!spec.targetLength || spec.targetLength < 200} onClick={() => update({ sections: presetSections(spec.type, spec.targetLength!) })}>添加章节结构</button>}
    {spec.cover?.enabled && <fieldset><legend>封面</legend>
      <label>封面标题<input value={spec.cover.title} onChange={event => update({ cover: { ...spec.cover!, title: event.target.value } })} /></label>
      {spec.cover.fields.map((field, index) => <label key={index}>{field.label}<input value={field.value} onChange={event => update({ cover: {
        ...spec.cover!, fields: spec.cover!.fields.map((row, at) => at === index ? { ...row, value: event.target.value } : row) } })} /></label>)}
    </fieldset>}
    <button className="sf-primary" disabled={busy || !spec.title.trim() || !spec.requirements.trim()} onClick={async () => { setBusy(true); setMessage(''); setError(undefined)
      try { const saved = await api('writingTask.preferences', { context: context(), spec, baseSpecHash }); setBaseSpecHash(saved.baseSpecHash); onFormat(spec.format); await refresh(); setMessage('已保存写作要求。') }
      catch (error) { setError(error as Error) } finally { setBusy(false) }
    }}>保存要求</button><p role="status">{message}</p><ErrorNotice error={error} />
    {error && <button onClick={async () => { try {
      const loaded = await api('writingTask.requirements', { context: context() })
      if (loaded.spec) setSavedVersion(loaded)
    } catch (failure) { setError(failure as Error) } }}>查看已保存版本</button>}
    {savedVersion && <details open><summary>已保存的写作要求</summary><p>{savedVersion.spec.title} · {savedVersion.spec.targetLength} · {FORMAT_LABELS[savedVersion.spec.format]}</p><pre>{savedVersion.spec.requirements}</pre>
      <button onClick={() => { setSpec(savedVersion.spec); setBaseSpecHash(savedVersion.baseSpecHash); setSavedVersion(undefined); setError(undefined) }}>使用已保存版本</button></details>}
  </section>
}
