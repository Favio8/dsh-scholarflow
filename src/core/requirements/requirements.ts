import { z } from 'zod'
import { requirementInput } from '../../shared/requirements.ts'
import { requirementSchema, type Ledger, type Requirement } from '../../shared/schema.ts'
import { mutateLedger, invalidateReviews } from '../project/project.ts'
import { json, newId, type FileStore } from '../store/files.ts'
import { readParsed } from '../materials/materials.ts'
import { invariant } from '../../shared/errors.ts'

function conflict(a: Requirement, b: Requirement) {
  if (a.id === b.id || a.kind !== b.kind || !a.constraint || !b.constraint) return false
  if (a.kind === 'section' || a.kind === 'topic') return false
  if (a.constraint.unit !== b.constraint.unit || a.constraint.operator !== b.constraint.operator) {
    if (a.constraint.unit === b.constraint.unit && typeof a.constraint.value === 'number' && typeof b.constraint.value === 'number') {
      const min = Math.max(a.constraint.operator === 'min' || a.constraint.operator === 'equals' ? a.constraint.value : -Infinity, b.constraint.operator === 'min' || b.constraint.operator === 'equals' ? b.constraint.value : -Infinity)
      const max = Math.min(a.constraint.operator === 'max' || a.constraint.operator === 'equals' ? a.constraint.value : Infinity, b.constraint.operator === 'max' || b.constraint.operator === 'equals' ? b.constraint.value : Infinity)
      return min > max
    }
    return a.kind === 'length'
  }
  return a.constraint.value !== b.constraint.value
}
function markConflicts(ledger: Ledger) {
  const rows = Object.values(ledger.requirements)
  for (const row of rows) if (row.confirmation === 'conflicting') { row.confirmation = 'proposed'; delete row.confirmedAt }
  for (const a of rows) for (const b of rows) if (conflict(a, b)) { a.confirmation = 'conflicting'; b.confirmation = 'conflicting'; delete a.confirmedAt; delete b.confirmedAt }
}
async function locateOrigin(io: FileStore, requirement: z.infer<typeof requirementInput>) {
  if (requirement.origin.type !== 'material') return
  invariant(requirement.origin.materialId && requirement.origin.locator && requirement.origin.excerpt, 'REQUIREMENT_NOT_LOCATED', '资料要求需要材料、定位和真实摘录。')
  const parsed = await readParsed(io, requirement.origin.materialId)
  invariant(parsed.blocks.some(block => JSON.stringify(block.locator) === JSON.stringify(requirement.origin.locator) && block.text.includes(requirement.origin.excerpt!)),
    'REQUIREMENT_NOT_LOCATED', '要求摘录不在资料指定位置，不能冒充老师原文。')
}
export async function upsertRequirement(io: FileStore, input: z.infer<typeof requirementInput>, revision: number) {
  input = requirementInput.parse(input)
  const requirementId = input.id ?? newId('req')
  const result = await mutateLedger(io, revision, async ledger => {
    await locateOrigin(io, input)
    invariant(!input.id || ledger.requirements[input.id], 'REQUIREMENT_NOT_FOUND', '要求不属于当前项目。')
    ledger.requirements[requirementId] = requirementSchema.parse({ ...input, id: requirementId, confirmation: 'proposed' })
    markConflicts(ledger); invalidateReviews(ledger, ['requirement', 'structure', 'integrity'])
  })
  return { requirement: result.ledger.requirements[requirementId], revision: result.revision }
}

