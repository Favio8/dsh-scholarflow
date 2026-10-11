import React, { useEffect, useState } from 'react'
import { outlineOrder } from '../core/editing/sections.ts'
import type { Outline } from '../shared/schema.ts'

type Props = { project: any; context: () => any; api: (method: string, request: any) => Promise<any>; refresh: () => Promise<void>; run: (fn: () => Promise<unknown>) => void; busy: boolean }
type Section = Outline['sections'][number]
const empty = (): Section => ({ id: `sec_${crypto.randomUUID()}`, title: '', purpose: '', claimIds: [], missingEvidence: [] })
export function OutlineEditor({ project, context, api, refresh, run, busy }: Props) {
  const server: Outline = project.ledger.outline
  const [draft, setDraft] = useState<Outline>(server), [base, setBase] = useState(server)
  const [entry, setEntry] = useState<Section>(empty), [editing, setEditing] = useState(false)
  const [formOpen,setFormOpen]=useState(false)
  const [length, setLength] = useState(''), [unit, setUnit] = useState<'words' | 'zh-characters'>('zh-characters')
  const [preview, setPreview] = useState<{ outline: Outline; confirmation: 'draft' | 'confirmed' }>(), [message, setMessage] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(base), conflict = server.version !== base.version
  useEffect(() => { if (!dirty && !editing && !entry.title.trim()) { setDraft(server); setBase(server) } }, [server.version, server.confirmation])
  const change = (patch: Partial<Outline>) => { setDraft({ ...draft, ...patch }); setPreview(undefined) }
  const load = (section: Section) => { setEntry(structuredClone(section)); setLength(section.targetLength ? String(section.targetLength.value) : ''); setUnit(section.targetLength?.unit ?? 'zh-characters'); setEditing(true);setFormOpen(true) }
  const clear = () => { setEntry(empty()); setLength(''); setEditing(false);setFormOpen(false) }
  const withEntry = () => {
    if (!entry.title.trim()) throw new Error('章节标题不能为空。')
    if (length && (!Number.isFinite(Number(length)) || Number(length) < 1)) throw new Error('目标篇幅须为正数。')
    const section = { ...entry, title: entry.title.trim(), ...(length ? { targetLength: { value: Number(length), unit } } : { targetLength: undefined }) }
    const sections = editing ? draft.sections.map(row => row.id === section.id ? section : row) : [...draft.sections, section]
    const next = { ...draft, sections }; outlineOrder(next); return next
  }
  const save = async (outline: Outline, confirmation: 'draft' | 'confirmed') => {
    const result = await api(confirmation === 'confirmed' ? 'outline.confirm' : 'outline.save', { context: context(), expectedOutlineVersion: base.version, outline })
    setDraft(result.outline); setBase(result.outline); setPreview(undefined); clear()
    setMessage(`大纲版本 ${result.outline.version} 已保存，${confirmation === 'confirmed' ? '已明确确认' : '仍需确认后才能写作'}；现有正文保留。`)
    await refresh()
  }
  const remove = (id: string) => {
    const ids = new Set([id]); let last = 0
    while (last !== ids.size) { last = ids.size; for (const row of draft.sections) if (row.parentId && ids.has(row.parentId)) ids.add(row.id) }
    change({ sections: draft.sections.filter(row => !ids.has(row.id)) }); if (ids.has(entry.id)) clear()
    setMessage(`本地编辑移除 ${ids.size} 个章节及其子章节；保存前不会改变项目或正文。`)
  }
  const move = (section: Section, direction: number) => {
    const peers = draft.sections.filter(row => row.parentId === section.parentId), index = peers.findIndex(row => row.id === section.id), other = peers[index + direction]
    if (!other) return
    const rows = [...draft.sections], a = rows.indexOf(section), b = rows.indexOf(other); [rows[a], rows[b]] = [rows[b], rows[a]]
    change({ sections: rows })
  }
  const ordered = outlineOrder(draft)
  return <section aria-label="论文大纲">
    <header className="sf-page-heading"><p className="sf-muted">{server.confirmation==='confirmed'?'结构已确认':'结构待确认'}{dirty?' · 有未保存修改':''}</p><button disabled={busy} onClick={()=>{clear();setFormOpen(true)}}>添加章节</button></header>
    {conflict&&<p role="alert">章节结构已在另一处更新。当前编辑已保留。</p>}
    <details className="sf-detail"><summary>论文标题与研究问题</summary><div className="sf-form">
      <label>论文标题<input aria-label="大纲标题" value={draft.title} onChange={event=>change({title:event.target.value})}/></label>
      <label>研究问题<input aria-label="研究问题" value={draft.researchQuestion} onChange={event=>change({researchQuestion:event.target.value})}/></label>
      <label>中心观点<input aria-label="中心论点" value={draft.thesis} onChange={event=>change({thesis:event.target.value})}/></label></div></details>
    <ol className="sf-outline-list">{ordered.map(section=><li key={section.id}><div className="sf-page-heading"><div><strong>{section.title}</strong>{section.parentId&&<small className="sf-muted"> · {draft.sections.find(row=>row.id===section.parentId)?.title}</small>}
      <p className="sf-muted">{section.targetLength?section.targetLength.value+(section.targetLength.unit==='words'?' 词':' 字'):section.purpose}</p></div><div className="sf-page-actions"><button disabled={busy} onClick={()=>load(section)}>编辑</button>
      <button aria-label={'上移章节 '+section.title} disabled={busy} onClick={()=>move(section,-1)}>上移</button><button aria-label={'下移章节 '+section.title} disabled={busy} onClick={()=>move(section,1)}>下移</button><button disabled={busy} onClick={()=>remove(section.id)}>移除</button></div></div></li>)}</ol>
    {formOpen&&<section className="sf-group"><header><h3>{editing?'编辑章节':'添加章节'}</h3></header><div className="sf-form">
      <label>章节标题<input aria-label="章节标题" value={entry.title} onChange={event=>setEntry({...entry,title:event.target.value})}/></label>
      <label>章节目的<textarea aria-label="章节目的" value={entry.purpose} onChange={event=>setEntry({...entry,purpose:event.target.value})}/></label>
      <label>所属章节<select aria-label="父章节" value={entry.parentId??''} onChange={event=>setEntry({...entry,parentId:event.target.value||undefined})}><option value="">独立章节</option>{ordered.filter(row=>row.id!==entry.id).map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
      <label>目标篇幅<input aria-label="章节目标篇幅" type="number" min="1" value={length} onChange={event=>setLength(event.target.value)}/></label>
      <details className="sf-detail"><summary>证据与篇幅单位</summary><label>篇幅单位<select aria-label="章节篇幅口径" value={unit} onChange={event=>setUnit(event.target.value as typeof unit)}><option value="zh-characters">汉字数</option><option value="words">西文词数</option></select></label>
        <label>缺少的证据<textarea aria-label="章节证据缺口" value={entry.missingEvidence.join('\n')} onChange={event=>setEntry({...entry,missingEvidence:event.target.value.split('\n')})}/></label>
        {(Object.values(project.ledger.claims) as any[]).map(claim=><label className="sf-check" key={claim.id}><input type="checkbox" checked={entry.claimIds.includes(claim.id)} onChange={event=>setEntry({...entry,claimIds:event.target.checked?[...entry.claimIds,claim.id]:entry.claimIds.filter(id=>id!==claim.id)})}/>{claim.text}</label>)}</details>
      </div><div className="sf-page-actions"><button disabled={busy||!entry.title.trim()||conflict} onClick={()=>run(async()=>{setDraft(withEntry());setPreview(undefined);clear()})}>保留章节修改</button><button onClick={clear}>取消</button></div></section>}
    <div className="sf-page-actions"><button className="sf-primary" disabled={busy||conflict||!dirty} onClick={()=>run(()=>save(draft,'draft'))}>保存结构</button>
      <button disabled={busy||conflict||!draft.researchQuestion.trim()||!draft.thesis.trim()||!draft.sections.length} onClick={()=>run(()=>save(draft,'confirmed'))}>确认结构</button>
      {(dirty||conflict)&&<button disabled={busy} onClick={()=>{setDraft(server);setBase(server);setPreview(undefined);clear();setMessage('已恢复已保存结构。')}}>放弃未保存修改</button>}</div>
    {message&&<p role="status">{message}</p>}
  </section>
}
