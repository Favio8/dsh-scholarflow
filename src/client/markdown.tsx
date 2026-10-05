import React from 'react'
import katex from 'katex'
import { type AstNode, type Projection, mapLeafPoint, validateRange } from '../core/editing/markdown.ts'
import type { SelectionPayload } from '../shared/editing.ts'

export function MarkdownView({ projection }: { projection: Projection }) {
  const leaves = new Map(projection.leaves.map(leaf => [leaf.id, leaf]))
  const render = (node: AstNode, key: string): React.ReactNode => {
    const children = node.children?.map((child, index) => render(child, `${key}_${index}`))
    if (node.type === 'text') return <React.Fragment key={key}>{node.leafIds?.map(id => { const leaf = leaves.get(id)!; return <span key={id} data-sf-leaf={id} title={leaf.citationKeys ? leaf.citationKeys.map(key => `[@${key}]`).join('; ') : undefined}>{leaf.text}</span> })}</React.Fragment>
    if (node.type === 'root') return <React.Fragment key={key}>{children}</React.Fragment>
    if (node.type === 'paragraph') return <p key={key} data-sf-block={node.blockId} tabIndex={-1} style={{ whiteSpace: 'pre-wrap' }}>{children}</p>
    if (node.type === 'heading') return React.createElement(`h${node.depth ?? 2}`, { key, 'data-sf-heading-offset': node.position?.start.offset, tabIndex: -1 }, children)
    if (node.type === 'strong') return <strong key={key}>{children}</strong>
    if (node.type === 'emphasis') return <em key={key}>{children}</em>
    if (node.type === 'delete') return <del key={key}>{children}</del>
    if (node.type === 'blockquote') return <blockquote key={key}>{children}</blockquote>
    if (node.type === 'list') return node.ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>
    if (node.type === 'listItem') return <li key={key}>{children}</li>
    if (node.type === 'link') return /^(https?:|mailto:)/i.test(node.url ?? '') ? <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">{children}</a> : <span key={key}>{children}</span>
    if (node.type === 'inlineMath' || node.type === 'math') return <span key={key} data-sf-protected="true" dangerouslySetInnerHTML={{ __html: katex.renderToString(node.value ?? '', {
      displayMode: node.type === 'math', throwOnError: false, trust: false, maxExpand: 1000, maxSize: 20,
    }) }} />
    if (node.type === 'inlineCode') return <code key={key} data-sf-protected="true">{node.value}</code>
    if (node.type === 'code') return <pre key={key} data-sf-protected="true"><code>{node.value}</code></pre>
    if (node.type === 'html') return <span key={key} data-sf-protected="true">{node.value}</span>
    if (node.type === 'image') return <span key={key} data-sf-protected="true">[图片：{node.alt || '未命名'}；未加载外部地址]</span>
    if (node.type === 'break') return <br key={key} data-sf-protected="true" />
    if (node.type === 'thematicBreak') return <hr key={key} />
    if (node.type === 'definition') return null
    if (node.type === 'table') return <div key={key} data-sf-protected="true"><table><tbody>{children}</tbody></table></div>
    if (node.type === 'tableRow') return <tr key={key}>{children}</tr>
    if (node.type === 'tableCell') return <td key={key}>{children}</td>
    return <span key={key}>{children ?? node.value}</span>
  }
  return <article className="sf-prose" aria-label="渲染正文">{render(projection.tree, 'root')}</article>
}

function point(root: HTMLElement, node: Node, offset: number, edge: 'start' | 'end') {
  if (node.nodeType !== Node.TEXT_NODE) {
    const child = edge === 'start' ? node.childNodes[offset] : node.childNodes[offset - 1]
    if (!child) throw new Error('选区边界不能安全映射，请从正文文字开始选择。')
    const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT)
    const texts: Node[] = child.nodeType === Node.TEXT_NODE ? [child] : []
    for (let item = walker.nextNode(); item; item = walker.nextNode()) texts.push(item)
    node = edge === 'start' ? texts[0] : texts.at(-1)!
    if (!node) throw new Error('选区不包含可定位文字。')
    offset = edge === 'start' ? 0 : node.textContent!.length
  }
  const element = node.parentElement?.closest<HTMLElement>('[data-sf-leaf]')
  if (!element || !root.contains(element) || element.childNodes.length !== 1 || element.firstChild !== node) throw new Error('选区涉及不可安全映射的节点，请明确选择普通段落。')
  return { leafId: element.dataset.sfLeaf!, offset }
}
export function captureSelection(root: HTMLElement, projection: Projection, documentSnapshot: any, projectId: string): SelectionPayload {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) throw new Error('请先在渲染正文中选择一段连续文字。')
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) throw new Error('选区须位于当前渲染正文中。')
  const a = point(root, range.startContainer, range.startOffset, 'start'), b = point(root, range.endContainer, range.endOffset, 'end')
  const from = mapLeafPoint(projection, a.leafId, a.offset, 'start'), to = mapLeafPoint(projection, b.leafId, b.offset, 'end')
  const validated = validateRange(projection, from, to)
  if (validated.renderedText !== selection.toString()) throw new Error('渲染选区与源码映射不一致，请明确选择普通段落或使用源码选择。')
  return { projectId, documentId: 'paper', documentHash: documentSnapshot.contentHash, revisionId: documentSnapshot.revisionId, blockIds: [validated.block.id],
    sourceRange: { startUtf16: from, endUtf16: to }, sourceText: projection.source.slice(from, to), renderedText: validated.renderedText,
    prefixContext: projection.source.slice(Math.max(0, from - 200), from), suffixContext: projection.source.slice(to, to + 200),
    citationKeys: validated.citationKeys, claimIds: [], scope: 'inline', capturedAt: new Date().toISOString() }
}
