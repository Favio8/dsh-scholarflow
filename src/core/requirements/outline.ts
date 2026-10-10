import { outlineGeneration, outlineReview, type CreationSpec } from '../../shared/writing-task.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'

type Section = CreationSpec['sections'][number]

/** Content choices belong to the model; these are structural invariants, not topic rules. */
export function validateOutline(sections: Section[]) {
  const seen = new Map<string, Section>()
  let parent: string | undefined
  for (const section of sections) {
    invariant(!seen.has(section.id), 'OUTLINE_INVALID', '候选章节编号重复，请重新生成。')
    if (section.parentId) {
      const ancestor = seen.get(section.parentId)
      invariant(ancestor && !ancestor.parentId && ancestor.kind === 'body' && section.kind === 'body' && parent === ancestor.id,
        'OUTLINE_INVALID', '子节需要紧跟所属正文章节，且只支持一层子节。')
    } else parent = section.id
    seen.set(section.id, section)
  }
  invariant(sections.some(row => row.kind === 'body'), 'OUTLINE_INVALID', '候选没有正文章节，请重新生成。')
}

export function validateGeneration(value: unknown, spec: CreationSpec) {
  const generated = outlineGeneration.parse(value)
  validateOutline(generated.sections)
  const known = new Map((spec.brief?.coverage ?? []).map((row, i) => [row.id ?? `c${i + 1}`, row.text]))
  const seen = new Set<string>()
  for (const item of generated.requirements) {
    invariant(!seen.has(item.id), 'OUTLINE_INVALID', '候选要求编号重复，请重新生成。')
    seen.add(item.id)
    invariant(known.has(item.id) ? known.get(item.id) === item.text : Boolean(item.quote.trim()) && spec.requirements.includes(item.quote),
      'OUTLINE_UNGROUNDED', '候选包含无法回到已确认要求的条目，请重新生成。')
  }
  invariant([...known.keys()].every(key => seen.has(key)), 'OUTLINE_REQUIREMENT_MISSING', '候选遗漏了已确认的要求条目，请重新生成。')
  if (spec.targetLengthOrigin === 'user' || spec.overrides.some(row => row.field === '篇幅')) generated.targetLength = spec.targetLength
  else if (spec.brief?.length.value !== undefined) generated.targetLength = spec.brief.length.value
  generated.sections = generated.sections.map(row => ({ ...row, allocationWeight: row.allocationWeight ?? row.targetLength }))
  return generated
}

/** Actual configured facts, not assertions from the model's taskSummary. */
export function outlineDocumentPlan(spec: CreationSpec, generated: ReturnType<typeof validateGeneration>) {
  return {
    cover: { enabled: Boolean(spec.cover?.enabled) }, format: spec.format,
    bodyTarget: generated.targetLength,
    plannedBodyLength: generated.sections.filter(row => row.kind === 'body').reduce((sum, row) => sum + row.targetLength, 0),
    typography: spec.typography ?? null,
    requestedPages: { total: spec.brief?.length.pages, cover: spec.brief?.length.coverPages, body: spec.brief?.length.bodyPages },
    submission: spec.brief?.submission ?? null,
  }
}

