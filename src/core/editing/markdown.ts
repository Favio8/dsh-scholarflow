import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { decodeString } from 'micromark-util-decode-string'
import { invariant } from '../../shared/errors.ts'
import type { SelectionPayload } from '../../shared/editing.ts'

export interface AstNode { type: string; value?: string; children?: AstNode[]; depth?: number; url?: string; alt?: string; ordered?: boolean;
  position?: { start: { offset?: number }; end: { offset?: number } }; leafIds?: string[]; blockId?: string }
export interface TextUnit { renderedStart: number; renderedEnd: number; sourceStart: number; sourceEnd: number }
export interface Leaf { id: string; blockId?: string; text: string; start: number; end: number; units: TextUnit[]; mappable: boolean; citationKeys?: string[] }
export interface Block { id: string; start: number; end: number; node: AstNode; editable: boolean }
export interface Projection { tree: AstNode; leaves: Leaf[]; blocks: Block[]; source: string; citationOrder: string[] }
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
const citationPattern = /\[@(sf_[a-zA-Z0-9_]+)(?:\s*;\s*@(sf_[a-zA-Z0-9_]+))*\]/g
const start = (node: AstNode) => node.position?.start.offset ?? -1
const end = (node: AstNode) => node.position?.end.offset ?? -1
export function parseMarkdown(source: string): AstNode {
  invariant(source.length <= 2 * 1024 * 1024, 'DOCUMENT_TOO_LARGE', 'Markdown 正文超过 2 Mi UTF-16 单元，请缩小文档后再执行结构化编辑。')
  const tree = parser.parse(source) as AstNode
  // micromark consumes the initial BOM without counting it in offsets. Our
  // contract uses positions in the unchanged UTF-16 manuscript, including BOM.
  if (source.startsWith('\uFEFF')) walk(tree, node => {
    if (node.position?.start.offset !== undefined) node.position.start.offset++
    if (node.position?.end.offset !== undefined) node.position.end.offset++
  })
  return tree
}
export function walk(node: AstNode, visit: (node: AstNode) => void) { visit(node); for (const child of node.children ?? []) walk(child, visit) }
// Literal AST text only: markers remain unverified until mapped to Sources.
export function citationMarkers(source: string, tree = parseMarkdown(source)) {
  const rows: { startUtf16: number; endUtf16: number; text: string; keys: string[]; kind: 'keyed' | 'numeric' }[] = []
  walk(tree, node => {
    if (node.type !== 'text' || node.position?.start.offset === undefined || node.position?.end.offset === undefined) return
    const start = node.position.start.offset, raw = source.slice(start, node.position.end.offset)
    for (const match of raw.matchAll(/\[@[\p{L}\p{N}_.:+-]{1,200}(?:\s*;\s*@[\p{L}\p{N}_.:+-]{1,200})*\]|\[\d{1,4}(?:\s*[,–-]\s*\d{1,4})*\]/gu)) {
      let backslashes = 0
      for (let index = match.index - 1; index >= 0 && raw[index] === '\\'; index--) backslashes++
      if (backslashes % 2) continue
      const text = match[0], keyed = text.startsWith('[@')
      rows.push({ startUtf16: start + match.index, endUtf16: start + match.index + text.length, text,
        kind: keyed ? 'keyed' : 'numeric', keys: keyed ? [...text.matchAll(/@([\p{L}\p{N}_.:+-]+)/gu)].map(item => item[1]) : [] })
    }
  })
  return rows
}
export function textOf(node: AstNode): string { return node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(textOf).join('') }
export function unicodeBoundary(text: string, offset: number) {
  return Number.isInteger(offset) && offset >= 0 && offset <= text.length && !(offset > 0 && offset < text.length &&
    text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff) &&
    !(offset > 0 && offset < text.length && text[offset - 1] === '\r' && text[offset] === '\n')
}

