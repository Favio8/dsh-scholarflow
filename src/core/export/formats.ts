import { scanDocument } from './scan.ts'
import { gbt7714Entry } from './citations.ts'
import { layoutOf } from './layout.ts'
import { DEFAULT_TYPOGRAPHY } from './typography.ts'
import type { Ledger, ProjectConfig, Source } from '../../shared/schema.ts'
import type { CoverSpec, TypographySpec } from '../../shared/writing-task.ts'
import { projectMarkdown, type AstNode } from '../editing/markdown.ts'
import { buildWord } from './word.ts'
import {apaLabels,apaReferences} from './apa.ts'
import type {ExportImage} from './images.ts'
import {citationPresentation} from './citation-groups.ts'

const texEscapes: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%',
  '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
}
const texEscape = (text: string): string => text.replace(/[\\{}$&#%_^~]/g, char => texEscapes[char]!)

/**
 * LaTeX export. The Word exporter and this one read the same `scanDocument` plan, so a figure
 * numbered (3) in one is (3) in the other, and both report what they could not do.
 *
 * Stated capability boundary: a full GB/T 7714 bibliography needs the `gbt7714` or `biblatex`
 * package, which this plugin does not introduce. The reference list here is hand-written
 * `thebibliography` with an approximate hanging indent, and that is what the notes say.
 */
export function latexDocument(text: string, config: ProjectConfig, ledger?: Ledger, typography?: TypographySpec,images:ExportImage[] = []) {
  const projection = projectMarkdown(text), leaves = new Map(projection.leaves.map(leaf => [leaf.id, leaf]))
  const plan = scanDocument(projection)
  const layout = layoutOf(typography ?? DEFAULT_TYPOGRAPHY, config.project.language)
  const captionOf = new Map(plan.blocks.map(block => [block.node, block]))
  const firstTitle = projection.tree.children?.find(node => node.type === 'heading' && node.depth === 1)
  const presentation=citationPresentation(text,ledger??{sources:{}},layout.referenceStyle)
  const sources=presentation.sources,apa=layout.referenceStyle==='apa7',labels=presentation.labels
  const render = (node: AstNode): string => {
    const children = () => (node.children ?? []).map(render).join('')
    switch (node.type) {
      case 'root': return children()
      case 'text': return node.leafIds?.map(id => { const leaf = leaves.get(id)!; return leaf.citationKeys
        ? apa?texEscape(labels?.[leaf.citationKeys.join(';')]??leaf.text):`\\cite{${[...new Set(leaf.citationKeys.map(key=>presentation.keyMap[key]??key))].join(',')}}` : texEscape(leaf.text) }).join('') ?? texEscape(node.value ?? '')
      case 'image': return `\\includegraphics[width=\\linewidth,height=.8\\textheight,keepaspectratio]{${texEscape(node.url??'')}}`
      case 'imageReference': {const definition=projection.tree.children?.find(row=>row.type==='definition'&&row.identifier===node.identifier);return definition?`\\includegraphics[width=\\linewidth,height=.8\\textheight,keepaspectratio]{${texEscape(definition.url??'')}}`:''}
      case 'paragraph': return children() + '\n\n'
      case 'heading': return node === firstTitle ? `\\title{${children()}}\\date{}\\maketitle\n\n`
        : `\\${['section', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'][Math.min(5, (node.depth ?? 1) - 1)]}{${children()}}\n\n`
      case 'strong': return `\\textbf{${children()}}`
      case 'emphasis': return `\\emph{${children()}}`
      case 'delete': return `\\sout{${children()}}`
      case 'inlineMath': return `$${node.value ?? ''}$`
      case 'math': return `\\begin{equation}\n${node.value ?? ''}\n\\end{equation}\n\n`
      case 'inlineCode': return `\\texttt{${texEscape(node.value ?? '')}}`
      case 'code': return `\\begin{quote}\\ttfamily\n${texEscape(node.value ?? '').replace(/\n/g, '\\\\\n')}\n\\end{quote}\n\n`
      case 'blockquote': return `\\begin{quote}\n${children()}\\end{quote}\n\n`
      case 'list': { const kind = node.ordered ? 'enumerate' : 'itemize'; return `\\begin{${kind}}\n${children()}\\end{${kind}}\n\n` }
      case 'listItem': return '\\item ' + children() + '\n'
      case 'link': return node.url?.startsWith('#') ? children() : `\\href{${texEscape(node.url ?? '')}}{${children()}}`
      case 'break': return '\\\\\n'
      case 'thematicBreak': return '\\par\\noindent\\rule{\\linewidth}{0.4pt}\n\n'
      case 'table': {
        const planned = captionOf.get(node)
        const rows = node.children ?? []
        const columns = Math.max(1, ...rows.map(row => row.children?.length ?? 0))
        const caption = planned?.caption ? `\\caption{${texEscape(planned.caption)}}\n` : ''
        // The header row is rendered on its own so the rule under it can go in the right
        // place: a thin one for a three-line table, a full one for a grid.
        const header = rows[0] ? render(rows[0]!) : ''
        const rest = rows.slice(1).map(render).join('')
        const under = layout.tableStyle === 'grid' ? '\\hline' : '\\midrule'
        return `\\begin{table}[htbp]\n\\centering\n${caption}\\begin{tabular}{${'l'.repeat(columns)}}\n\\toprule\n${header}${under}\n${rest}\\bottomrule\n\\end{tabular}\n\\end{table}\n\n` }
      case 'tableRow': return (node.children ?? []).map(render).join(' & ') + ' \\\\\n'
      case 'tableCell': return children()
      case 'definition': return ''
      default: return children() || texEscape(node.value ?? '')
    }
  }
  // The plan already carries each block once: the title, the body, and every table or figure
  // with the caption the manuscript wrote for it. A caption paragraph that was taken up by a
  // table is not in the list, so it cannot be printed twice.
  const body = plan.blocks.map(block => render(block.node)).join('')
  const chinese = config.project.language === 'zh-CN'
  const bibliography = apa&&sources.length?['\\section*{'+(chinese?'参考文献':'References')+'}',...apaReferences(sources).map(([,entry])=>'\\noindent '+texEscape(entry)+'\\par\\medskip')]:layout.referenceStyle === 'gbt7714' && sources.length
    ? ['\\begin{thebibliography}{9}', ...sources.map((source, index) => `\\bibitem{${source.citeKey}} ${texEscape(gbt7714Entry(source, index + 1).replace(/^\[\d+\]\s/u,''))}`), '\\end{thebibliography}']
    : projection.citationOrder.length ? ['\\bibliographystyle{unsrt}', '\\bibliography{references}'] : []
  return [
    chinese ? '\\documentclass[UTF8,a4paper,12pt]{ctexart}' : '\\documentclass[a4paper,12pt]{article}',
    `\\usepackage[margin=${typography?.marginsMm??25}mm]{geometry}`, '\\usepackage{amsmath,amssymb}', '\\usepackage[normalem]{ulem}',
    '\\usepackage{booktabs}', '\\usepackage{caption}', '\\usepackage{fancyhdr}', '\\usepackage{titlesec}',
    '\\usepackage{longtable}',...(images.length?['\\usepackage{graphicx}']:[]),
    ...(chinese ? ['\\pagestyle{fancy}\\fancyhf{}\\fancyfoot[C]{\\thepage}'] : []),
    ...(layout.headingNumbering === 'none' ? ['\\setcounter{secnumdepth}{0}'] : ['\\setcounter{secnumdepth}{3}']),
    ...(layout.headingNumbering === 'chinese' && chinese ? ['\\renewcommand{\\thesection}{\\zhnum{section}}'] : []),
    '\\usepackage{hyperref}', '\\begin{document}', body, ...bibliography, '\\end{document}', '',
  ].join('\n')
}

/**
 * Word export. The builder lives in `word.ts`; this stays the entry the delivery layer calls,
 * so a caller never has to know how the document is assembled.
 */
export async function wordDocument(text: string, config: ProjectConfig, ledger: Ledger,
  options: { typography?: TypographySpec; cover?: CoverSpec;images?:ExportImage[] } = {}): Promise<Uint8Array> {
  return buildWord({ text, config, ledger, typography: options.typography ?? DEFAULT_TYPOGRAPHY, cover: options.cover,
    layout: layoutOf(options.typography ?? DEFAULT_TYPOGRAPHY, config.project.language),images:options.images })
}