/** Model-assessed coverage is labelled as such; unknown IDs cannot become a pass. */
export function assessOutline(generated: ReturnType<typeof validateGeneration>, value: unknown, documentPlan?: ReturnType<typeof outlineDocumentPlan>) {
  const review = outlineReview.parse(value)
  const requirements = new Map(generated.requirements.map(row => [row.id, row]))
  const sections = new Set(generated.sections.map(row => row.id))
  const seen = new Set<string>()
  const contractError = (row: (typeof review.coverage)[number], field: string, message: string): never => {
    throw new ScholarError('OUTLINE_REVIEW_INVALID', message, { category: 'model-contract', operation: 'outline.review', repairable: true,
      itemId: row.itemId, requirement: requirements.get(row.itemId)?.text, fields: [`coverage.${row.itemId}.${field}`] })
  }
  for (const row of review.coverage) {
    if (!requirements.has(row.itemId) || seen.has(row.itemId) || !row.sectionIds.every(id => sections.has(id)))
      contractError(row, 'sectionIds', '覆盖检查引用了未知或重复的要求／章节。')
    seen.add(row.itemId)
    const scope = row.scope ?? (row.sectionIds.length ? 'sections' : 'unclassified')
    row.scope = scope
    if (scope === 'sections' && (row.status === 'covered' || row.status === 'partial') && !row.sectionIds.length)
      contractError(row, 'sectionIds', '章节内容的覆盖检查没有给出对应章节。')
    if (scope === 'unclassified' && row.status !== 'missing') {
      row.status = 'pending'
      row.reason = `尚未明确本项的适用范围与依据，需确认。模型说明：${row.reason}`.slice(0, 2000)
    } else if (scope === 'submission' || row.documentFields?.includes('requestedPages') || row.documentFields?.includes('submission')) {
      if (row.status !== 'missing') row.status = 'pending'
      row.reason = `大纲阶段只保留要求，实际分页或提交需后续验证。模型说明：${row.reason}`.slice(0, 2000)
    } else if (scope === 'document' && (row.status === 'covered' || row.status === 'partial')) {
      if (!row.documentFields?.length || !documentPlan || row.documentFields.some(field => documentPlan[field] == null)) {
        row.status = 'pending'
        row.reason = `整篇设置尚未提供可核对的配置依据，需确认。模型说明：${row.reason}`.slice(0, 2000)
      }
    }
  }
  if (seen.size !== requirements.size) throw new ScholarError('OUTLINE_REVIEW_INVALID', '覆盖检查未逐项检查全部要求。',
    { category: 'model-contract', operation: 'outline.review', repairable: true, fields: ['coverage'], missingItemIds: [...requirements.keys()].filter(id => !seen.has(id)) })
  const coverage = review.coverage.map(row => ({ ...row, text: requirements.get(row.itemId)!.text, covered: row.status === 'covered' }))
  const gaps = [...review.issues, ...coverage.filter(row => row.status === 'partial' || row.status === 'missing').map(row => `${row.text}：${row.reason}`)]
  const total = generated.sections.filter(row => row.kind === 'body').reduce((sum, row) => sum + row.targetLength, 0)
  if (Math.abs(total - generated.targetLength) > generated.targetLength * .1)
    gaps.push(`正文计划合计 ${total}，与规划目标 ${generated.targetLength} 相差超过 10%，请调整后确认。`)
  return { review, coverage, gaps: gaps.length > 40 ? [...gaps.slice(0, 39), `另有 ${gaps.length - 39} 项，请展开完整覆盖评估。`] : gaps }
}

export function outlineInputKey(spec: CreationSpec) {
  return JSON.stringify([spec.title, spec.requirements, spec.brief, spec.requirementSources, spec.materials,
    spec.type, spec.language, spec.format, spec.targetLength, spec.targetLengthOrigin, spec.typography, spec.cover?.enabled, spec.overrides])
}

/** Preserve existing attempt/acceptance markers across this fingerprint refinement. */
export function restoreOutlineInputKey(value: string) {
  try {
    const fields = JSON.parse(value)
    if (Array.isArray(fields) && fields.length === 13 && fields[11] && typeof fields[11] === 'object' && 'enabled' in fields[11]) {
      fields[11] = fields[11].enabled
      return JSON.stringify(fields)
    }
  } catch { /* Empty or older markers remain unconfirmed. */ }
  return value
}

/** Personal cover fields do not enter the outline model. Keep them editable without
 * invalidating its candidate; adoption preserves the latest operator-entered fields. */
export function outlineCandidateKey(spec: CreationSpec) {
  return JSON.stringify({ ...spec, cover: spec.cover ? { enabled: spec.cover.enabled } : undefined })
}

/** Root sections move with their children; children never escape their parent. */
export function moveOutlineSection(sections: Section[], id: string, direction: -1 | 1): Section[] {
  const index = sections.findIndex(row => row.id === id), row = sections[index]
  if (!row) return sections
  const peers = sections.filter(other => other.parentId === row.parentId && other.kind === row.kind)
  const target = peers[peers.findIndex(other => other.id === id) + direction]
  if (!target) return sections
  const group = (key: string) => sections.filter(other => other.id === key || other.parentId === key)
  const first = direction < 0 ? target : row, last = direction < 0 ? row : target
  const firstIndex = sections.indexOf(first), lastGroup = group(last.id), lastIndex = sections.indexOf(lastGroup.at(-1)!)
  const middle = sections.slice(firstIndex, lastIndex + 1).filter(other => !group(first.id).includes(other) && !lastGroup.includes(other))
  return [...sections.slice(0, firstIndex), ...lastGroup, ...middle, ...group(first.id), ...sections.slice(lastIndex + 1)]
}
