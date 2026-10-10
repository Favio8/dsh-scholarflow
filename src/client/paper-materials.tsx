import React, { useState } from 'react'
import { Research } from './research.tsx'

export function PaperMaterials(props: any) {
  const { project, api, context, run, busy } = props
  const [parsed, setParsed] = useState<any>(), [index, setIndex] = useState(0)
  const materials = Object.values(project.ledger.materials) as any[], sources = Object.values(project.ledger.sources) as any[]
  const block = parsed?.blocks[index]
  return <section className="sf-materials-panel"><h2>资料与引用</h2><p className="sf-muted">{materials.length} 份资料 · {sources.length} 个来源</p>
    <div className="sf-materials-grid">{materials.map(row => <button className="sf-material-row" disabled={busy} key={row.id} onClick={() => run(async () => {
      setParsed(await api('materials.read', { context: context(), materialId: row.id })); setIndex(0)
    })}><strong>{row.projectRelativePath.startsWith('.scholarflow/cache/') ? sources.find(source => source.materialId === row.id)?.title ?? '公开全文' : row.projectRelativePath}</strong>
      <small>{row.parseStatus === 'ready' ? '已读取' : row.parseStatus === 'partial' ? '部分已读取' : row.parseStatus === 'failed' ? '读取未完成' : '等待读取'}</small></button>)}</div>
    {parsed && <section className="sf-material-excerpt"><header><strong>资料原文</strong><button onClick={() => setParsed(undefined)}>关闭</button></header>
      {block && <><small>{block.locator.kind === 'pdf' ? `第 ${block.locator.pageNumber} 页` : block.locator.kind === 'text' ? `第 ${block.locator.lineStart}–${block.locator.lineEnd} 行` : `第 ${index + 1} 个内容单元`}</small><pre>{block.text}</pre></>}
      <button disabled={!index} onClick={() => setIndex(index - 1)}>上一段</button><span> {index + 1} / {parsed.blocks.length} </span><button disabled={index + 1 >= parsed.blocks.length} onClick={() => setIndex(index + 1)}>下一段</button></section>}
    <h3>参考来源</h3>{sources.map(source => <div className="sf-reference-row" key={source.id}><strong>{source.title}</strong><p className="sf-muted">{source.authors.map((author: any) => author.literal ?? author.family).join(', ')}{source.year && ` · ${source.year}`} · {source.textAccess === 'fulltext' ? '全文已读取' : source.textAccess === 'excerpt' ? '已读取摘录' : '仅元数据'}</p>
      <code>[@{source.citeKey}]</code>{source.identifiers.url && <a href={source.identifiers.url} target="_blank" rel="noopener noreferrer"> 查看来源 ↗</a>}</div>)}
    <details className="sf-material-maintenance"><summary>补充资料与维护引用</summary><Research {...props} /></details>
  </section>
}
export const MATERIALS_CSS = `.sf-materials-panel{max-width:960px;margin:auto;font-size:var(--sf-font-md)}.sf-materials-panel h2{font-size:var(--sf-font-2xl)}.sf-materials-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--sf-space-3)}.sf-material-row{display:flex;flex-direction:column;gap:var(--sf-space-2);text-align:left;padding:var(--sf-space-4)!important;overflow-wrap:anywhere}.sf-material-row small{color:var(--sf-text-faint)}.sf-reference-row{padding:var(--sf-space-4) 0;border-bottom:1px solid var(--sf-border)}.sf-reference-row p{margin:var(--sf-space-2) 0}.sf-reference-row code{font-size:var(--sf-font-xs);color:var(--sf-text-faint)}.sf-reference-row a{font-size:var(--sf-font-sm);color:var(--sf-accent-text)}.sf-material-excerpt{padding:var(--sf-space-4);margin:var(--sf-space-4) 0;background:var(--sf-fill-sunken);border-radius:var(--sf-radius-xl)}.sf-material-excerpt header{display:flex;justify-content:space-between}.sf-material-excerpt pre{max-height:300px;overflow:auto;white-space:pre-wrap;line-height:var(--sf-leading-prose)}.sf-material-maintenance{margin-top:var(--sf-space-5)}.sf-material-maintenance>summary{cursor:pointer;color:var(--sf-text-faint)}`
