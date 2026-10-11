import React, { useLayoutEffect, useRef } from 'react'
import katex from 'katex'
import { type AstNode, type Projection, type Leaf, type TextUnit, mapLeafPoint, validateRange, validateProseRange,projectMarkdown } from '../core/editing/markdown.ts'
import type { SelectionPayload } from '../shared/editing.ts'
import type {DocumentFormatting} from '../shared/formatting.ts'
import {paragraphStyle,formattedLeaf} from '../core/editing/formatting.ts'
import type {TypographySpec} from '../shared/writing-task.ts'
import {scanDocument,headingPresentation} from '../core/export/scan.ts'

/**
 * The rendered slice of a leaf that a source range covers, or nothing when it cannot be placed
 * exactly. `units` tile both spaces continuously, so the slice runs from the first unit ending after
 * the range start to the last unit starting before its end. Boundaries are taken at whole units: a
 * decoded escape or entity is not the same length in the two spaces, so interpolating inside one
 * would land on the wrong character (SF-087).
 */
export function markedSlice(leaf: Leaf, range: { start: number; end: number }) {
  if (!leaf.mappable || !leaf.units.length) return undefined
  const from = Math.max(range.start, leaf.start), to = Math.min(range.end, leaf.end)
  if (from >= to) return undefined
  const first = leaf.units.find(unit => unit.sourceEnd > from)
  let last: TextUnit | undefined
  for (const unit of leaf.units) if (unit.sourceStart < to) last = unit
  if (!first || !last || last.renderedEnd <= first.renderedStart) return undefined
  return { start: first.renderedStart, end: last.renderedEnd }
}

