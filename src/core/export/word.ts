import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType,
  ExternalHyperlink, PageNumber, Footer, LevelFormat, TableOfContents, BorderStyle, WidthType, VerticalAlign,
  type FileChild, type ISectionOptions, type ParagraphChild } from 'docx'
import type { AstNode, Projection } from '../editing/markdown.ts'
import { projectMarkdown, textOf } from '../editing/markdown.ts'
import type { CoverSpec, TypographySpec } from '../../shared/writing-task.ts'
import type { Ledger, ProjectConfig, Source } from '../../shared/schema.ts'
import { DEFAULT_TYPOGRAPHY, typographyToDocx } from './typography.ts'
import { scanDocument } from './scan.ts'
import { gbt7714Entry, plainEntry } from './citations.ts'
import { A4, THREE_LINE, firstLineIndentTwips, headingSizes, layoutOf, type LayoutSpec } from './layout.ts'

// The Word exporter. Structure comes from `scanDocument`, values from `typographyToDocx` and
// `layoutOf`; this file decides how a planned block becomes docx objects and nothing else.
//
// Two things here are easy to get wrong and were got wrong before. A heading must carry its
// own numbering configuration with every level explicitly decimal, or Word renders 二.4 for a
// second-level heading. And the cover belongs to its own section, so the body can start
// numbering at 1 while the cover carries no number at all.

const NUMBERING_REFERENCE = 'sf-heading'
const HEADING_LEVELS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
/** 参考文献、致谢、附录 each start a new page. */
const SECTION_HEADING = /^(?:参考文献|引用文献|references|bibliography|致谢|acknowledgements?|附录|appendix)$/i
/** Front matter that leads the body without a page break of its own. */
const MATTER_HEADING = /^(?:摘要|abstract|关键词|keywords)$/i
const TOC_THRESHOLD = 8

function numberingConfig() {
  // Nine levels, all decimal: `%1`, `%1.%2`, `%1.%2.%3`. Leaving any level to the default is
  // what produces a Chinese-numeral second level.
  return [{ reference: NUMBERING_REFERENCE, levels: Array.from({ length: 9 }, (_, index) => ({
    level: index, format: LevelFormat.DECIMAL,
    text: Array.from({ length: index + 1 }, (_, position) => `%${position + 1}`).join('.'),
    alignment: AlignmentType.START })) }]
}

const noBorders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } }

export interface WordInput {
  text: string
  config: ProjectConfig
  ledger: Ledger
  typography?: TypographySpec
  cover?: CoverSpec
  layout?: LayoutSpec
}

