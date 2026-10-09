import type { AstNode, Projection } from '../editing/markdown.ts'
import { textOf } from '../editing/markdown.ts'

// One pass over the parsed manuscript that decides what each block *is* for layout: a
// heading, a caption that belongs to the table above it, a block formula, prose. Both the
// Word and the LaTeX exporter read this plan, so a figure numbered (3) in one is numbered
// (3) in the other.
//
// Everything here comes from the AST that `projectMarkdown` already produced. Roles are
// decided by comparing one node's whole text against a controlled list — never by running a
// pattern over the document — because the manuscript is the only source of truth and a
// mis-read sentence must not silently become a caption.

export type BlockRole = 'title' | 'heading' | 'paragraph' | 'table' | 'figure' | 'equation' | 'code' | 'list' | 'quote' | 'thematicBreak'

export interface PlannedBlock {
  node: AstNode
  role: BlockRole
  /** Heading depth, 1–6, for `heading` and `title`. */
  depth?: number
  /** The caption text as the manuscript wrote it, when this block has one. */
  caption?: string
  /** True when this block *is* the caption paragraph of an adjacent table or figure. */
  isCaption?: boolean
  /** True for a table whose caption sits above it, a figure whose caption sits below. */
  captionAbove?: boolean
}

export interface DocumentPlan {
  blocks: PlannedBlock[]
  /** The document title: the first level-1 heading, which the exporter does not repeat. */
  title?: string
  /** Headings in document order, for the table of contents. */
  headings: { text: string; depth: number }[]
  /** How many block formulas the document has; equation numbers follow this order. */
  equationCount: number
  /** True when a heading names the references section, so the exporter does not add another. */
  hasReferencesHeading: boolean
  /** Anything the reader should know about what the layout did and did not do. */
  formatNotes: string[]
}

/** A caption the manuscript wrote itself, e.g. `表 2-1 符号说明` or `图 3-1 系统架构`. */
const CAPTION = /^[图表]\s*\d+(?:[-–—]\d+)?\s+\S/u
/** Headings that name front or back matter, matched on the whole heading text. */
const MATTER_HEADING = /^(?:摘要|abstract|关键词|keywords|致谢|acknowledgements?|附录|appendix|目录|contents|书目信息)$/i
const REFERENCE_HEADING = /^(?:参考文献|引用文献|references|bibliography)$/i

export function isCaptionText(text: string): boolean { return CAPTION.test(text.trim()) }

/** A figure is an image, or a paragraph whose only content is one. */
function imageOf(node: AstNode): AstNode | undefined {
  if (node.type === 'image') return node
  const children = node.children ?? []
  return node.type === 'paragraph' && children.length === 1 && children[0]!.type === 'image' ? children[0] : undefined
}

function roleOf(node: AstNode): BlockRole {
  if (imageOf(node)) return 'figure'
  switch (node.type) {
    case 'heading': return 'heading'
    case 'table': return 'table'
    case 'math': return 'equation'
    case 'code': return 'code'
    case 'list': return 'list'
    case 'blockquote': return 'quote'
    case 'thematicBreak': return 'thematicBreak'
    default: return 'paragraph'
  }
}

/**
 * Reads the manuscript into a layout plan. `options.bodyOnly` is not needed here: the
 * exporter renders whatever the manuscript contains, front matter included.
 */
export function scanDocument(projection: Projection): DocumentPlan {
  const nodes = projection.tree.children ?? []
  const formatNotes: string[] = []
  let title: string | undefined, equationCount = 0, hasReferencesHeading = false
  const headings: { text: string; depth: number }[] = []
  const captionFor = new Map<number, { text: string; above: boolean }>()

  // A caption belongs to the table above it or the figure below it. Only an immediate
  // neighbour counts, so a sentence that merely starts with 图 1-1 halfway down the page
  // stays prose — and so does a caption with nothing to caption, because dropping text the
  // author wrote would lose it.
  // A table caption sits above its table and a figure caption below its figure, so the
  // neighbour to look at is the next node for a table and the previous one for a figure.
  nodes.forEach((node, index) => {
    if (node.type !== 'paragraph') return
    const text = textOf(node).trim()
    if (!isCaptionText(text)) return
    const previous = nodes[index - 1], next = nodes[index + 1]
    if (next?.type === 'table') captionFor.set(index + 1, { text, above: true })
    else if (previous && imageOf(previous)) captionFor.set(index - 1, { text, above: false })
  })
  // The paragraphs taken as a caption are already carried by their table or figure.
  const consumed = new Set<number>()
  for (const [index, caption] of captionFor) consumed.add(caption.above ? index - 1 : index + 1)

  const blocks: PlannedBlock[] = []
  nodes.forEach((node, index) => {
    const role = roleOf(node)
    if (role === 'heading') {
      const text = textOf(node).trim(), depth = node.depth ?? 1
      if (title === undefined && depth === 1) { title = text; blocks.push({ node, role: 'title', depth }); return }
      if (REFERENCE_HEADING.test(text)) hasReferencesHeading = true
      headings.push({ text, depth })
      blocks.push({ node, role: 'heading', depth })
      return
    }
    if (role === 'equation') { equationCount++; blocks.push({ node, role }); return }
    const caption = captionFor.get(index)
    if (caption) { blocks.push({ node, role, caption: caption.text, captionAbove: caption.above }); return }
    if (consumed.has(index)) return
    blocks.push({ node, role })
  })

  if (title === undefined) formatNotes.push('主稿没有一级标题，文档标题留空；封面标题以作业要求为准。')
  const unnumbered = blocks.filter(block => block.role === 'figure' || block.role === 'table')
    .filter(block => !block.caption)
  if (unnumbered.length) formatNotes.push(`有 ${unnumbered.length} 个图／表没有在主稿中写题注，按原样导出，未自动补编号。`)
  if (equationCount) formatNotes.push(`公式编号按文档顺序生成为 (1)–(${equationCount})；Word 与 LaTeX 使用同一顺序。`)
  if (hasReferencesHeading) formatNotes.push('主稿已含参考文献标题，导出不重复添加。')
  return { blocks, title, headings, equationCount, hasReferencesHeading, formatNotes }
}

/** True when a heading names front or back matter, which never counts toward the body. */
export function isMatterHeading(text: string): boolean { return MATTER_HEADING.test(text.trim()) }
