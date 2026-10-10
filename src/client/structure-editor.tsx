import React from 'react'
import type { CreationSpec } from '../shared/writing-task.ts'
type Section = CreationSpec['sections'][number]

export function StructureEditor({ sections, busy, onEdit, onMove, onAdd }: {
  sections: Section[]; busy: boolean; onEdit: (sections: Section[]) => void
  onMove: (index: number, direction: number) => void; onAdd: (id: string) => void
}) {
  const replace = (id: string, patch: Partial<Section>) => onEdit(sections.map(row => row.id === id ? { ...row, ...patch } : row))
  return <div className="sf-outline-editor">{(['front', 'body', 'back'] as const).map(kind => {
    const rows = sections.filter(row => (row.kind ?? 'body') === kind)
    if (!rows.length) return null
    const roots = rows.filter(row => !row.parentId)
    return <section className="sf-outline-group" key={kind} aria-label={kind === 'body' ? '正文结构' : kind === 'front' ? '前置部分' : '后置部分'}>
      <header><h4>{kind === 'body' ? '正文' : kind === 'front' ? '前置部分' : '后置部分'}</h4>
        <span>{roots.length} {kind === 'body' ? '章' : '项'} · {rows.reduce((sum, row) => sum + row.targetLength, 0)} 字{kind !== 'body' && ' · 单独计数'}</span></header>
      {rows.map(section => {
        const index = sections.indexOf(section), children = rows.filter(row => row.parentId === section.id)
        const peers = rows.filter(row => row.parentId === section.parentId)
        const position = peers.indexOf(section)
        const number = kind !== 'body' ? '—' : section.parentId
          ? `${roots.findIndex(row => row.id === section.parentId) + 1}.${position + 1}` : String(roots.indexOf(section) + 1)
        return <div className="sf-outline-edit-row" data-child={!!section.parentId} key={section.id}>
          <span className="sf-outline-number">{number}</span>
          <input id={`sf-section-title-${index}`} className="sf-outline-title" title={section.title} aria-label={`第${index + 1}章标题`}
            value={section.title} onChange={event => replace(section.id, { title: event.target.value })} />
          <label className="sf-outline-budget"><input type="number" min={50} aria-label={`第${index + 1}章篇幅`} value={section.targetLength}
            onChange={event => replace(section.id, { targetLength: Number(event.target.value), allocationMode: 'manual' })} /><span>{children.length ? '导语字数' : '字'}</span></label>
          <details className="sf-outline-menu"><summary aria-label={`${section.title}的章节操作`}>⋯</summary><div>
            {kind === 'body' && !section.parentId && <button disabled={busy} onClick={() => onAdd(section.id)}>添加子节</button>}
            <button disabled={busy || position === 0} onClick={() => onMove(index, -1)}>上移</button>
            <button disabled={busy || position === peers.length - 1} onClick={() => onMove(index, 1)}>下移</button>
            <button disabled={busy} onClick={() => onEdit(sections.filter(row => row.id !== section.id && row.parentId !== section.id))}>删除</button>
          </div></details>
          <details className="sf-outline-purpose"><summary>写作重点{children.length ? ` · 章内合计 ${section.targetLength + children.reduce((sum, row) => sum + row.targetLength, 0)} 字` : ''}</summary>
            <textarea aria-label={`第${index + 1}章写作内容`} rows={2} placeholder="说明本节要回答什么，以及与上下文的关系" value={section.purpose}
              onChange={event => replace(section.id, { purpose: event.target.value })} /></details>
        </div>
      })}
    </section>
  })}</div>
}
