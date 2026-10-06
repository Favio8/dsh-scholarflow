import type { Ledger } from '../../shared/schema.ts'
import { projectMarkdown, citationMarkers } from '../editing/markdown.ts'
import { invariant } from '../../shared/errors.ts'
import { normalizeArxiv } from '../research/source-matching.ts'

// The BibTeX entry is written here rather than through a formatter: the one previously
// used dropped every non-ASCII character, so a Chinese title arrived as its Latin
// fragment alone. Fields are limited to what the ledger actually holds, and LaTeX
// specials are escaped while non-ASCII text is preserved as UTF-8.
const BIB_ESCAPES: Record<string, string> = { '\\': '\\textbackslash{}', '{': '\\textbraceleft{}', '}': '\\textbraceright{}',
  '$': '\\$', '&': '\\&', '%': '\\%', '#': '\\#', '_': '\\textunderscore{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }
const bibEscape = (text: string) => text.replace(/[\\{}$&%#_~^]/g, character => BIB_ESCAPES[character]!)
const bibEntryType = (kind: string) => kind === 'paper' ? 'article' : kind === 'book' ? 'book' : 'misc'
// A literal author is one name; the extra braces keep BibTeX from splitting it.
const bibAuthors = (authors: Ledger['sources'][string]['authors']) =>
  authors.map(author => `{${author.literal ?? [author.given, author.family].filter(Boolean).join(' ')}}`).join(' and ')

function bibtex(records: { key: string; type: string; title: string; authors: Ledger['sources'][string]['authors'],
  year?: number; venue?: string; doi?: string; url?: string }[]) {
  return records.map(record => {
    const fields: [string, string][] = []
    if (record.authors.length) fields.push(['author', bibAuthors(record.authors)])
    if (record.year) fields.push(['year', String(record.year)])
    fields.push(['title', bibEscape(record.title)])
    if (record.venue) fields.push(['journal', bibEscape(record.venue)])
    if (record.doi) fields.push(['doi', record.doi])
    if (record.url) fields.push(['url', record.url.replace(/[\\{}]/g, '')])
    return `@${bibEntryType(record.type)}{${record.key},\n` +
      fields.map(([name, value]) => `\t${name} = {${value}},`).join('\n') + '\n}\n'
  }).join('')
}

export function bibliography(document: string, ledger: Ledger) {
  const projection = projectMarkdown(document), known = new Set(Object.values(ledger.sources).map(source => source.citeKey))
  for (const key of citationMarkers(document, projection.tree).flatMap(marker => marker.keys).filter(key => key.startsWith('sf_')))
    invariant(known.has(key), 'CITATION_KEY_UNKNOWN', `引用 ${key} 没有项目来源记录。`)
  const records = projection.citationOrder.map(key => {
    const source = Object.values(ledger.sources).find(source => source.citeKey === key)
    invariant(source, 'CITATION_KEY_UNKNOWN', `引用 ${key} 没有项目来源记录。`)
    return { key, type: source.kind, title: source.title, authors: source.authors, ...(source.year && { year: source.year }),
      ...(source.venue && { venue: source.venue }), ...(source.identifiers.doi && { doi: source.identifiers.doi }),
      ...(source.identifiers.url ? { url: source.identifiers.url } : source.identifiers.arxiv ? { url: `https://arxiv.org/abs/${normalizeArxiv(source.identifiers.arxiv)}` } : {}) }
  })
  return records.length ? bibtex(records) : '% No cited sources in this document.\n'
}
