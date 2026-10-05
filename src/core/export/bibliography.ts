import { Cite, type CSL } from '@citation-js/core'
import '@citation-js/plugin-bibtex'
import type { Ledger } from '../../shared/schema.ts'
import { projectMarkdown, citationMarkers } from '../editing/markdown.ts'
import { invariant } from '../../shared/errors.ts'
import { normalizeArxiv } from '../research/source-matching.ts'

export function bibliography(document: string, ledger: Ledger) {
  const projection = projectMarkdown(document), known = new Set(Object.values(ledger.sources).map(source => source.citeKey))
  for (const key of citationMarkers(document, projection.tree).flatMap(marker => marker.keys).filter(key => key.startsWith('sf_')))
    invariant(known.has(key), 'CITATION_KEY_UNKNOWN', `引用 ${key} 没有项目来源记录。`)
  const records: CSL[] = projection.citationOrder.map(key => {
    const source = Object.values(ledger.sources).find(source => source.citeKey === key)
    invariant(source, 'CITATION_KEY_UNKNOWN', `引用 ${key} 没有项目来源记录。`)
    return { id: key, 'citation-key': key, type: source.kind === 'paper' ? 'article-journal' : source.kind === 'book' ? 'book' : source.kind === 'dataset' ? 'dataset' : 'document',
      title: source.title, author: source.authors, ...(source.year && { issued: { 'date-parts': [[source.year]] } }),
      ...(source.venue && { 'container-title': source.venue }), ...(source.identifiers.doi && { DOI: source.identifiers.doi }),
      ...(source.identifiers.url ? { URL: source.identifiers.url } : source.identifiers.arxiv ? { URL: `https://arxiv.org/abs/${normalizeArxiv(source.identifiers.arxiv)}` } : {}) }
  })
  return records.length ? new Cite(records).format('bibtex') + '\n' : '% No cited sources in this document.\n'
}