function decodeUnits(raw: string, value: string, base: number) {
  const units: TextUnit[] = []
  let rendered = '', offset = 0
  while (offset < raw.length) {
    const rest = raw.slice(offset)
    const escape = /^\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.exec(rest)
    const entity = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/.exec(rest)
    let token = escape?.[0] ?? entity?.[0] ?? (rest.startsWith('\r\n') ? '\r\n' : String.fromCodePoint(raw.codePointAt(offset)!))
    let decoded = token === '\r\n' || token === '\r' ? '\n' : decodeString(token)
    if (entity && decoded === token) { token = '&'; decoded = '&' }
    units.push({ renderedStart: rendered.length, renderedEnd: rendered.length + decoded.length, sourceStart: base + offset, sourceEnd: base + offset + token.length })
    rendered += decoded; offset += token.length
  }
  return { units, mappable: rendered === value }
}

export function projectMarkdown(source: string): Projection {
  const tree = parseMarkdown(source), leaves: Leaf[] = [], blocks: Block[] = [], citationOrder: string[] = []
  const addText = (node: AstNode, blockId?: string) => {
    const value = (node.value ?? '').replace(/\r\n|\r/g, '\n'), base = start(node), last = end(node)
    const mapped = decodeUnits(source.slice(base, last), value, base)
    const chunks: Array<{ from: number; to: number; text: string; citationKeys?: string[] }> = []
    let cursor = 0
    for (const match of value.matchAll(citationPattern)) {
      const from = match.index!, to = from + match[0].length
      const first = mapped.units.find(unit => unit.renderedStart === from), final = mapped.units.find(unit => unit.renderedEnd === to)
      if (!mapped.mappable || !first || !final || source.slice(first.sourceStart, final.sourceEnd) !== match[0]) continue
      if (from > cursor) chunks.push({ from: cursor, to: from, text: value.slice(cursor, from) })
      const keys = [...match[0].matchAll(/@(sf_[a-zA-Z0-9_]+)/g)].map(item => item[1])
      for (const key of keys) if (!citationOrder.includes(key)) citationOrder.push(key)
      chunks.push({ from, to, text: `[${keys.map(key => citationOrder.indexOf(key) + 1).join(', ')}]`, citationKeys: keys }); cursor = to
    }
    if (cursor < value.length) chunks.push({ from: cursor, to: value.length, text: value.slice(cursor) })
    node.leafIds = []
    for (const chunk of chunks) {
      const selected = mapped.units.filter(unit => unit.renderedStart >= chunk.from && unit.renderedEnd <= chunk.to)
      const first = selected[0]?.sourceStart ?? base, final = selected.at(-1)?.sourceEnd ?? last
      const leaf: Leaf = { id: `leaf_${first}_${final}_${leaves.length}`, blockId, text: chunk.text, start: first, end: final, mappable: mapped.mappable,
        units: chunk.citationKeys ? [{ renderedStart: 0, renderedEnd: chunk.text.length, sourceStart: first, sourceEnd: final }] : selected.map(unit => ({ ...unit, renderedStart: unit.renderedStart - chunk.from, renderedEnd: unit.renderedEnd - chunk.from })), ...(chunk.citationKeys && { citationKeys: chunk.citationKeys }) }
      leaves.push(leaf); node.leafIds.push(leaf.id)
    }
  }
  const visit = (node: AstNode, parentTypes: string[] = [], blockId?: string) => {
    if (node.type === 'paragraph') {
      node.blockId = `p_${start(node)}_${end(node)}`; blockId = node.blockId
      blocks.push({ id: blockId, start: start(node), end: end(node), node, editable: !parentTypes.some(type => ['table', 'tableCell', 'footnoteDefinition'].includes(type)) })
    }
    if (node.type === 'text') addText(node, blockId)
    for (const child of node.children ?? []) visit(child, [...parentTypes, node.type], blockId)
  }
  visit(tree)
  return { tree, leaves, blocks, source, citationOrder }
}
export function citationKeys(source: string) { return projectMarkdown(source).citationOrder }

