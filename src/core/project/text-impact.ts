import { parseMarkdown, projectMarkdown, textOf } from '../editing/markdown.ts'
import { digest } from '../store/files.ts'
import type { Ledger } from '../../shared/schema.ts'

// This is a literal, positioned preview, not a semantic claim that all dependent
// passages were found. Unstructured terminology explicitly requests full review.
export function projectTextImpact(ledger: Ledger, manuscript: string, path: string, before: string, after: string) {
  const changed = before !== after, decision = path.endsWith('/decisions.md'), terminology = path.endsWith('/terminology.md')
  const paragraphText = (text: string) => projectMarkdown(text).blocks.map(block => textOf(block.node).normalize('NFC').trim())
  const old = paragraphText(before), next = paragraphText(after), differences = [...old.filter(text => !next.includes(text)), ...next.filter(text => !old.includes(text))]
  const terms = terminology ? [...new Set(differences.flatMap(text => {
    const mapping = text.split(/\s*(?:→|->|=>|：|:|=)\s*/u)
    return mapping.length === 2 && mapping.every(term => term.length >= 1 && term.length <= 80) ? mapping : []
  }))] : []
  const broad = !terminology || differences.length > 0 && !terms.length
  const headings = (parseMarkdown(manuscript).children ?? []).filter(node => node.type === 'heading').map(node => ({
    title: textOf(node).normalize('NFC').trim(), start: node.position!.start.offset!, end: node.position!.end.offset!, depth: node.depth! }))
  const sections = changed ? ledger.outline.sections.flatMap(section => {
    const matches = headings.filter(heading => heading.title === section.title.normalize('NFC').trim())
    if (matches.length !== 1) return broad ? [{ sectionId: section.id, title: section.title, matchedTerms: [], located: false }] : []
    const heading = matches[0], end = headings.find(row => row.start > heading.start && row.depth <= heading.depth)?.start ?? manuscript.length
    const literal = textOf(parseMarkdown(manuscript.slice(heading.end, end))).normalize('NFC')
    const matchedTerms = terms.filter(term => literal.includes(term))
    return broad || matchedTerms.length ? [{ sectionId: section.id, title: section.title, matchedTerms, located: true }] : []
  }) : []
  return { changed, documentHash: digest(manuscript), outlineNeedsConfirmation: changed && decision,
    checks: changed ? path.endsWith('/review.md') ? ['全部审查'] : decision ? ['论证', '术语', '贡献', '摘要与正文一致性'] : terminology ? ['术语', '摘要与正文一致性'] : ['文风'] : [],
    sections, terms, limitation: terminology ? '只匹配明确的术语映射和当前已保存正文；语义同义词、未定位章节与其他隐含依赖仍须人工检查。' : '提示按当前大纲列出影响范围；保留原稿，既有任务与审查不能沿用旧输入。' }
}
