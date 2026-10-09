import type { Ledger, ProjectConfig } from '../../shared/schema.ts'
import type { CoverSpec, TypographySpec } from '../../shared/writing-task.ts'
import { projectMarkdown, type AstNode } from '../editing/markdown.ts'
import { buildWord } from './word.ts'
import { layoutOf } from './layout.ts'
import { DEFAULT_TYPOGRAPHY } from './typography.ts'

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
 * Word export. The builder lives in `word.ts`; this stays the entry the delivery layer calls,
 * so a caller never has to know how the document is assembled.
 */
export async function wordDocument(text: string, config: ProjectConfig, ledger: Ledger,
  options: { typography?: TypographySpec; cover?: CoverSpec } = {}): Promise<Uint8Array> {
  return buildWord({ text, config, ledger, typography: options.typography ?? DEFAULT_TYPOGRAPHY, cover: options.cover,
    layout: layoutOf(options.typography ?? DEFAULT_TYPOGRAPHY, config.project.language) })
}
