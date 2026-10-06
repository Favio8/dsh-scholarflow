import React, { useEffect, useState } from 'react'
import { creationSpec, presetSections, type CreationSpec } from '../shared/writing-task.ts'
import { FORMAT_LABELS, TYPE_LABELS } from './paper-workspace.tsx'

export function CreationWizard({ scope, api, context, onCreated, workspaceTitle, defaults }: any) {
  const key = `scholarflow:creation:${scope}`
  const initial: CreationSpec = { title: '', type: defaults?.defaultProjectType ?? 'course-paper', language: defaults?.language === 'en' ? 'en' : 'zh-CN',
    format: 'docx', requirements: '', materials: [], online: false, targetLength: 4000, sections: presetSections(defaults?.defaultProjectType ?? 'course-paper', 4000), manuscriptDir: 'manuscript' }
  const [saved] = useState(() => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null } })
  const [spec, setSpec] = useState<CreationSpec>(saved?.spec ?? initial), [step, setStep] = useState(saved?.step ?? 0)
  const [files, setFiles] = useState<any[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false)
  const update = (change: Partial<CreationSpec>) => setSpec(previous => ({ ...previous, ...change }))
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ spec, step })) } catch { setError('创建信息暂未保存，请保留当前页面。') } }, [spec, step, key])
  useEffect(() => { let live = true
    api('creation.materials', { context: context() }).then((result: any) => {
      if (!live) return; setFiles(result.files)
      if (!saved) update({ materials: result.files.filter((file: any) => file.supported).map((file: any) => file.relativePath) })
    }).catch((error: Error) => live && setError(error.message))
    return () => { live = false }
  }, [key])
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (error) { setError((error as Error).message) } finally { setBusy(false) } }
  const readySpec = () => ({ ...spec, title: spec.title.trim() || spec.requirements.trim().split('\n')[0].slice(0, 60),
    materials: [...new Set([...spec.materials, ...(spec.assignmentPath ? [spec.assignmentPath] : [])])] })
  const suggest = async (structure: boolean) => {
    const result = await api('creation.suggest', { context: context(), spec: { ...readySpec(), title: readySpec().title || '待确定论文题目', requirements: spec.requirements.trim() || '根据所选作业要求文件提取写作要求。' }, assignmentPath: spec.assignmentPath })
    update({ title: spec.title.trim() || result.title, ...(structure ? { sections: result.sections } : { requirements: result.requirements }) })
  }
  const moveSection = (index: number, direction: number) => {
    const sections = [...spec.sections], target = index + direction
    if (target < 0 || target >= sections.length) return
    ;[sections[index], sections[target]] = [sections[target], sections[index]]; update({ sections })
  }
  return <div className="sf-wizard-scroll"><section className="sf-wizard" aria-label="创建论文向导">
    <header><span className="sf-wizard-eyebrow">{workspaceTitle}</span><h2>开始一篇论文</h2><p>确定要求与资料，我们一起完成初稿。</p></header>
    <nav className="sf-wizard-steps" aria-label="创建步骤">{['写作要求', '资料范围', '行文结构'].map((title, index) => <button key={title} disabled={busy || index > step} aria-current={step === index ? 'step' : undefined}
      onClick={() => setStep(index)}><span>{index + 1}</span>{title}</button>)}</nav>
    <div className="sf-wizard-page" key={step}>
      {step === 0 && <>
        <label>论文标题<input placeholder="可以先留空，由写作要求生成" value={spec.title} maxLength={300} onChange={e => update({ title: e.target.value })} /></label>
        <div className="sf-wizard-row"><label>论文类型<select value={spec.type} onChange={e => { const type = e.target.value as CreationSpec['type']; update({ type, sections: presetSections(type, spec.targetLength) }) }}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>语言<select value={spec.language} onChange={e => update({ language: e.target.value as CreationSpec['language'] })}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
          <label>提交格式<select value={spec.format} onChange={e => update({ format: e.target.value as CreationSpec['format'] })}>{Object.entries(FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <label>写作要求<textarea rows={6} placeholder="例如：机器学习课程论文，约4000字，结合课件和笔记讨论实际应用，需要参考文献。也可以粘贴老师的要求。" value={spec.requirements} maxLength={12000} onChange={e => update({ requirements: e.target.value })} /></label>
        <div className="sf-assignment-row"><label>作业要求文件<select value={spec.assignmentPath ?? ''} onChange={e => update({ assignmentPath: e.target.value || undefined })}><option value="">不选择</option>{files.filter(file => file.supported).map(file => <option key={file.relativePath}>{file.relativePath}</option>)}</select></label>
          <button disabled={busy || !spec.assignmentPath} onClick={() => act(() => suggest(false))}>提取要求摘要</button></div>
      </>}
      {step === 1 && <>
        <h3>选择论文使用的资料</h3><p className="sf-muted">读取当前工作区中的课件、论文和笔记，原文件保留原样。</p>
        <div className="sf-material-checklist">{files.filter(file => file.supported).map(file => <label key={file.relativePath}><input type="checkbox" checked={spec.materials.includes(file.relativePath)} onChange={e => update({ materials: e.target.checked ? [...spec.materials, file.relativePath] : spec.materials.filter(path => path !== file.relativePath) })} /><span>{file.relativePath}</span><small>{Math.ceil(file.size / 1024)} KB</small></label>)}
          {!files.some(file => file.supported) && <p>工作区中还没有可读取的资料，可以开启联网补充，或先继续确定结构。</p>}</div>
        <label className="sf-online-choice"><input type="checkbox" checked={spec.online} onChange={e => update({ online: e.target.checked })} /><span><strong>联网补充文献</strong><small>检索相关文献，获取公开可读取的全文。</small></span></label>
        {files.some(file => !file.supported) && <details><summary>其他文件</summary><p className="sf-muted">这些文件保持原样，本次不会作为已读取资料。</p>{files.filter(file => !file.supported).map(file => <p key={file.relativePath}>{file.relativePath}</p>)}</details>}
      </>}
      {step === 2 && <>
        <div className="sf-structure-caption"><label>目标篇幅<input type="number" min={200} max={60000} value={spec.targetLength} onChange={e => update({ targetLength: Number(e.target.value) })} /></label><span>{spec.language === 'en' ? '词' : '汉字'}</span>
          <button disabled={busy} onClick={() => update({ sections: presetSections(spec.type, spec.targetLength) })}>使用类型预设</button><button disabled={busy} onClick={() => act(() => suggest(true))}>AI 完善结构</button></div>
        <div className="sf-structure-list">{spec.sections.map((section, index) => <div className="sf-structure-section" key={section.id}><span>{index + 1}</span>
          <div><input aria-label={`第${index + 1}章标题`} value={section.title} onChange={e => update({ sections: spec.sections.map(row => row.id === section.id ? { ...row, title: e.target.value } : row) })} />
            <input aria-label={`第${index + 1}章写作内容`} placeholder="本节写什么（可选）" value={section.purpose} onChange={e => update({ sections: spec.sections.map(row => row.id === section.id ? { ...row, purpose: e.target.value } : row) })} /></div>
          <input className="sf-section-length" aria-label={`第${index + 1}章篇幅`} type="number" min={50} value={section.targetLength} onChange={e => update({ sections: spec.sections.map(row => row.id === section.id ? { ...row, targetLength: Number(e.target.value) } : row) })} />
          <div className="sf-section-actions"><button aria-label="上移章节" disabled={index === 0} onClick={() => moveSection(index, -1)}>↑</button><button aria-label="下移章节" disabled={index === spec.sections.length - 1} onClick={() => moveSection(index, 1)}>↓</button><button aria-label="删除章节" disabled={spec.sections.length === 1} onClick={() => update({ sections: spec.sections.filter(row => row.id !== section.id) })}>×</button></div></div>)}</div>
        <button onClick={() => update({ sections: [...spec.sections, { id: `section_${crypto.randomUUID().replaceAll('-', '')}`, title: '新章节', purpose: '', targetLength: 500 }] })}>＋ 添加章节</button>
        <p className="sf-wizard-summary">{TYPE_LABELS[spec.type]} · {FORMAT_LABELS[spec.format]} · {spec.materials.length} 份资料{spec.online && ' · 联网补充'}<br />创建 {spec.manuscriptDir}/ 与 .scholarflow/，并开始撰写。</p>
        {conflict && <label>论文输出目录<input value={spec.manuscriptDir} onChange={e => update({ manuscriptDir: e.target.value })} /><small>此处已有文件，请选择新的输出目录。</small></label>}
      </>}
    </div>
    {error && <p className="sf-wizard-error" role="alert">{error.replace(/^[A-Z_]+:\s*/, '')}</p>}
    <footer className="sf-wizard-footer">{step > 0 && <button disabled={busy} onClick={() => setStep(step - 1)}>← 上一步</button>}<span />
      {step < 2 ? <button className="sf-primary" disabled={busy || !spec.requirements.trim()} onClick={() => { if (step === 1 && spec.sections.every(row => !row.purpose)) act(async () => { setStep(2); await suggest(true) }); else setStep(step + 1) }}>下一步 →</button>
        : <button className="sf-primary" disabled={busy || !spec.sections.every(section => section.title.trim() && section.targetLength >= 50)} onClick={() => act(async () => {
          const value = creationSpec.parse(readySpec())
          try { const plan = await api('creation.prepare', { context: context(), spec: value }); await api('creation.start', { context: context(), planId: plan.planId, planHash: plan.planHash }) }
          catch (error) { if ((error as Error).message.includes('OUTPUT_PATH_CONFLICT')) setConflict(true); throw error }
          try { localStorage.removeItem(key) } catch {}
          await onCreated()
        })}>{busy ? '正在创建…' : '创建论文并开始撰写'}</button>}
    </footer>
  </section></div>
}

export const WIZARD_CSS = `
.sf-wizard-scroll{overflow:auto;flex:1;background:var(--dsw-alias-bg-layer-1,#fafbfc);padding:36px 24px}.sf-wizard{max-width:760px;margin:0 auto;padding:30px 36px;background:var(--dsw-alias-bg-base,#fff);border:1px solid #8882;border-radius:16px;box-shadow:0 8px 32px #00000005;font-size:14px}.sf-wizard h2{font-size:24px;margin:8px 0}.sf-wizard h3{font-size:16px}.sf-wizard p,.sf-muted{color:var(--dsw-alias-label-secondary,#727780);line-height:1.65}.sf-wizard-eyebrow{font-size:12px;color:#888}.sf-wizard label{display:flex;flex-direction:column;gap:8px;font-size:13px}.sf-wizard input:not([type=checkbox]),.sf-wizard select{height:38px;width:100%;padding:0 10px;border:1px solid #8884;border-radius:7px;background:transparent;color:inherit}.sf-wizard textarea{font-size:14px;line-height:1.7}.sf-wizard-steps{display:flex;gap:20px;padding:22px 0;border-bottom:1px solid #8882;margin-bottom:20px}.sf-wizard-steps button{border:0!important;padding:0!important;display:flex;align-items:center;gap:8px;color:#858a92!important}.sf-wizard-steps span{display:grid;place-items:center;width:25px;height:25px;border-radius:50%;background:#8881}.sf-wizard-steps [aria-current=step]{color:#4475e7!important}.sf-wizard-steps [aria-current=step] span{background:#4475e7;color:#fff}.sf-wizard-page{animation:sf-wizard-enter .22s ease-out}.sf-wizard-row{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:16px}.sf-assignment-row{display:flex;align-items:center;gap:16px}.sf-assignment-row label{flex:1}.sf-material-checklist{max-height:290px;overflow:auto;border:1px solid #8882;border-radius:9px}.sf-material-checklist label{display:flex;flex-direction:row;align-items:center;margin:0!important;padding:10px 12px;border-bottom:1px solid #8881}.sf-material-checklist span{flex:1;overflow-wrap:anywhere}.sf-material-checklist small{color:#999;flex:none}.sf-online-choice{flex-direction:row!important;align-items:center;padding:15px;border-radius:9px;background:#4475e708;margin-top:18px!important}.sf-online-choice span{display:flex;flex-direction:column;gap:4px}.sf-online-choice small{color:#888}.sf-structure-caption{display:flex;gap:10px;align-items:center}.sf-structure-caption label{max-width:130px}.sf-structure-caption button:first-of-type{margin-left:auto}.sf-structure-section{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid #8882}.sf-structure-section>div:first-of-type{flex:1;display:flex;flex-direction:column;gap:6px}.sf-structure-section>span{color:#999}.sf-structure-section>div:first-of-type input:last-child{border:0;font-size:12px;height:26px;padding:0 10px}.sf-structure-section .sf-section-length{width:76px}.sf-section-actions{display:flex;gap:2px}.sf-section-actions button{padding:4px 7px!important;border:0!important}.sf-wizard-summary{padding:14px;background:#88805;border-radius:8px;font-size:12px}.sf-wizard-footer{display:flex;align-items:center;gap:12px;padding-top:22px}.sf-wizard-footer>span{flex:1}.sf-primary{background:#4778e8!important;border-color:#4778e8!important;color:white!important}.sf-wizard-error{color:#d45151!important}.sf-wizard button{cursor:pointer}.sf-wizard button:disabled{opacity:.45;cursor:default}@keyframes sf-wizard-enter{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:translateX(0)}}@media(prefers-reduced-motion:reduce){.sf-wizard-page{animation:none}}@media(max-width:720px){.sf-wizard{padding:20px}.sf-wizard-row{grid-template-columns:1fr}.sf-wizard-steps{gap:12px}.sf-structure-caption{flex-wrap:wrap}}
`
