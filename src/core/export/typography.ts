import type { CoverSpec, TypographySpec } from '../../shared/writing-task.ts'

/**
 * Typography is executed, not described (SPEC v1.2 §16). Everything the exporter needs is
 * derived here so the mapping has one testable home instead of being spelled out in the
 * document builder.
 */

export const DEFAULT_TYPOGRAPHY: TypographySpec = { bodyFontZh: '宋体', bodyFontEn: 'Times New Roman', bodySizePt: 12,
  bodySizeLabel: '小四', lineSpacing: 1.2, marginsMm: 25 }

/** Word measures font size in half-points and line spacing in twentieths of a point. */
export function typographyToDocx(input: TypographySpec = DEFAULT_TYPOGRAPHY) {
  return { sizeHalfPoints: Math.round(input.bodySizePt * 2),
    // 1.2 lines = 1.2 × 240; lineRule 'auto' keeps the multiple semantic instead of a fixed height.
    lineTwips: Math.round(input.lineSpacing * 240),
    marginTwips: Math.round(input.marginsMm * 56.6929),
    fonts: { ascii: input.bodyFontEn, hAnsi: input.bodyFontEn, eastAsia: input.bodyFontZh, cs: input.bodyFontEn } }
}

/** A4 in twips, the unit `w:pgSz` uses. */
export const A4_TWIPS = { width: 11906, height: 16838 }

export const CHINESE_SIZE_LABELS: { label: string; pt: number }[] = [
  { label: '初号', pt: 42 }, { label: '小初', pt: 36 }, { label: '一号', pt: 26 }, { label: '小一', pt: 24 },
  { label: '二号', pt: 22 }, { label: '小二', pt: 18 }, { label: '三号', pt: 16 }, { label: '小三', pt: 15 },
  { label: '四号', pt: 14 }, { label: '小四', pt: 12 }, { label: '五号', pt: 10.5 }, { label: '小五', pt: 9 },
]

/** Recognising 小四 in a requirement is what makes the requirement executable. */
export function sizeFromLabel(label: string) {
  const match = CHINESE_SIZE_LABELS.find(row => row.label === label.trim())
  return match?.pt
}

/**
 * Turns排版 prose into fields. Only what is actually written is mapped: an unstated font
 * keeps the default rather than inventing a value the teacher never asked for.
 */
export function typographyFromText(text: string, base: TypographySpec = DEFAULT_TYPOGRAPHY): TypographySpec {
  const next = { ...base }
  const chinese = /中文[^。；\n]{0,20}?([\u4e00-\u9fa5]{2,8}体|宋体|黑体|楷体|仿宋)/.exec(text)
  if (chinese) next.bodyFontZh = chinese[1]
  const latin = /(?:英文|西文|拉丁)[^。；\n]{0,20}?(Times New Roman|Arial|Calibri|Cambria|Helvetica)/i.exec(text)
  if (latin) next.bodyFontEn = latin[1]
  const size = CHINESE_SIZE_LABELS.find(row => text.includes(row.label))
  if (size) { next.bodySizePt = size.pt; next.bodySizeLabel = size.label }
  const spacing = /([\d.]+)\s*倍行距/.exec(text)
  if (spacing && Number(spacing[1]) >= 1 && Number(spacing[1]) <= 3) next.lineSpacing = Number(spacing[1])
  return next
}

/** The margin the requirement asks for, if it says one; otherwise the default holds. */
export function marginsFromText(text: string, base = DEFAULT_TYPOGRAPHY) {
  const margin = /(?:页边距|边距)[^。；\n]{0,12}?([\d.]+)\s*(mm|毫米|cm|厘米)/i.exec(text)
  if (!margin) return base
  const value = Number(margin[1]) * (/cm|厘米/i.test(margin[2]) ? 10 : 1)
  return value >= 10 && value <= 50 ? { ...base, marginsMm: value } : base
}

export function coverFromText(text: string, base: CoverSpec): CoverSpec {
  const needs = /封面/.test(text)
  const fields: CoverSpec['fields'] = []
  const add = (label: string, probe: RegExp, value: string) => { if (probe.test(text)) fields.push({ label, value }) }
  add('姓名', /姓名/, '')
  add('学号', /学号/, '')
  add('班级', /班级/, '')
  add('课程', /课程/, '')
  add('题目', /题目|题名/, '')
  add('院系', /院系|学院/, '')
  return { ...base, enabled: needs || base.enabled, fields: fields.length ? fields : base.fields }
}

/** Cover pages are counted separately from body pages; neither is derived from the other. */
export function pagePlan(cover: CoverSpec, length: { pages?: number; coverPages?: number; bodyPages?: number }) {
  const coverPages = cover.enabled ? (length.coverPages ?? 1) : 0
  const bodyPages = length.bodyPages ?? (length.pages !== undefined ? Math.max(1, length.pages - coverPages) : undefined)
  return { coverPages, bodyPages, totalPages: length.pages }
}

/** What the acceptance record has to name before a page count can be called verified. */
export type PaginationEvidence = { viewer: string; viewerVersion: string; pages: number; coverPages: number; bodyPages: number
  overflow: boolean; largeBlank: boolean; measuredAt: string }

export function paginationVerdict(evidence: PaginationEvidence, expected: { coverPages: number; bodyPages?: number }) {
  const notes: string[] = []
  if (evidence.coverPages !== expected.coverPages) notes.push(`封面实际 ${evidence.coverPages} 页，要求 ${expected.coverPages} 页。`)
  if (expected.bodyPages !== undefined && evidence.bodyPages !== expected.bodyPages)
    notes.push(`正文实际 ${evidence.bodyPages} 页，要求 ${expected.bodyPages} 页。`)
  if (evidence.overflow) notes.push('存在内容溢出页面。')
  if (evidence.largeBlank) notes.push('存在明显空白。')
  return { ok: notes.length === 0, notes }
}