export function MarkdownView({ projection, annotations, afterBlock, markRange,origins,formatting,typography,interactiveSelection=false }: { projection: Projection; annotations?: (start: number, end: number) => React.ReactNode;
  afterBlock?: (start: number, end: number) => React.ReactNode; markRange?: { start: number; end: number; flowing: boolean };origins?:Array<{start:number;end:number;proposalId:string}>;formatting?:DocumentFormatting;typography?:TypographySpec;interactiveSelection?:boolean }) {
  const article=useRef<HTMLElement>(null)
  useLayoutEffect(()=>{
    if(!interactiveSelection||!article.current)return
    const root=article.current
    let anchor:{offsetNode:Node;offset:number}|undefined
    const caret=(event:MouseEvent)=>(document as any).caretPositionFromPoint(event.clientX,event.clientY) as {offsetNode:Node;offset:number}|null
    const down=(event:MouseEvent)=>{
      if(event.button!==0||event.detail!==1||event.shiftKey||(event.target as HTMLElement).closest('a,button,code,table,[data-sf-protected],.sf-rewrite'))return
      const point=caret(event);if(!point||!root.contains(point.offsetNode))return
      anchor=point;event.preventDefault();window.getSelection()?.setBaseAndExtent(point.offsetNode,point.offset,point.offsetNode,point.offset)
    }
    // Hold the actual first caret while dragging. Chromium's justified text can otherwise
    // collapse both ends to each new hit point; the same native Range works at every zoom.
    const move=(event:MouseEvent)=>{if(!anchor||!(event.buttons&1))return;const point=caret(event);if(!point||!root.contains(point.offsetNode))return
      event.preventDefault();window.getSelection()?.setBaseAndExtent(anchor.offsetNode,anchor.offset,point.offsetNode,point.offset)
    }
    const up=()=>{anchor=undefined}
    root.addEventListener('mousedown',down);root.addEventListener('mousemove',move)
    document.addEventListener('mouseup',up)
    return()=>{root.removeEventListener('mousedown',down);root.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up)}
  },[interactiveSelection])
  const ownsHighlight=useRef(false)
  useLayoutEffect(()=>{
    if(!article.current || !('highlights' in CSS))return
    const registry=(CSS as any).highlights
    if(!markRange){if(ownsHighlight.current)registry.delete('sf-rewrite');ownsHighlight.current=false;return}
    ownsHighlight.current=true;registry.delete('sf-rewrite')
    const ranges:Range[]=[]
    for(const leaf of projection.leaves){const slice=markedSlice(leaf,markRange);if(!slice)continue
      const node=article.current.querySelector(`[data-sf-leaf="${leaf.id}"]`);if(!node)continue
      const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let offset=0
      for(let child=walker.nextNode();child;child=walker.nextNode()){const length=child.textContent?.length??0,from=Math.max(0,slice.start-offset),to=Math.min(length,slice.end-offset)
        if(to>from){const range=new Range();range.setStart(child,from);range.setEnd(child,to);ranges.push(range)}offset+=length}
    }
    registry.set('sf-rewrite',new (window as any).Highlight(...ranges))
    return()=>registry.delete('sf-rewrite')
  },[projection,markRange?.start,markRange?.end])
  const leaves = new Map(projection.leaves.map(leaf => [leaf.id, leaf]))
  const headings=headingPresentation(scanDocument(projection),typography?.headingNumbering)
  const noIndent=new Set<string>();let special=false
  for(const node of projection.tree.children??[]){if(node.type==='heading')special=/^(?:摘要|abstract|关键词|keywords|参考文献|references|bibliography)$/iu.test((node.children??[]).map(child=>child.value??'').join('').trim());if(special&&node.blockId)noIndent.add(node.blockId)}
  const render = (node: AstNode, key: string): React.ReactNode => {
    const children = node.children?.map((child, index) => render(child, `${key}_${index}`))
    if (node.type === 'text') return <React.Fragment key={key}>{node.leafIds?.map(id => {
      const leaf = leaves.get(id)!
      const title = leaf.citationKeys ? leaf.citationKeys.map(key => `[@${key}]`).join('; ') : undefined
      const rows=formatting?.characters.filter(row=>row.start<leaf.end&&row.end>leaf.start)??[]
      const content=formattedLeaf(leaf,formatting).map(({from,text,style})=><span key={from} style={{...(style.sizePt&&{fontSize:`${style.sizePt}pt`}),...(style.fontZh||style.fontEn?{fontFamily:`"${style.fontEn??typography?.bodyFontEn??'Times New Roman'}", "${style.fontZh??typography?.bodyFontZh??'宋体'}", serif`}:{})}}>{text}</span>)
      return <span key={id} data-sf-leaf={id} title={title}>{rows.length?content:leaf.text}</span>
    })}</React.Fragment>
    if (node.type === 'root') return <React.Fragment key={key}>{node.children?.map((child, index) => <React.Fragment key={index}>
      {annotations?.(child.position?.start.offset ?? 0, node.children?.[index + 1]?.position?.start.offset ?? projection.source.length + 1)}
      {render(child, `${key}_${index}`)}</React.Fragment>)}</React.Fragment>
    if (node.type === 'paragraph') {const style=paragraphStyle(formatting,node.position!.start.offset!,node.position!.end.offset!);return <React.Fragment key={key}><p data-sf-block={node.blockId} data-no-indent={noIndent.has(node.blockId??'')||undefined} className={origins?.some(range=>range.start<node.position!.end.offset!&&range.end>node.position!.start.offset!)?'sf-origin-ai':undefined} title={origins?.filter(range=>range.start<node.position!.end.offset!&&range.end>node.position!.start.offset!).map(range=>`包含已采用 AI 修改：${range.proposalId}`).join('；')||undefined} tabIndex={-1} style={{ whiteSpace: 'pre-wrap',textAlign:style.alignment??typography?.bodyAlignment,
      ...(style.firstLineIndentChars!==undefined&&{textIndent:`${style.firstLineIndentChars}em`}),...(style.beforePt!==undefined&&{marginTop:`${style.beforePt}pt`}),...(style.afterPt!==undefined&&{marginBottom:`${style.afterPt}pt`}),...(style.lineSpacing&&{lineHeight:style.lineSpacing}) }}>{children}</p>
      {afterBlock?.(node.position!.start.offset!, node.position!.end.offset!)}</React.Fragment>
    }
    if (node.type === 'heading') {const heading=headings.get(node),local=paragraphStyle(formatting,node.position!.start.offset!,node.position!.end.offset!);return React.createElement(`h${node.depth ?? 2}`, { key, 'data-sf-heading-offset': node.position?.start.offset,'data-heading-level':heading?.title?'title':heading?.depth, tabIndex: -1,
      style:{fontSize:typography?`${heading?.title?typography.titleSizePt:[typography.heading1SizePt,typography.heading2SizePt,typography.heading3SizePt][Math.min(2,(heading?.depth??1)-1)]}pt`:undefined,textAlign:local.alignment??(heading?.title||heading?.depth===1?'center':'left')} }, heading?.label&&<span aria-hidden="true" data-sf-protected="true">{heading.label} </span>,children)}
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
    if (node.type === 'image') return <span key={key} data-sf-protected="true">[图片：{node.alt || '未命名'}；{/^https?:/iu.test(node.url??'')?'未加载外部地址':'本地资源将在导出时检查并打包'}]</span>
    if (node.type === 'break') return <br key={key} data-sf-protected="true" />
    if (node.type === 'thematicBreak') return <hr key={key} />
    if (node.type === 'definition') return null
    if (node.type === 'table') return <div key={key} data-sf-protected="true"><table><tbody>{children}</tbody></table></div>
    if (node.type === 'tableRow') return <tr key={key}>{children}</tr>
    if (node.type === 'tableCell') return <td key={key}>{children}</td>
    return <span key={key}>{children ?? node.value}</span>
  }
  return <article ref={article} className="sf-prose" aria-label="渲染正文">{render(projection.tree, 'root')}</article>
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
  if (!element || !root.contains(element)) throw new Error('请从正文文字开始选择。')
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let prefix=0
  for(let child=walker.nextNode();child;child=walker.nextNode()){if(child===node)return {leafId:element.dataset.sfLeaf!,offset:prefix+offset};prefix+=child.textContent?.length??0}
  throw new Error('这处内容不属于正文文字，请重新选择。')
}
export function restoreSelection(root:HTMLElement,projection:Projection,range:{start:number;end:number}){
  const pointAt=(offset:number,edge:'start'|'end')=>{
    const leaf=projection.leaves.find(row=>edge==='start'?row.start<=offset&&row.end>offset:row.start<offset&&row.end>=offset)
    if(!leaf)return
    const unit=leaf.units.find(row=>edge==='start'?row.sourceStart<=offset&&row.sourceEnd>offset:row.sourceStart<offset&&row.sourceEnd>=offset)
    if(!unit)return
    const element=root.querySelector(`[data-sf-leaf="${leaf.id}"]`)
    if(!element)return
    let remaining=edge==='start'?unit.renderedStart:unit.renderedEnd
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT)
    for(let node=walker.nextNode();node;node=walker.nextNode()){const length=node.textContent!.length;if(remaining<=length)return {node,offset:remaining};remaining-=length}
  }
  const from=pointAt(range.start,'start'),to=pointAt(range.end,'end')
  if(from&&to)window.getSelection()?.setBaseAndExtent(from.node,from.offset,to.node,to.offset)
}
export function captureSelection(root: HTMLElement, projection: Projection, documentSnapshot: any, projectId: string, local = false): SelectionPayload {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) throw new Error('请先在渲染正文中选择一段连续文字。')
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) throw new Error('选区须位于当前渲染正文中。')
  const a = point(root, range.startContainer, range.startOffset, 'start'), b = point(root, range.endContainer, range.endOffset, 'end')
  const from = mapLeafPoint(projection, a.leafId, a.offset, 'start'), to = mapLeafPoint(projection, b.leafId, b.offset, 'end')
  const validated = local ? validateProseRange(projection, from, to) : (() => { const range = validateRange(projection, from, to); return { ...range, blockIds: [range.block.id] } })()
  // Chromium inserts one or two visual newlines between paragraphs. Validate each leaf's
  // exact text, allowing only that DOM paragraph separator to differ from source spacing.
  const separators = (text: string) => text.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\n')
  if (separators(validated.renderedText) !== separators(selection.toString())) throw new Error('选区包含非正文内容，请重新选择普通段落。')
  // Display labels may use APA; authorization still uses the canonical citation-token
  // projection shared with Core. The actual DOM text was verified immediately above.
  const canonical=local?validateProseRange(projectMarkdown(projection.source),from,to):validateRange(projectMarkdown(projection.source),from,to)
  return { projectId, documentId: 'paper', documentHash: documentSnapshot.contentHash, revisionId: documentSnapshot.revisionId, blockIds: validated.blockIds,
    sourceRange: { startUtf16: from, endUtf16: to }, sourceText: projection.source.slice(from, to), renderedText: canonical.renderedText,
    prefixContext: projection.source.slice(Math.max(0, from - 200), from), suffixContext: projection.source.slice(to, to + 200),
    citationKeys: validated.citationKeys, claimIds: [], scope: 'inline', capturedAt: new Date().toISOString() }
}