export async function buildWord(input: WordInput): Promise<Uint8Array> {
  const { config, ledger } = input
  const language = config.project.language
  const docx = typographyToDocx(input.typography)
  const layout = input.layout ?? layoutOf(input.typography ?? DEFAULT_TYPOGRAPHY, language)
  const projection: Projection = projectMarkdown(input.text)
  const plan = scanDocument(projection)
  const leaves = new Map(projection.leaves.map(leaf => [leaf.id, leaf]))
  const sources: Source[] = projection.citationOrder
    .map(key => Object.values(ledger.sources).find(row => row.citeKey === key))
    .filter((source): source is Source => !!source)
  const bodyPt = docx.sizeHalfPoints / 2
  const font = { ascii: docx.fonts.ascii, hAnsi: docx.fonts.hAnsi, eastAsia: docx.fonts.eastAsia, cs: docx.fonts.cs }
  const headingFont = { ascii: docx.fonts.ascii, hAnsi: docx.fonts.hAnsi, eastAsia: layout.headingFontZh, cs: docx.fonts.cs }
  const captionSize = Math.round(layout.captionSizePt * 2)
  const indent = firstLineIndentTwips(bodyPt, layout.firstLineIndentChars)
  const bodySpacing = { after: 0, line: docx.lineTwips, lineRule: 'auto' as const }
  const headingSize = (depth: number) => Math.round(headingSizes(bodyPt)[Math.max(1, Math.min(3, depth)) as 1 | 2 | 3] * 2)
  const wantsToc = layout.tableOfContents !== 'none' && plan.headings.length >= TOC_THRESHOLD

  const inline = (node: AstNode, style: { bold?: boolean; italics?: boolean; strike?: boolean; size?: number } = {}): ParagraphChild[] => {
    if (node.type === 'text') return [new TextRun({ text: (node.leafIds ?? []).map(id => leaves.get(id)!).filter(leaf => !leaf.citationKeys).map(leaf => leaf.text).join('') || node.value || '', font, ...style })]
    if (node.type === 'inlineMath') return [new TextRun({ text: `$${node.value ?? ''}$`, font, ...style })]
    if (node.type === 'inlineCode') return [new TextRun({ text: node.value ?? '', font: { ...font, ascii: 'Consolas', hAnsi: 'Consolas' }, ...style })]
    if (node.type === 'break') return [new TextRun({ break: 1 })]
    if (node.type === 'link' && node.url && !node.url.startsWith('#')) return [new ExternalHyperlink({ link: node.url,
      children: (node.children ?? []).flatMap(child => inline(child, style)) })]
    return (node.children ?? []).flatMap(child => inline(child, { ...style,
      ...(node.type === 'strong' && { bold: true }), ...(node.type === 'emphasis' && { italics: true }), ...(node.type === 'delete' && { strike: true }) }))
  }

  const heading = (text: string, depth: number, pageBreak: boolean): Paragraph => {
    const numbered = layout.headingNumbering === 'decimal' && depth <= 3
    return new Paragraph({ heading: HEADING_LEVELS[depth - 1], ...(numbered ? { numbering: { reference: NUMBERING_REFERENCE, level: depth - 1 } } : {}),
      ...(pageBreak ? { pageBreakBefore: true } : {}),
      alignment: depth === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: pageBreak ? 0 : depth === 1 ? 240 : 160, after: 120, line: docx.lineTwips, lineRule: 'auto' },
      children: [new TextRun({ text, font: headingFont, size: headingSize(depth), bold: depth <= 3 })] })
  }

  const caption = (text: string, above: boolean): Paragraph => new Paragraph({ alignment: AlignmentType.CENTER,
    spacing: { before: above ? 120 : 60, after: above ? 60 : 120, line: docx.lineTwips, lineRule: 'auto' },
    children: [new TextRun({ text, font, size: captionSize, bold: above })] })

  // A three-line table has a thick rule above and below and a thin one under the header
  // row; every other edge is explicitly switched off, including the table's own default
  // borders, or Word draws a full grid.
  const cellBorders = (row: number, rows: number) => {
    if (layout.tableStyle === 'grid') return undefined
    const thick = { style: BorderStyle.SINGLE, size: THREE_LINE.top }
    const thin = { style: BorderStyle.SINGLE, size: THREE_LINE.header }
    const none = { style: BorderStyle.NONE }
    if (row === 0) return { top: thick, bottom: thin, left: none, right: none }
    if (row === rows - 1) return { top: none, bottom: thick, left: none, right: none }
    return { top: none, bottom: none, left: none, right: none }
  }

  const table = (node: AstNode, captionText?: string): FileChild[] => {
    const rows = node.children ?? []
    const tableRows = rows.map((row, index) => new TableRow({ tableHeader: index === 0,
      children: (row.children ?? []).map(cell => new TableCell({ verticalAlign: VerticalAlign.CENTER, borders: cellBorders(index, rows.length),
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: bodySpacing, indent: { firstLine: 0 },
          children: inline(cell, { bold: index === 0 }) })] })) }))
    return [...(captionText ? [caption(captionText, true)] : []),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, alignment: AlignmentType.CENTER, borders: noBorders, rows: tableRows })]
  }

  const equation = (node: AstNode, number: number): FileChild => new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER, borders: noBorders, rows: [new TableRow({ children: [
      new TableCell({ width: { size: 567, type: WidthType.DXA }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ indent: { firstLine: 0 }, children: [] })] }),
      new TableCell({ borders: noBorders, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER,
        spacing: bodySpacing, indent: { firstLine: 0 }, children: [new TextRun({ text: `$$${node.value ?? ''}$$`, font, size: docx.sizeHalfPoints })] })] }),
      new TableCell({ width: { size: 567, type: WidthType.DXA }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: bodySpacing, indent: { firstLine: 0 },
          children: [new TextRun({ text: `(${number})`, font, size: docx.sizeHalfPoints })] })] })] })] })

  const children: FileChild[] = []
  let equations = 0, seenBodyHeading = false
  for (const block of plan.blocks) {
    if (block.role === 'title') continue
    if (block.role === 'heading') {
      const text = textOf(block.node).trim(), depth = Math.max(1, Math.min(6, block.depth ?? 1))
      // The first body heading starts a new page after the front matter; a references,
      // acknowledgement or appendix heading always does.
      const pageBreak = SECTION_HEADING.test(text) || (!seenBodyHeading && !MATTER_HEADING.test(text))
      children.push(heading(text, depth, pageBreak))
      if (!MATTER_HEADING.test(text)) seenBodyHeading = true
      continue
    }
    if (block.isCaption) continue
    switch (block.role) {
      case 'table': children.push(...table(block.node, block.caption)); break
      case 'figure': {
        // The exporter cannot yet copy image assets, so the reference is shown as text
        // rather than silently dropped or replaced with a placeholder.
        const image = block.node.type === 'image' ? block.node : (block.node.children ?? []).find(node => node.type === 'image')
        if (block.captionAbove && block.caption) children.push(caption(block.caption, true))
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: bodySpacing, indent: { firstLine: 0 },
          children: [new TextRun({ text: `${image?.alt ? `${image.alt}：` : ''}${image?.url ?? ''}`, font, italics: true })] }))
        if (!block.captionAbove && block.caption) children.push(caption(block.caption, false))
        break
      }
      case 'equation': children.push(equation(block.node, ++equations)); break
      case 'code': for (const line of (block.node.value ?? '').split(/\r?\n/)) children.push(new Paragraph({ spacing: bodySpacing,
        indent: { firstLine: 0 }, children: [new TextRun({ text: line, font: { ...font, ascii: 'Consolas', hAnsi: 'Consolas' }, size: docx.sizeHalfPoints - 4 })] })); break
      case 'list': children.push(...(block.node.children ?? []).flatMap((item, index) => (item.children ?? []).flatMap((child, childIndex) => {
        if (child.type !== 'paragraph' || childIndex) return [new Paragraph({ spacing: bodySpacing, indent: { left: 480 }, children: inline(child) })]
        return [new Paragraph({ spacing: bodySpacing, indent: { left: 480, firstLine: 0 },
          children: [new TextRun({ text: block.node.ordered ? `${index + ((block.node as AstNode & { start?: number }).start ?? 1)}. ` : '• ', font }), ...inline(child)] })]
      }))); break
      case 'quote': children.push(...(block.node.children ?? []).map(child => new Paragraph({ spacing: bodySpacing,
        indent: { left: 480, firstLine: 0 }, children: inline(child) }))); break
      case 'thematicBreak': children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: bodySpacing,
        children: [new TextRun({ text: '* * *', font })] })); break
      default: children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: bodySpacing, indent: { firstLine: indent },
        children: inline(block.node) }))
    }
  }
  if (sources.length) {
    children.push(heading(language === 'zh-CN' ? '参考文献' : 'References', 1, true))
    // GB/T 7714 hangs the entry two characters so the [n] markers line up; the plain style
    // has nothing to line up and stays flush.
    const gbt = layout.referenceStyle === 'gbt7714'
    sources.forEach((source, index) => children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: bodySpacing,
      ...(gbt ? { indent: { left: 480, hanging: 480 } } : {}),
      children: [new TextRun({ text: gbt ? gbt7714Entry(source, index + 1) : plainEntry(source, index + 1), font, size: docx.sizeHalfPoints })] })))
  }
  if (wantsToc) children.unshift(new TableOfContents(language === 'zh-CN' ? '目录' : 'Contents', { hyperlink: true, headingStyleRange: '1-3',
    cachedEntries: plan.headings.slice(0, 60).map(row => ({ title: row.text, level: Math.max(0, Math.min(2, row.depth - 1)) })), beginDirty: true }))

  const page = { size: { width: A4.width, height: A4.height }, margin: { top: A4.margin, bottom: A4.margin, left: A4.margin, right: A4.margin } }
  const bodySection: ISectionOptions = { properties: { page: { ...page, pageNumbers: { start: 1 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], font })] })] }) }, children }
  const cover = coverParagraphs(input.cover, docx, font, language)
  const document = new Document({ title: plan.title ?? config.project.title, creator: 'ScholarFlow',
    ...(wantsToc ? { features: { updateFields: true } } : {}),
    styles: { default: { document: { run: { font, size: docx.sizeHalfPoints }, paragraph: { spacing: bodySpacing } } } },
    numbering: { config: numberingConfig() },
    sections: cover.length ? [{ properties: { page }, children: cover }, bodySection] : [bodySection] })
  return new Uint8Array(await Packer.toBuffer(document))
}

