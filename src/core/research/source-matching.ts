import type { Source } from '../../shared/schema.ts'
import { invariant } from '../../shared/errors.ts'
import { digest, json } from '../store/files.ts'

// arXiv's identifier/version semantics are checked against the official help
// page (2026-10-05); syntax validation never asserts that a work exists.
export function normalizeArxiv(value: string) {
  invariant(value.length <= 1000, 'SOURCE_IDENTIFIER_INVALID', 'arXiv 标识过长，未解析或猜测身份。')
  const clean = value.trim().replace(/^arxiv:\s*/iu, '').replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//iu, '').replace(/\.pdf$/iu, '')
  const modern = /^(\d{2})(0[1-9]|1[0-2])\.(\d{4,5})(v[1-9]\d*)?$/u.exec(clean)
  if (modern) {
    const date = Number(modern[1] + modern[2])
    invariant(date >= 704 && modern[3].length === (date >= 1501 ? 5 : 4) && Number(modern[3]) > 0, 'SOURCE_IDENTIFIER_INVALID', 'arXiv 月份或编号位数不符合已支持格式。')
    return clean
  }
  const legacy = /^([a-z][a-z0-9-]*)(?:\.([a-z]{2}))?\/(\d{2})(0[1-9]|1[0-2])(\d{3})(v[1-9]\d*)?$/iu.exec(clean)
  invariant(legacy && (Number(legacy[3]) >= 91 || Number(legacy[3]) <= 7) && (Number(legacy[3]) !== 91 || Number(legacy[4]) >= 7) &&
    (Number(legacy[3]) !== 7 || Number(legacy[4]) <= 3) && Number(legacy[5]) > 0, 'SOURCE_IDENTIFIER_INVALID', 'arXiv 标识格式不受支持，未猜测版本或身份。')
  return `${legacy[1].toLowerCase()}${legacy[2] ? '.' + legacy[2].toUpperCase() : ''}/${legacy[3]}${legacy[4]}${legacy[5]}${legacy[6] ?? ''}`
}
const title = (value: string) => [...value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '')].slice(0, 2000).join('')
function similar(a: string, b: string) {
  if (a === b) return !!a
  if (Math.min(a.length, b.length) < 12 || Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.8) return false
  const grams = (text: string) => { const characters = [...text]; return new Set(characters.slice(0, -1).map((character, i) => character + characters[i + 1])) }
  const aa = grams(a), bb = grams(b), shared = [...aa].filter(value => bb.has(value)).length
  return 2 * shared / (aa.size + bb.size) >= 0.9
}
export function sourceMatches(input: Pick<Source, 'title' | 'identifiers'>, sources: Record<string, Source>) {
  const arxiv = input.identifiers.arxiv ? normalizeArxiv(input.identifiers.arxiv) : undefined
  const work = arxiv?.replace(/v[1-9]\d*$/u, '')
  return Object.values(sources).flatMap(source => {
    let other: string | undefined
    try { other = source.identifiers.arxiv ? normalizeArxiv(source.identifiers.arxiv) : undefined } catch { /* Invalid historical metadata is not guessed into an identity. */ }
    const sameWork = !!work && other?.replace(/v[1-9]\d*$/u, '') === work
    if (!sameWork && !similar(title(input.title), title(source.title))) return []
    return [{ sourceId: source.id, sourceHash: digest(json(source)), title: source.title, citeKey: source.citeKey,
      kind: sameWork ? (arxiv === other ? 'same-arxiv-reference' as const : 'same-arxiv-work' as const) : 'similar-title' as const,
      arxiv: other, materialId: source.materialId, contentHash: source.contentHash,
      warning: sameWork ? '同一 arXiv 作品的具体版本与本地文本仍须核对；无版本号不等于 v1。不得迁移证据或替换既有文本。' : '标题相似只表示疑似重复，不证明作品身份相同；不能自动合并来源、引用或证据。' }]
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId))
}
