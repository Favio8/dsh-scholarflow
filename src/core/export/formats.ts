import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, ExternalHyperlink, PageBreak,
  type ParagraphChild, type FileChild } from 'docx'
import { projectMarkdown, type AstNode } from '../editing/markdown.ts'
import type { Ledger, ProjectConfig } from '../../shared/schema.ts'
import type { CoverSpec, TypographySpec } from '../../shared/writing-task.ts'
import { A4_TWIPS, DEFAULT_TYPOGRAPHY, typographyToDocx } from './typography.ts'

const texEscapes: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%',
  '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
}
const texEscape = (text: string): string => text.replace(/[\\{}$&#%_^~]/g, char => texEscapes[char]!)

export function latexDocument(text: string, config: ProjectConfig) {
  const projection = projectMarkdown(text), leaves = new Map(projection.leaves.map(leaf => [leaf.id, leaf]))
  const firstTitle = projection.tree.children?.find(node => node.type === 'heading' && node.depth === 1)
  const render = (node: AstNode): string => {
    const children = () => (node.children ?? []).map(render).join('')
    switch (node.type) {
      case 'root': return children()
      case 'text': return node.leafIds?.map(id => { const leaf = leaves.get(id)!; return leaf.citationKeys
        ? `\\cite{${leaf.citationKeys.join(',')}}` : texEscape(leaf.text) }).join('') ?? texEscape(node.value ?? '')
      case 'paragraph': return children() + '\n\n'
      case 'heading': return node === firstTitle ? `\\title{${children()}}\\date{}\\maketitle\n\n`
        : `\\${['section', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'][Math.min(5, (node.depth ?? 1) - 1)]}{${children()}}\n\n`
      case 'strong': return `\\textbf{${children()}}`
      case 'emphasis': return `\\emph{${children()}}`
      case 'delete': return `\\sout{${children()}}`
      case 'inlineMath': return `$${node.value ?? ''}$`
      case 'math': return `\\[\n${node.value ?? ''}\n\\]\n\n`
      case 'inlineCode': return `\\texttt{${texEscape(node.value ?? '')}}`
      case 'code': return `\\begin{quote}\\ttfamily\n${texEscape(node.value ?? '').replace(/\n/g, '\\\\\n')}\n\\end{quote}\n\n`
      case 'blockquote': return `\\begin{quote}\n${children()}\\end{quote}\n\n`
      case 'list': { const kind = node.ordered ? 'enumerate' : 'itemize'; return `\\begin{${kind}}\n${children()}\\end{${kind}}\n\n` }
      case 'listItem': return '\\item ' + children() + '\n'
      case 'link': return node.url?.startsWith('#') ? children() : `\\href{${texEscape(node.url ?? '')}}{${children()}}`
      case 'break': return '\\\\\n'
      case 'thematicBreak': return '\\par\\noindent\\rule{\\linewidth}{0.4pt}\n\n'
      case 'table': { const columns = Math.max(1, ...node.children!.map(row => row.children?.length ?? 0));
        return `\\begin{center}\n\\begin{tabular}{${'l'.repeat(columns)}}\n\\hline\n${children()}\\hline\n\\end{tabular}\n\\end{center}\n\n` }
      case 'tableRow': return (node.children ?? []).map(render).join(' & ') + ' \\\\\n'
      case 'tableCell': return children()
      case 'definition': return ''
      default: return children() || texEscape(node.value ?? '')
    }
  }
  const body = render(projection.tree)
  return [config.project.language === 'zh-CN' ? '\\documentclass[UTF8,a4paper,12pt]{ctexart}' : '\\documentclass[a4paper,12pt]{article}',
    '\\usepackage[margin=25mm]{geometry}', '\\usepackage{amsmath,amssymb}', '\\usepackage[normalem]{ulem}',
    '\\usepackage{hyperref}', '\\begin{document}', body,
    ...(projection.citationOrder.length ? ['\\bibliographystyle{unsrt}', '\\bibliography{references}'] : []), '\\end{document}', ''].join('\n')
}

/**
 * The cover is its own page (SPEC v1.2 §16.2). It carries only fields the requirement asked
 * for: nothing from a reference document, and no date the requirement never stated.
 */
export function coverParagraphs(cover: CoverSpec, typography: TypographySpec, language: ProjectConfig['project']['language']): FileChild[] {
  if (!cover.enabled) return []
  const docx = typographyToDocx(typography)
  const run = (text: string, options: { bold?: boolean; size?: number } = {}) => new TextRun({ text,
    font: { ascii: docx.fonts.ascii, hAnsi: docx.fonts.hAnsi, eastAsia: docx.fonts.eastAsia },
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
  if (cover.date.trim()) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200, line: docx.lineTwips, lineRule: 'auto' }, children: [run(cover.date.trim())] }))
  children.push(new Paragraph({ children: [new PageBreak()] }))
  return children
}

