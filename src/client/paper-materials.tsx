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
export const MATERIALS_CSS = `.sf-materials-panel{max-width:960px;margin:auto;font-size:13px}.sf-materials-panel h2{font-size:22px}.sf-materials-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}.sf-material-row{display:flex;flex-direction:column;gap:8px;text-align:left;padding:15px!important;overflow-wrap:anywhere}.sf-material-row small{color:#888}.sf-reference-row{padding:14px 0;border-bottom:1px solid #8882}.sf-reference-row p{margin:6px 0}.sf-reference-row code{font-size:11px;color:#888}.sf-reference-row a{font-size:12px;color:#4778e8}.sf-material-excerpt{padding:16px;margin:18px 0;background:#88804;border-radius:10px}.sf-material-excerpt header{display:flex;justify-content:space-between}.sf-material-excerpt pre{max-height:300px;overflow:auto;white-space:pre-wrap;line-height:1.7}.sf-material-maintenance{margin-top:24px}.sf-material-maintenance>summary{cursor:pointer;color:#888}`
