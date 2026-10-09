import type { Source } from '../../shared/schema.ts'

// GB/T 7714-2015 entry text. The ledger holds what it holds: a missing venue or page range
// is left out rather than filled with 不详, and the type tag is inferred from the registered
// kind because the ledger does not record whether a paper was published in a journal or in
// proceedings. That inference is stated in the delivery notes instead of being presented as
// verified metadata.

const TAG: Record<Source['kind'], string | undefined> = {
  paper: '[J]', book: '[M]', web: '[EB/OL]', dataset: '[DB/OL]', 'user-result': undefined, other: undefined,
}

/** `Family, G.` for a western name, the literal for a Chinese one or an organisation. */
function author(author: Source['authors'][number]): string | undefined {
  if (author.literal?.trim()) return author.literal.trim()
  const family = author.family?.trim(), given = author.given?.trim()
  if (!family) return given
  if (!given) return family
  return `${family} ${given}`
}

export function gbt7714Entry(source: Source, index: number): string {
  const authors = source.authors.map(author).filter(Boolean) as string[]
  const tag = TAG[source.kind]
  // [n] 作者. 题名[类型]. 刊名, 年, DOI.
  const authorText = authors.length ? `${authors.slice(0, 3).join(', ')}${authors.length > 3 ? ', et al' : ''}. ` : ''
  const head = `[${index}] ${authorText}${source.title}${tag ?? ''}.`
  const tail: string[] = []
  if (source.venue) tail.push(source.venue)
  if (source.year) tail.push(String(source.year))
  const identifier = source.identifiers.doi ?? source.identifiers.url
  if (source.kind === 'web' || source.kind === 'dataset') { if (identifier) tail.push(identifier) }
  else if (source.identifiers.doi) tail.push(`DOI: ${source.identifiers.doi}`)
  return tail.length ? `${head} ${tail.join(', ')}.` : head
}

/** What the delivery has to say about the reference list it produced. */
export function referenceNotes(sources: Source[]): string[] {
  const notes: string[] = []
  if (sources.some(source => source.kind === 'paper' && !source.venue))
    notes.push('部分文献没有登记刊名，条目中的文献类型标签按登记 kind 推断，未经出版信息核验。')
  if (sources.some(source => source.kind === 'user-result'))
    notes.push('用户自有结果不是文献，未生成参考文献条目。')
  return notes
}

/**
 * The plain style: whatever the ledger holds, joined in reading order, with nothing inferred.
 * This is what a western-language paper gets, where GB/T 7714 does not apply.
 */
export function plainEntry(source: Source, index: number): string {
  const authors = source.authors.map(author).filter(Boolean) as string[]
  return `[${index}] ${[authors.join(', '), source.title, source.venue, source.year,
    source.identifiers.doi ?? source.identifiers.url].filter(Boolean).join('. ')}`
}
