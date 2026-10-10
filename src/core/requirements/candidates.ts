import type { CreationSpec, RequirementBrief, LengthSpec } from '../../shared/writing-task.ts'
import type { candidateBasis, candidateDiff, candidateConflict, outlineChange, outlineCoverage } from '../../shared/writing-task.ts'
import type { z } from 'zod'

/**
 * Candidate lifecycle (SPEC v1.2 §4.3, §4.4, §6). A candidate is a *proposal*: it records the
 * inputs it was built from, so any later edit to those inputs makes it stale rather than
 * letting a late result overwrite the user's own work.
 */

export type CandidateBasis = z.infer<typeof candidateBasis>
export type CandidateDiff = z.infer<typeof candidateDiff>
export type CandidateConflict = z.infer<typeof candidateConflict>
export type OutlineChange = z.infer<typeof outlineChange>
export type OutlineCoverage = z.infer<typeof outlineCoverage>

type Section = CreationSpec['sections'][number]

/** The fields whose change invalidates a requirements candidate. */
export function requirementsBasis(input: { spec: CreationSpec; specHash: string; requirementsHash: string; readsHash?: string }): CandidateBasis {
  return { specHash: input.specHash, requirementsHash: input.requirementsHash, ...(input.readsHash && { readsHash: input.readsHash }) }
}

export function outlineBasis(input: { spec: CreationSpec; specHash: string; requirementsHash: string; outlineHash: string; readsHash?: string }): CandidateBasis {
  return { specHash: input.specHash, requirementsHash: input.requirementsHash, readsHash: input.readsHash, outlineHash: input.outlineHash }
}

/** A candidate stays adoptable only while every recorded input still matches. */
export function basisMatches(candidate: { basedOn: CandidateBasis }, current: Partial<CandidateBasis>) {
  return (Object.keys(current) as (keyof CandidateBasis)[]).every(key =>
    current[key] === undefined || candidate.basedOn[key] === current[key])
}

export type BriefRow = { path: string; label: string; value: string }

/** Flattens the six groups into labelled rows; absent fields are omitted, never shown as "未说明". */
export function flattenBrief(brief: RequirementBrief): BriefRow[] {
  const rows: BriefRow[] = []
  const add = (path: string, label: string, value?: string) => { if (value?.trim()) rows.push({ path, label, value: value.trim() }) }
  add('task.nature', '任务性质', brief.task.nature)
  add('task.subject', '题目／指定分析对象', brief.task.subject)
  add('task.deliverable', '交付物', brief.task.deliverable)
  for (const item of brief.coverage) add(`coverage.${item.id}`, `必须覆盖 · ${item.text}`, item.text)
  add('length', '篇幅', describeLength(brief.length))
  add('format.fileFormat', '提交文件格式', brief.format.fileFormat)
  add('format.citationStyle', '引用样式', brief.format.citationStyle)
  if (brief.format.cover !== undefined) add('format.cover', '封面', brief.format.cover ? '需要封面' : '不需要封面')
  if (brief.typography) {
    const t = brief.typography
    add('typography', '排版', `中文 ${t.bodyFontZh}／英文 ${t.bodyFontEn} · ${t.bodySizeLabel} · ${t.lineSpacing} 倍行距`)
  }
  add('submission.when', '提交时间', brief.submission.when)
  add('submission.where', '提交地点', brief.submission.where)
  add('submission.how', '提交方式', brief.submission.how)
  for (const decision of brief.decisions) add(`decision.${decision.topic}`, `需要决定 · ${decision.topic}`, decision.question)
  return rows
}

/** "约 1500 字" keeps its 约: the number the user sees and the strictness are separate fields. */
export function describeLength(length: LengthSpec): string | undefined {
  const parts: string[] = []
  if (length.value !== undefined) parts.push(`${length.approximate ? '约 ' : ''}${length.value} ${length.unit === 'words' ? '词' : '字'}`)
  else if (length.min !== undefined || length.max !== undefined) parts.push([length.min !== undefined ? `${length.min} 以上` : '', length.max !== undefined ? `${length.max} 以下` : ''].filter(Boolean).join(' · '))
  if (length.pages !== undefined) parts.push(`共 ${length.pages} 页`)
  if (length.coverPages !== undefined || length.bodyPages !== undefined)
    parts.push([length.coverPages !== undefined ? `封面 ${length.coverPages} 页` : '', length.bodyPages !== undefined ? `正文 ${length.bodyPages} 页` : ''].filter(Boolean).join('＋'))
  return parts.length ? parts.join(' · ') : undefined
}

