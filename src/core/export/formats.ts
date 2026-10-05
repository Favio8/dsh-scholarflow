import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, ExternalHyperlink,
  type ParagraphChild, type FileChild } from 'docx'
import { projectMarkdown, type AstNode } from '../editing/markdown.ts'
import type { Ledger, ProjectConfig } from '../../shared/schema.ts'

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

export async function wordDocument(text: string, config: ProjectConfig, ledger: Ledger): Promise<Uint8Array> {
  const projection = projectMarkdown(text), leaves = new Map(projection.leaves.map(leaf => [leaf.id, leaf]))
  const inline = (node: AstNode, style: { bold?: boolean; italics?: boolean; strike?: boolean; font?: string } = {}): ParagraphChild[] => {
    if (node.type === 'text') return [new TextRun({ text: node.leafIds?.map(id => leaves.get(id)!.text).join('') ?? node.value ?? '', ...style })]
    if (node.type === 'inlineMath') return [new TextRun({ text: `$${node.value ?? ''}$`, ...style })]
    if (node.type === 'inlineCode') return [new TextRun({ text: node.value ?? '', ...style, font: 'Consolas' })]
    if (node.type === 'break') return [new TextRun({ break: 1 })]
    if (node.type === 'link' && node.url && !node.url.startsWith('#')) return [new ExternalHyperlink({ link: node.url, children: (node.children ?? []).flatMap(child => inline(child, style)) })]
    return (node.children ?? []).flatMap(child => inline(child, { ...style,
      ...(node.type === 'strong' && { bold: true }), ...(node.type === 'emphasis' && { italics: true }), ...(node.type === 'delete' && { strike: true }) }))
  }
  const blocks = (node: AstNode, indent = 0): FileChild[] => {
    switch (node.type) {
      case 'root': return (node.children ?? []).flatMap(child => blocks(child))
      case 'heading': return [new Paragraph({ children: inline(node), heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(5, (node.depth ?? 1) - 1)] })]
      case 'paragraph': return [new Paragraph({ children: inline(node), spacing: { after: 160, line: 360 }, ...(indent && { indent: { left: indent } }) })]
      case 'math': return [new Paragraph({ children: [new TextRun(`$$${node.value ?? ''}$$`)], alignment: AlignmentType.CENTER })]
      case 'code': return (node.value ?? '').split(/\r?\n/).map(line => new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 20 })] }))
      case 'blockquote': return (node.children ?? []).flatMap(child => blocks(child, indent + 360))
      case 'list': return (node.children ?? []).flatMap((item, index) => (item.children ?? []).flatMap((child, childIndex) => {
        if (child.type !== 'paragraph' || childIndex) return blocks(child, indent + 360)
        return [new Paragraph({ children: [new TextRun(node.ordered ? `${index + ((node as any).start ?? 1)}. ` : '• '), ...inline(child)], indent: { left: indent + 360 }, spacing: { after: 120 } })]
      }))
      case 'table': return [new Table({ rows: (node.children ?? []).map((row, index) => new TableRow({ children: (row.children ?? []).map(cell =>
        new TableCell({ children: [new Paragraph({ children: inline(cell, { bold: index === 0 }) })] })) })) })]
      case 'thematicBreak': return [new Paragraph({ text: '────────────────────' })]
      case 'definition': return []
      default: return (node.children ?? []).flatMap(child => blocks(child, indent))
    }
  }
  const children = blocks(projection.tree)
  if (projection.citationOrder.length) {
    children.push(new Paragraph({ text: config.project.language === 'zh-CN' ? '参考文献' : 'References', heading: HeadingLevel.HEADING_1 }))
    projection.citationOrder.forEach((key, index) => {
      const source = Object.values(ledger.sources).find(row => row.citeKey === key)!
      const authors = source.authors.map(author => author.literal ?? [author.given, author.family].filter(Boolean).join(' ')).join(', ')
      children.push(new Paragraph({ text: `[${index + 1}] ${[authors, source.title, source.venue, source.year, source.identifiers.doi ?? source.identifiers.url].filter(Boolean).join('. ')}`, spacing: { after: 120 } }))
    })
  }
  const document = new Document({ title: config.project.title, styles: { default: { document: { run: { font: config.project.language === 'zh-CN' ? '宋体' : 'Times New Roman', size: 24 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1417, bottom: 1417, left: 1417, right: 1417 } } }, children }] })
  return new Uint8Array(await Packer.toBuffer(document))
}
