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
  const [length, setLength] = useState(''), [unit, setUnit] = useState<'words' | 'zh-characters'>('zh-characters')
  const [preview, setPreview] = useState<{ outline: Outline; confirmation: 'draft' | 'confirmed' }>(), [message, setMessage] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(base), conflict = server.version !== base.version
  useEffect(() => { if (!dirty && !editing && !entry.title.trim()) { setDraft(server); setBase(server) } }, [server.version, server.confirmation])
  const change = (patch: Partial<Outline>) => { setDraft({ ...draft, ...patch }); setPreview(undefined) }
  const load = (section: Section) => { setEntry(structuredClone(section)); setLength(section.targetLength ? String(section.targetLength.value) : ''); setUnit(section.targetLength?.unit ?? 'zh-characters'); setEditing(true) }
  const clear = () => { setEntry(empty()); setLength(''); setEditing(false) }
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
  return <section aria-label="论文大纲"><h3>论文大纲 · 版本 {server.version} · {server.confirmation === 'confirmed' ? '已确认' : '待确认'}</h3>
    <p>保存形成新版本；确认是写作检查点。结构改变会使旧结构审查与章节候选需更新，已有正文保留。</p>
    {conflict && <p role="alert">服务端大纲已改变，本页编辑保留；重新比较后采用服务端版本，不能以旧版本覆盖。</p>}
    <button disabled={busy} onClick={() => { setDraft(server); setBase(server); setPreview(undefined); clear(); setMessage('已明确采用服务端大纲。') }}>放弃本地大纲编辑并采用服务端</button>
    <label>大纲标题<input aria-label="大纲标题" value={draft.title} onChange={e => change({ title: e.target.value })} /></label>
    <label>研究问题<input aria-label="研究问题" value={draft.researchQuestion} onChange={e => change({ researchQuestion: e.target.value })} /></label>
    <label>中心论点<input aria-label="中心论点" value={draft.thesis} onChange={e => change({ thesis: e.target.value })} /></label>
    <h4>{editing ? '编辑章节' : '新增章节'}</h4>
    <label>章节标题<input aria-label="章节标题" value={entry.title} onChange={e => setEntry({ ...entry, title: e.target.value })} /></label>
    <label>章节目的<textarea aria-label="章节目的" value={entry.purpose} onChange={e => setEntry({ ...entry, purpose: e.target.value })} /></label>
    <label>父章节<select aria-label="父章节" value={entry.parentId ?? ''} onChange={e => setEntry({ ...entry, parentId: e.target.value || undefined })}><option value="">顶层章节</option>
      {ordered.filter(row => row.id !== entry.id).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
    <label>目标篇幅<input aria-label="章节目标篇幅" type="number" min="1" value={length} onChange={e => setLength(e.target.value)} /></label>
    <label>篇幅口径<select aria-label="章节篇幅口径" value={unit} onChange={e => setUnit(e.target.value as typeof unit)}><option value="zh-characters">汉字数</option><option value="words">西文词元数</option></select></label>
    <label>缺少证据（每行一项）<textarea aria-label="章节证据缺口" value={entry.missingEvidence.join('\n')} onChange={e => setEntry({ ...entry, missingEvidence: e.target.value.split('\n') })} /></label>
    <fieldset><legend>本章节使用的论点</legend>{(Object.values(project.ledger.claims) as any[]).map(claim => <label key={claim.id}><input type="checkbox" checked={entry.claimIds.includes(claim.id)}
      onChange={e => setEntry({ ...entry, claimIds: e.target.checked ? [...entry.claimIds, claim.id] : entry.claimIds.filter(id => id !== claim.id) })} />{claim.text} · {claim.status}</label>)}</fieldset>
    <button disabled={busy || !entry.title.trim() || conflict} onClick={() => run(async () => { setDraft(withEntry()); setPreview(undefined); clear(); setMessage('章节已加入本地编辑；请预览保存。') })}>{editing ? '更新本地章节编辑' : '加入本地编辑大纲'}</button>
    <button disabled={busy} onClick={clear}>取消章节编辑</button>
    {!editing && <button disabled={busy || conflict || !draft.researchQuestion.trim() || !draft.thesis.trim() || !entry.title.trim() || !entry.claimIds.length}
      onClick={() => run(async () => save(withEntry(), 'confirmed'))}>确认大纲并添加章节</button>}
    <ol>{ordered.map(section => <li key={section.id}><b>{section.title}</b>{section.parentId && <span> · 父章节：{draft.sections.find(row => row.id === section.parentId)?.title}</span>}
      <p>{section.purpose}</p><p>论点：{section.claimIds.map(id => project.ledger.claims[id]?.text ?? '已缺失').join('；') || '无，仍需证据或明确缺口'}</p>
      <p>目标篇幅：{section.targetLength ? `${section.targetLength.value} ${section.targetLength.unit}` : '未设置'} · 缺口：{section.missingEvidence.filter(Boolean).join('；') || '未记录，不代表证据完整'}</p>
      <button disabled={busy} onClick={() => load(section)}>编辑章节 {section.title}</button>
      <button disabled={busy} onClick={() => move(section, -1)}>上移章节 {section.title}</button><button disabled={busy} onClick={() => move(section, 1)}>下移章节 {section.title}</button>
      <button disabled={busy} onClick={() => remove(section.id)}>从本地大纲移除章节 {section.title}</button></li>)}</ol>
    <button disabled={busy || conflict || !dirty} onClick={() => setPreview({ outline: structuredClone(draft), confirmation: 'draft' })}>预览保存大纲草稿</button>
    <button disabled={busy || conflict || !draft.researchQuestion.trim() || !draft.thesis.trim() || !draft.sections.length} onClick={() => setPreview({ outline: structuredClone(draft), confirmation: 'confirmed' })}>预览确认完整大纲</button>
    {preview && <section role="dialog" aria-label="完整大纲保存确认"><h4>{preview.confirmation === 'confirmed' ? '确认完整大纲' : '保存大纲草稿'}</h4>
      <p>基于版本 {base.version}；{preview.outline.title} · {preview.outline.researchQuestion} · {preview.outline.thesis}</p>
      <ol>{outlineOrder(preview.outline).map(row => <li key={row.id}>{row.title} · 父章节 {row.parentId ? preview.outline.sections.find(parent => parent.id === row.parentId)?.title : '顶层'} · {row.purpose} · {row.targetLength ? `${row.targetLength.value} ${row.targetLength.unit}` : '无篇幅目标'} · 论点 {row.claimIds.join('、') || '无'} · 缺口 {row.missingEvidence.join('；') || '未记录'}</li>)}</ol>
      <p>增删、父子关系与重排仅改变大纲。旧版本会归档，正文保留，旧结构审查和章节建议需更新。</p>
      <button disabled={busy || conflict} onClick={() => run(async () => save(preview.outline, preview.confirmation))}>确认保存完整大纲</button>
      <button disabled={busy} onClick={() => setPreview(undefined)}>取消完整大纲保存</button></section>}
    <p role="status">{message}{dirty ? ' · 大纲有本地未保存编辑。' : ''}</p>
  </section>
}