export function mapLeafPoint(projection: Projection, leafId: string, renderedOffset: number, edge: 'start' | 'end') {
  const leaf = projection.leaves.find(item => item.id === leafId)
  invariant(leaf?.mappable && unicodeBoundary(leaf.text, renderedOffset), 'SELECTION_UNSUPPORTED', '此渲染位置不能安全对应源码，请使用完整段落或源码选择。')
  const unit = leaf.units.find(unit => edge === 'start' ? unit.renderedStart === renderedOffset : unit.renderedEnd === renderedOffset)
  if (renderedOffset === 0) return leaf.start
  if (renderedOffset === leaf.text.length) return leaf.end
  invariant(unit, 'SELECTION_UNSUPPORTED', '不能切开引用编号、转义字符、字符实体或 Unicode 字符。')
  return edge === 'start' ? unit.sourceStart : unit.sourceEnd
}

export function validateRange(projection: Projection, from: number, to: number, scope: 'inline' | 'paragraph' | 'section' = 'inline') {
  const { source } = projection
  invariant(to > from && unicodeBoundary(source, from) && unicodeBoundary(source, to), 'SELECTION_INVALID', '选区范围无效或切开 Unicode/CRLF 边界。')
  invariant(scope !== 'section', 'SELECTION_UNSUPPORTED', '当前渲染改写只支持单段连续选区；章节改写须另行展示范围。')
  const block = projection.blocks.find(block => block.start <= from && block.end >= to && block.editable)
  invariant(block, 'SELECTION_UNSUPPORTED', '选区必须位于单个普通段落内；跨段或表格请使用明确的源码范围。')
  if (scope === 'paragraph') invariant(from === block.start && to === block.end, 'SELECTION_INVALID', '段落范围必须与 AST 中的完整段落一致。')
  const overlapping = projection.leaves.filter(leaf => leaf.start < to && leaf.end > from)
  for (const marker of citationMarkers(source, projection.tree)) if ((marker.kind === 'numeric' || marker.keys.some(key => !/^sf_[a-zA-Z0-9_]+$/u.test(key))) && marker.startUtf16 < to && marker.endUtf16 > from)
    invariant(from <= marker.startUtf16 && to >= marker.endUtf16, 'SELECTION_UNSUPPORTED', '引用或未映射标记必须作为完整 token 选择，不能切开数字引用。')
  invariant(overlapping.length > 0, 'SELECTION_UNSUPPORTED', '选区没有可安全改写的自然语言文本。')
  if (scope === 'inline') invariant(overlapping.some(leaf => leaf.units.some(unit => unit.sourceStart === from)) &&
    overlapping.some(leaf => leaf.units.some(unit => unit.sourceEnd === to)), 'SELECTION_INVALID', '渲染选区边界必须对应真实文本或完整引用 token。')
  walk(block.node, node => {
    if (['inlineCode', 'inlineMath', 'image', 'html', 'break'].includes(node.type) && start(node) < to && end(node) > from)
      invariant(false, 'SELECTION_UNSUPPORTED', '公式、代码、图片、HTML 与显式换行节点不能作为自然语言改写选区。')
    if (['strong', 'emphasis', 'delete', 'link', 'linkReference'].includes(node.type) && start(node) < to && end(node) > from) {
      const containsNode = from <= start(node) && to >= end(node)
      const withinOneLeaf = overlapping.length === 1 && overlapping[0].start <= from && overlapping[0].end >= to
      invariant(containsNode || withinOneLeaf, 'SELECTION_UNSUPPORTED', '选区切开 Markdown 格式或链接边界，请明确选择完整段落。')
    }
  })
  for (const leaf of overlapping) {
    invariant(leaf.mappable, 'SELECTION_UNSUPPORTED', '该段渲染文本存在无法安全还原的源码映射。')
    invariant(!leaf.citationKeys || (from <= leaf.start && to >= leaf.end), 'SELECTION_UNSUPPORTED', '引用编号只能作为完整引用 token 选择。')
    for (const point of [from, to]) if (leaf.start < point && leaf.end > point)
      invariant(leaf.units.some(unit => unit.sourceStart === point || unit.sourceEnd === point), 'SELECTION_INVALID', '选区切开转义字符、实体或 Unicode 字符。')
  }
  const renderedText = overlapping.map(leaf => leaf.units.filter(unit => unit.sourceStart >= from && unit.sourceEnd <= to)
    .map(unit => leaf.text.slice(unit.renderedStart, unit.renderedEnd)).join('')).join('')
  return { block, renderedText, citationKeys: [...new Set(overlapping.flatMap(leaf => leaf.citationKeys ?? []))] }
}