export async function wordDocument(text: string, config: ProjectConfig, ledger: Ledger,
  options: { typography?: TypographySpec; cover?: CoverSpec } = {}): Promise<Uint8Array> {
  const typography = options.typography ?? DEFAULT_TYPOGRAPHY
  // 中文 and 西文 are separate font slots: setting one `font` leaves Times New Roman runs to
  // fall back to the theme and Chinese runs to the latin face, which is what the reported
  // failure looked like.
  const docx = typographyToDocx(typography)
  const font = { ascii: docx.fonts.ascii, hAnsi: docx.fonts.hAnsi, eastAsia: docx.fonts.eastAsia, cs: docx.fonts.cs }
  const bodySpacing = { after: 160, line: docx.lineTwips, lineRule: 'auto' as const }
  const projection = projectMarkdown(text), leaves = new Map(projection.leaves.map(leaf => [leaf.id, leaf]))
  const inline = (node: AstNode, style: { bold?: boolean; italics?: boolean; strike?: boolean } = {}): ParagraphChild[] => {
    if (node.type === 'text') return [new TextRun({ text: node.leafIds?.map(id => leaves.get(id)!.text).join('') ?? node.value ?? '', font, ...style })]
    if (node.type === 'inlineMath') return [new TextRun({ text: `$${node.value ?? ''}$`, font, ...style })]
    if (node.type === 'inlineCode') return [new TextRun({ text: node.value ?? '', ...style, font: { ...font, ascii: 'Consolas', hAnsi: 'Consolas' } })]
    if (node.type === 'break') return [new TextRun({ break: 1 })]
    if (node.type === 'link' && node.url && !node.url.startsWith('#')) return [new ExternalHyperlink({ link: node.url, children: (node.children ?? []).flatMap(child => inline(child, style)) })]
    return (node.children ?? []).flatMap(child => inline(child, { ...style,
      ...(node.type === 'strong' && { bold: true }), ...(node.type === 'emphasis' && { italics: true }), ...(node.type === 'delete' && { strike: true }) }))
  }
  const blocks = (node: AstNode, indent = 0): FileChild[] => {
    switch (node.type) {
      case 'root': return (node.children ?? []).flatMap(child => blocks(child))
      case 'heading': return [new Paragraph({ children: inline(node), spacing: bodySpacing,
        heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(5, (node.depth ?? 1) - 1)] })]
      case 'paragraph': return [new Paragraph({ children: inline(node), spacing: bodySpacing, ...(indent && { indent: { left: indent } }) })]
      case 'math': return [new Paragraph({ children: [new TextRun({ text: `$$${node.value ?? ''}$$`, font })], alignment: AlignmentType.CENTER, spacing: bodySpacing })]
      case 'code': return (node.value ?? '').split(/\r?\n/).map(line => new Paragraph({ children: [new TextRun({ text: line, font: { ...font, ascii: 'Consolas', hAnsi: 'Consolas' }, size: docx.sizeHalfPoints - 4 })], spacing: bodySpacing }))
      case 'blockquote': return (node.children ?? []).flatMap(child => blocks(child, indent + 360))
      case 'list': return (node.children ?? []).flatMap((item, index) => (item.children ?? []).flatMap((child, childIndex) => {
        if (child.type !== 'paragraph' || childIndex) return blocks(child, indent + 360)
        return [new Paragraph({ children: [new TextRun({ text: node.ordered ? `${index + ((node as any).start ?? 1)}. ` : '• ', font }), ...inline(child)],
          indent: { left: indent + 360 }, spacing: bodySpacing })]
      }))
      case 'table': return [new Table({ rows: (node.children ?? []).map((row, index) => new TableRow({ children: (row.children ?? []).map(cell =>
        new TableCell({ children: [new Paragraph({ children: inline(cell, { bold: index === 0 }), spacing: bodySpacing })] })) })) })]
      case 'thematicBreak': return [new Paragraph({ text: '────────────────────' })]
      case 'definition': return []
      default: return (node.children ?? []).flatMap(child => blocks(child, indent))
    }
  }
  const children = blocks(projection.tree)
  if (projection.citationOrder.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: config.project.language === 'zh-CN' ? '参考文献' : 'References', font })], heading: HeadingLevel.HEADING_1, spacing: bodySpacing }))
    projection.citationOrder.forEach((key, index) => {
      const source = Object.values(ledger.sources).find(row => row.citeKey === key)!
      const authors = source.authors.map(author => author.literal ?? [author.given, author.family].filter(Boolean).join(' ')).join(', ')
      children.push(new Paragraph({ children: [new TextRun({ text: `[${index + 1}] ${[authors, source.title, source.venue, source.year, source.identifiers.doi ?? source.identifiers.url].filter(Boolean).join('. ')}`, font })], spacing: bodySpacing }))
    })
  }
  const document = new Document({ title: config.project.title,
    styles: { default: { document: { run: { font, size: docx.sizeHalfPoints }, paragraph: { spacing: bodySpacing } } } },
    sections: [{ properties: { page: { size: { width: A4_TWIPS.width, height: A4_TWIPS.height },
      margin: { top: docx.marginTwips, bottom: docx.marginTwips, left: docx.marginTwips, right: docx.marginTwips } } },
      ...(options.cover?.enabled ? { children: [...coverParagraphs(options.cover, typography, config.project.language), ...children] } : { children }) }] })
  return new Uint8Array(await Packer.toBuffer(document))
}