// Conservative extraction from already approved, actually parsed blocks. These
// candidates never become policy automatically; ambiguous counting stays unknown.
export async function extractRequirements(io: FileStore, materialId: string, revision: number) {
  const parsed = await readParsed(io, materialId)
  const candidates: Requirement[] = []
  for (const block of parsed.blocks) {
    if (candidates.length >= 50) break
    const text = block.text.trim()
    if (!text || text.length > 4000) continue
    const length = /(?:字数|篇幅|正文|论文|至少|不少于|不超过)[^\d]{0,30}(\d{2,7})\s*(字|词|words?)/i.exec(text)
    const references = /(?:参考文献|引用文献|文献)[^\d]{0,30}(\d{1,3})\s*(篇|条|项)/.exec(text)
    const forbidden = /(?:禁止|不允许|不得)\s*(?:使用\s*)?(?:AI|人工智能|生成式)/i.test(text)
    if (!length && !references && !forbidden) continue
    const match = length ?? references
    candidates.push(requirementSchema.parse({ id: newId('req'), kind: forbidden ? 'ai-policy' : length ? 'length' : 'references', description: text,
      origin: { type: 'material', materialId, locator: block.locator, excerpt: text }, confirmation: 'proposed', verificationMethod: forbidden ? 'manual' : 'deterministic',
      constraint: forbidden ? { operator: 'equals', value: 'forbidden' } : { operator: /不超过|最多|至多/.test(text) ? 'max' : /至少|不少于|最低/.test(text) ? 'min' : 'equals',
        value: Number(match![1]), unit: length ? match![2] === '字' ? 'zh-characters' : 'words' : 'items' } }))
  }
  invariant(candidates.length, 'NO_REQUIREMENTS_EXTRACTED', '已解析范围未找到可保守提取的要求，请手工登记；没有猜测其余页面。')
  const result = await mutateLedger(io, revision, async ledger => {
    invariant((await readParsed(io, materialId)).sourceContentHash === parsed.sourceContentHash, 'STALE_MATERIAL_VERSION', '要求资料已改变。')
    for (const candidate of candidates) if (!Object.values(ledger.requirements).some(row => row.origin.materialId === materialId && row.origin.excerpt === candidate.origin.excerpt)) ledger.requirements[candidate.id] = candidate
    markConflicts(ledger); invalidateReviews(ledger, ['requirement', 'integrity'])
  })
  return { revision: result.revision, requirements: Object.values(result.ledger.requirements), warnings: ['仅提取实际已解析范围；候选必须逐项确认。篇幅统计口径需要单独选择。'] }
}

export async function confirmRequirement(io: FileStore, requirementId: string, countingPolicyId: string | undefined, revision: number) {
  return mutateLedger(io, revision, async ledger => {
    const requirement = ledger.requirements[requirementId]
    invariant(requirement, 'REQUIREMENT_NOT_FOUND', '要求不存在。')
    markConflicts(ledger)
    invariant(requirement.confirmation !== 'conflicting', 'REQUIREMENT_CONFLICT', '先查看冲突，明确选择有效约束并记录理由。')
    await locateOrigin(io, requirement)
    if (requirement.kind === 'length') {
      invariant(countingPolicyId === 'sf-body-han-western-v1' && requirement.constraint && ['zh-characters', 'words'].includes(requirement.constraint.unit ?? ''),
        'COUNTING_POLICY_CONFIRMATION_REQUIRED', '请确认汉字或西文词元统计口径；不能冒充 Word 字数。')
      requirement.constraint.countingPolicyId = countingPolicyId
    }
    requirement.confirmation = 'confirmed'; requirement.confirmedAt = new Date().toISOString()
    invalidateReviews(ledger, ['requirement', 'integrity'])
  })
}

export async function resolveRequirementConflict(io: FileStore, requirementIds: string[], selectedId: string, reason: string, revision: number) {
  invariant(reason.trim().length && new Set(requirementIds).size === requirementIds.length && requirementIds.includes(selectedId), 'INVALID_REQUEST', '冲突选择需要唯一要求、保留项和处理理由。')
  return mutateLedger(io, revision, async ledger => {
    const rows = requirementIds.map(id => ledger.requirements[id])
    invariant(rows.every(row => row?.confirmation === 'conflicting') && rows.some(a => rows.some(b => conflict(a, b))), 'REQUIREMENT_CONFLICT_CHANGED', '冲突已改变，请重新检查。')
    const archive = { schemaVersion: 1, projectId: ledger.projectId, selectedId, reason: reason.trim(), requirements: rows, decidedAt: new Date().toISOString() }
    for (const row of rows) if (row.id !== selectedId) delete ledger.requirements[row.id]
    const selected = ledger.requirements[selectedId]; selected.confirmation = 'proposed'; delete selected.confirmedAt
    markConflicts(ledger); invalidateReviews(ledger, ['requirement', 'integrity'])
    return [{ path: `.scholarflow/planning/requirements/${newId('decision')}.json`, before: undefined, after: json(archive) }]
  })
}