// The cover carries only what the requirement stated, and nothing from a reference document
// (SPEC v1.2 §16.2). It is its own section so the body can number its pages from 1.
export function coverParagraphs(cover: CoverSpec | undefined, docx: ReturnType<typeof typographyToDocx>, font: { ascii: string; hAnsi: string; eastAsia: string; cs: string },
  language: 'zh-CN' | 'en'): FileChild[] {
  if (!cover?.enabled) return []
  const run = (text: string, options: { bold?: boolean; size?: number } = {}) => new TextRun({ text, font,
    size: options.size ?? docx.sizeHalfPoints, ...(options.bold && { bold: true }) })
  const children: FileChild[] = []
  for (let index = 0; index < 4; index++) children.push(new Paragraph({ children: [run('')], spacing: { after: 240 } }))
  const title = cover.title.trim()
  if (title) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480, line: docx.lineTwips, lineRule: 'auto' },
    children: [run(title, { bold: true, size: Math.round(docx.sizeHalfPoints * 1.6) })] }))
  for (const field of cover.fields) {
    if (!field.value.trim()) continue
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200, line: docx.lineTwips, lineRule: 'auto' },
      children: [run(language === 'zh-CN' ? `${field.label}：${field.value}` : `${field.label}: ${field.value}`)] }))
  }
  if (cover.date.trim()) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200, line: docx.lineTwips, lineRule: 'auto' },
    children: [run(cover.date.trim())] }))
  return children
}