/** Field-level comparison against what the spec currently holds. */
export function diffBrief(brief: RequirementBrief, current: { requirements: string; targetLength: number; sections: Section[] }): CandidateDiff[] {
  const rows = flattenBrief(brief)
  const known = new Map<string, string>()
  for (const line of current.requirements.split(/\r?\n/)) {
    const text = line.trim()
    if (text) known.set(text, text)
  }
  const diffs: CandidateDiff[] = []
  for (const row of rows) {
    if (known.has(row.value)) continue
    const established = /篇幅|排版/.test(row.label)
    diffs.push({ path: row.path, label: row.label, after: row.value, kind: established ? 'changed' : 'added' })
  }
  return diffs
}

/**
 * Conflicts have two sources and the user has to see both (PRD §3.2): a teacher value that
 * disagrees with the preset default, and a candidate value that disagrees with what the user
 * already typed. Neither side wins on its own.
 */
export function conflictsOf(input: { brief: RequirementBrief; spec: CreationSpec; presetLength?: number }): CandidateConflict[] {
  const conflicts: CandidateConflict[] = []
  const { brief, spec, presetLength } = input
  const length = brief.length
  if (length.value !== undefined) {
    const teacher = describeLength(length) ?? String(length.value)
    if (presetLength !== undefined && presetLength !== length.value && originOf(brief, 'length') === 'teacher')
      conflicts.push({ topic: '篇幅', current: `预设默认 ${presetLength} 字`, candidate: `老师要求 ${teacher}`,
        source: length.sourceRef, preferred: 'candidate' })
    else if (!length.approximate && spec.targetLength !== length.value)
      conflicts.push({ topic: '篇幅', current: `当前设置 ${spec.targetLength} 字`, candidate: teacher, source: length.sourceRef, preferred: 'candidate' })
  }
  for (const field of ['fileFormat', 'citationStyle'] as const) {
    const value = brief.format[field]
    if (!value) continue
    const implemented = field === 'citationStyle' ? /顺序|numeric|numbered/i.test(value) : true
    if (!implemented) conflicts.push({ topic: field === 'citationStyle' ? '引用样式' : '提交格式', current: '当前只支持顺序编号 [1]',
      candidate: `要求 ${value}`, source: brief.origins[`format.${field}`], preferred: 'current' })
  }
  return conflicts
}

function originOf(brief: RequirementBrief, path: string) {
  return brief.origins[path] ?? 'unspecified'
}

/** Fields the user can adopt individually; "全部采用" is these, in order. */
export const ADOPTABLE_PATHS = ['task', 'coverage', 'length', 'format', 'typography', 'submission'] as const
export type AdoptableGroup = (typeof ADOPTABLE_PATHS)[number]

/**
 * Adoption is additive by design: the user's own text is never replaced. The brief is stored
 * beside it and an appended, clearly-labelled summary keeps the raw requirement readable.
 */
export function adoptBrief(spec: CreationSpec, brief: RequirementBrief, options: { adopt?: AdoptableGroup[]; summary: string; overrides?: CreationSpec['overrides'] } = { summary: '' }) {
  const adopt = new Set(options.adopt ?? ADOPTABLE_PATHS)
  const next: CreationSpec = { ...spec, brief: adopt.size ? brief : spec.brief }
  const lines: string[] = [spec.requirements, options.summary].filter(text => text?.trim())
  next.requirements = lines.join('\n').slice(0, 12000)
  if (adopt.has('length') && brief.length.value !== undefined && !options.overrides?.some(row => row.field === '篇幅')) {
    next.targetLength = brief.length.value
    next.targetLengthOrigin = 'requirements'
  }
  if (adopt.has('format') && brief.format.cover === true) next.cover = { ...(spec.cover ?? { enabled: false, title: '', fields: [], date: '' }), enabled: true, title: spec.title,
    fields: spec.cover?.fields.length ? spec.cover.fields : [{ label: '姓名', value: '' }, { label: '学号', value: '' }] }
  if (adopt.has('typography') && brief.typography && spec.typography === undefined) next.typography = brief.typography
  if (options.overrides?.length) next.overrides = [...spec.overrides, ...options.overrides].slice(-40)
  return next
}