/** Local co-writing may span adjacent prose paragraphs. Each paragraph retains the
 * same mapping and citation checks; this does not widen the native single-block card. */
export function validateProseRange(projection: Projection, from: number, to: number) {
  const blocks = projection.blocks.filter(block => block.start < to && block.end > from)
  if (blocks.length === 1) {
    const range = validateRange(projection, from, to, from === blocks[0].start && to === blocks[0].end ? 'paragraph' : 'inline')
    return { blockIds: [range.block.id], renderedText: range.renderedText, citationKeys: range.citationKeys }
  }
  const nodes = (projection.tree.children ?? []).filter(node => start(node) < to && end(node) > from)
  invariant(blocks.length && nodes.every(node => node.type === 'paragraph') && blocks.every(block => block.editable && block.node.type === 'paragraph'),
    'SELECTION_UNSUPPORTED', '跨段改写请只选择普通正文，不包含标题、表格、公式或代码。')
  const ranges = blocks.map(block => validateRange(projection, Math.max(from, block.start), Math.min(to, block.end),
    from <= block.start && to >= block.end ? 'paragraph' : 'inline'))
  return { blockIds: blocks.map(block => block.id), renderedText: ranges.map(range => range.renderedText).join('\n\n'),
    citationKeys: [...new Set(ranges.flatMap(range => range.citationKeys))] }
}

export function validateSelection(source: string, selection: SelectionPayload) {
  const { startUtf16: from, endUtf16: to } = selection.sourceRange
  const range = validateRange(projectMarkdown(source), from, to, selection.scope)
  invariant(source.slice(from, to) === selection.sourceText && range.renderedText === selection.renderedText &&
    selection.blockIds.length === 1 && selection.blockIds[0] === range.block.id && JSON.stringify(selection.citationKeys) === JSON.stringify(range.citationKeys),
    'SELECTION_INVALID', '源码、渲染文本、段落或引用映射不一致，请重新选择。')
  return range
}

export function wordStats(source: string) {
  const projection = projectMarkdown(source), tree = projection.tree, parts: string[] = []
  let referenceDepth: number | undefined
  for (const node of tree.children ?? []) {
    if (node.type === 'heading') {
      if (referenceDepth !== undefined && node.depth! <= referenceDepth) referenceDepth = undefined
      if (/^(?:参考文献|引用文献|references|bibliography)$/i.test(textOf(node).trim())) { referenceDepth = node.depth; continue }
    }
    if (referenceDepth !== undefined) continue
    const collect = (item: AstNode) => {
      if (['code', 'inlineCode', 'math', 'inlineMath', 'html', 'image', 'definition', 'footnoteDefinition'].includes(item.type)) return
      if (item.type === 'text') parts.push((item.leafIds ?? []).map(id => projection.leaves.find(leaf => leaf.id === id)!).filter(leaf => !leaf.citationKeys).map(leaf => leaf.text).join(''))
      for (const child of item.children ?? []) collect(child)
    }
    collect(node); parts.push('\n')
  }
  const prose = parts.join(' ')
  return { chineseCharacters: [...prose.matchAll(/\p{Script=Han}/gu)].length,
    westernWords: [...prose.matchAll(/[\p{Script=Latin}\p{N}]+(?:['’\-][\p{Script=Latin}\p{N}]+)*/gu)].length,
    countingPolicyId: 'sf-body-han-western-v1', detail: '正文与标题：汉字逐字符；西文含数字词元，撇号/连字符连接词算一个；排除参考文献、代码、公式、原始 HTML、图片、引用 token。' }
}