/** The summary is a record of what was adopted, not a second copy of the requirement text. */
export function adoptionSummary(brief: RequirementBrief, adopted: AdoptableGroup[]) {
  const rows = flattenBrief(brief).filter(row => adopted.some(group => group === 'task' ? row.path.startsWith('task.') : row.path.startsWith(group)))
  if (!rows.length) return ''
  return ['【已采用的要求整理】', ...rows.map(row => `${row.label}：${row.value}`)].join('\n')
}

/** Which confirmed must-cover items the proposed structure actually covers. */
export function coverageOf(sections: Section[], brief?: RequirementBrief): OutlineCoverage[] {
  if (!brief) return []
  return brief.coverage.map((item, index) => {
    // The key is local to this comparison; a candidate without one still compares by position.
    const itemId = item.id ?? `c${index + 1}`
    const terms = significantTerms(item.text)
    const hits = sections.filter(section => terms.some(term =>
      section.title.includes(term) || section.purpose.includes(term))).map(section => section.id)
    return { itemId, text: item.text, sectionIds: hits, covered: hits.length > 0 }
  })
}

/** Two-character CJK runs and 4+ letter latin words: enough to match a heading to a requirement. */
function significantTerms(text: string) {
  const terms = new Set<string>()
  for (const run of text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) for (let index = 0; index + 2 <= run.length; index += 1) terms.add(run.slice(index, index + 2))
  for (const word of text.match(/[A-Za-z]{4,}/g) ?? []) terms.add(word.toLowerCase())
  return [...terms]
}

export function outlineDiff(before: Section[], after: Section[]): OutlineChange[] {
  const changes: OutlineChange[] = []
  const beforeById = new Map(before.map(section => [section.id, section]))
  const afterById = new Map(after.map(section => [section.id, section]))
  for (const section of after) {
    const previous = beforeById.get(section.id)
    if (!previous) changes.push({ sectionId: section.id, title: section.title, kind: 'added', after: section.title })
    else if (previous.title !== section.title) changes.push({ sectionId: section.id, title: section.title, kind: 'renamed', before: previous.title, after: section.title })
    else if (previous.targetLength !== section.targetLength) changes.push({ sectionId: section.id, title: section.title, kind: 'reallocated', before: String(previous.targetLength), after: String(section.targetLength) })
  }
  for (const section of before) if (!afterById.has(section.id)) changes.push({ sectionId: section.id, title: section.title, kind: 'removed', before: section.title })
  const order = before.map(section => section.id).filter(id => afterById.has(id))
  const nextOrder = after.map(section => section.id).filter(id => beforeById.has(id))
  if (order.join('>') !== nextOrder.join('>')) changes.push({ title: '章节顺序', kind: 'reordered' })
  return changes
}

/** A structure that ignores the required dimensions is a gap, not a stylistic difference. */
export function outlineGaps(sections: Section[], coverage: OutlineCoverage[], input: { coverageRequired: boolean }) {
  const gaps: string[] = []
  if (input.coverageRequired) for (const row of coverage) if (!row.covered) gaps.push(`要求中的「${row.text}」还没有对应章节。`)
  return gaps
}

/**
 * Where each brief field came from (SPEC v1.2 §4.2). A value that appears in the requirement
 * files is the teacher's; one that only appears in the user's own description is theirs; the
 * rest is the model's suggestion and is shown as such until it is adopted.
 */
export function originsOf(brief: RequirementBrief, input: { readText: string; userText: string }): Record<string, 'teacher' | 'user' | 'suggestion'> {
  const origins: Record<string, 'teacher' | 'user' | 'suggestion'> = {}
  for (const row of flattenBrief(brief)) {
    if (!row.value.trim()) continue
    const probe = row.value.replace(/\s+/g, '')
    const contains = (haystack: string) => haystack.replace(/\s+/g, '').includes(probe) || probe.length > 8 && haystack.replace(/\s+/g, '').includes(probe.slice(0, 8))
    origins[row.path] = contains(input.readText) ? 'teacher' : contains(input.userText) ? 'user' : 'suggestion'
  }
  return origins
}
