import { z } from 'zod'
import { id, hash, requestContext, projectType, relativePath } from './schema.ts'
import { exportFormat } from './presentation.ts'
import { presetId, presetSource } from './presets.ts'

export const writingSection = z.object({ id, title: z.string().trim().min(1).max(160), purpose: z.string().max(2000).default(''),
  targetLength: z.number().int().min(50).max(30000),
  // Only a manual value is locked; editing a title or reordering never changes this.
  allocationMode: z.enum(['auto', 'manual']).default('manual'),
  allocationWeight: z.number().positive().finite().optional() }).strict()

/** One requirement source member; folders list what was confirmed, never the whole disk. */
export const requirementSourceMember = z.object({ name: z.string().min(1).max(800),
  size: z.number().int().nonnegative().optional() }).strict()
/**
 * Requirement sources are independent of the reference materials: the host reads
 * exactly what the user authorised, and an external entry carries an opaque handle
 * instead of an absolute path (SPEC v1.1 §5.2, §7).
 */
export const requirementSource = z.object({ resourceId: id, origin: z.enum(['workspace', 'external']), kind: z.enum(['file', 'folder']),
  path: relativePath.optional(), handle: z.string().min(1).max(2000).optional(),
  members: z.array(requirementSourceMember).max(500).default([]),
  role: z.enum(['assignment', 'rubric', 'notes']).default('assignment'),
  state: z.enum(['selected', 'connected', 'disconnected']).default('selected') }).strict()
  .refine(source => source.origin === 'workspace' ? !!source.path && !source.handle : !!source.handle && !source.path,
    '工作区来源使用相对路径，外部来源使用受控句柄，二者不混用。')

export const countingPolicy = z.object({ unit: z.enum(['zh-CN', 'en']).optional(), scope: z.literal('body').default('body'),
  includeAbstract: z.boolean().default(false), algorithmVersion: z.literal(1).default(1) }).strict().prefault({})

/**
 * Typography is an executable field, not prose about fonts (SPEC v1.2 §16.1): every value
 * here maps onto a DOCX property the exporter actually writes.
 */
export const typographySpec = z.object({ bodyFontZh: z.string().trim().min(1).max(80).default('宋体'),
  bodyFontEn: z.string().trim().min(1).max(80).default('Times New Roman'), bodySizePt: z.number().min(6).max(36).default(12),
  bodySizeLabel: z.string().trim().max(20).default('小四'), lineSpacing: z.number().min(1).max(3).default(1.2),
  marginsMm: z.number().min(10).max(50).default(25) }).strict().prefault({})
export type TypographySpec = z.infer<typeof typographySpec>

/** Cover fields start empty: no reference document may leak a name or a date in (SPEC §18). */
export const coverSpec = z.object({ enabled: z.boolean().default(false), title: z.string().trim().max(300).default(''),
  fields: z.array(z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().max(200) }).strict()).max(12).default([]),
  date: z.string().trim().max(40).default('') }).strict().prefault({})
export type CoverSpec = z.infer<typeof coverSpec>

/**
 * Length keeps "约 1500 字" as an approximation (SPEC v1.2 §4.2): `value` is the number the
 * user sees, `approximate` records that it was written with 约, and page counts never get
 * derived from, or converted into, a character count.
 */
export const lengthSpec = z.object({ value: z.number().int().min(50).max(200000).optional(), unit: z.enum(['zh-characters', 'words']).default('zh-characters'),
  approximate: z.boolean().default(true), min: z.number().int().min(1).max(200000).optional(), max: z.number().int().min(1).max(200000).optional(),
  pages: z.number().int().min(1).max(200).optional(), coverPages: z.number().int().min(0).max(20).optional(),
  bodyPages: z.number().int().min(0).max(200).optional(), sourceRef: z.string().max(400).optional() }).strict().prefault({})
export type LengthSpec = z.infer<typeof lengthSpec>

const briefOrigin = z.enum(['teacher', 'user', 'suggestion', 'unspecified', 'unread'])
export const briefCoverageItem = z.object({ id, text: z.string().trim().min(1).max(2000),
  kind: z.enum(['question', 'dimension', 'rubric']).default('dimension'), sourceRef: z.string().max(400).optional() }).strict()
export const briefDecision = z.object({ topic: z.string().trim().min(1).max(200), question: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(400)).min(1).max(6), blocked: z.boolean().default(false),
  values: z.array(z.object({ label: z.string().trim().min(1).max(200), value: z.string().trim().max(2000), origin: briefOrigin }).strict()).max(6).default([]) }).strict()
/** The six groups PRD §3.2 asks for; a group the source never mentioned stays absent. */
export const requirementBrief = z.object({ schemaVersion: z.literal(2).default(2),
  task: z.object({ nature: z.string().max(2000).optional(), subject: z.string().max(2000).optional(), deliverable: z.string().max(2000).optional() }).strict().prefault({}),
  coverage: z.array(briefCoverageItem).max(60).default([]), length: lengthSpec.prefault({}),
  format: z.object({ fileFormat: z.string().max(200).optional(), citationStyle: z.string().max(200).optional(), cover: z.boolean().optional() }).strict().prefault({}),
  submission: z.object({ when: z.string().max(500).optional(), where: z.string().max(500).optional(), how: z.string().max(500).optional(),
    needsConfirmation: z.array(z.string().max(200)).max(20).default([]) }).strict().prefault({}),
  typography: typographySpec.optional(), decisions: z.array(briefDecision).max(20).default([]),
  origins: z.record(z.string().max(200), briefOrigin).default({}), text: z.string().max(12000).optional(),
  readIds: z.array(id).max(20).default([]), model: z.string().max(200).optional() }).strict().prefault({})
export type RequirementBrief = z.infer<typeof requirementBrief>

/** One member of a requirement source, read on its own: folders never stand in for files. */
export const requirementReadMember = z.object({ name: z.string().min(1).max(800), sourceId: id,
  kind: z.enum(['text', 'pdf', 'image', 'unsupported']), state: z.enum(['pending', 'reading', 'ready', 'failed']),
  text: z.string().max(12000).optional(), locator: z.object({ page: z.number().int().min(1).optional(), imageIndex: z.number().int().min(0).optional() }).strict().optional(),
  note: z.string().max(500).optional(), noteKind: z.enum(['capability', 'read', 'authorisation', 'format']).optional(),
  bytes: z.number().int().nonnegative().default(0) }).strict()
export type RequirementReadMember = z.infer<typeof requirementReadMember>
export const requirementRead = z.object({ schemaVersion: z.literal(1), readId: id, projectId: id, sessionId: id,
  members: z.array(requirementReadMember).max(500), state: z.enum(['reading', 'ready', 'stopped', 'failed']),
  phase: z.string().max(200), done: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
  startedAt: z.string(), updatedAt: z.string(), elapsedMs: z.number().nonnegative(),
  model: z.string().max(200).optional(), recognitionModel: z.string().max(200).optional(), error: z.string().max(1000).optional() }).strict()
export type RequirementRead = z.infer<typeof requirementRead>

/** Issues are shown by what they ask of the user, not by the order they happened (SPEC §9). */
export const taskIssue = z.object({ id, key: z.string().min(1).max(400), group: z.enum(['needs-action', 'in-progress', 'handled']),
  object: z.string().min(1).max(800), what: z.string().min(1).max(1000), impact: z.string().max(1000).default(''),
  actions: z.array(z.object({ label: z.string().min(1).max(80), op: z.string().min(1).max(80) }).strict()).max(6).default([]),
  detail: z.string().max(4000).optional(), occurrences: z.number().int().min(1).default(1), at: z.string() }).strict()
export type TaskIssue = z.infer<typeof taskIssue>

/** A candidate is only adoptable while the inputs it was built from are still current. */
export const candidateBasis = z.object({ specHash: hash, requirementsHash: hash, readsHash: hash.optional(), outlineHash: hash.optional() }).strict()
export const candidateDiff = z.object({ path: z.string().min(1).max(200), label: z.string().max(200),
  before: z.string().max(4000).optional(), after: z.string().max(4000), kind: z.enum(['added', 'changed', 'conflict']) }).strict()
export const candidateConflict = z.object({ topic: z.string().min(1).max(200), current: z.string().max(2000), candidate: z.string().max(2000),
  source: z.string().max(400).optional(), preferred: z.enum(['current', 'candidate']) }).strict()
export const outlineCoverage = z.object({ itemId: id, text: z.string().max(2000), sectionIds: z.array(id).max(40), covered: z.boolean() }).strict()
export const outlineChange = z.object({ sectionId: id.optional(), title: z.string().max(160),
  kind: z.enum(['added', 'removed', 'renamed', 'reordered', 'reallocated']), before: z.string().max(400).optional(), after: z.string().max(400).optional() }).strict()
export const requirementCandidate = z.object({ schemaVersion: z.literal(1), candidateId: id, kind: z.literal('requirements'),
  projectId: id, sessionId: id, basedOn: candidateBasis, brief: requirementBrief, readIds: z.array(id).max(20).default([]),
  diff: z.array(candidateDiff).max(200).default([]), conflicts: z.array(candidateConflict).max(40).default([]),
  state: z.enum(['pending', 'adopted', 'discarded', 'stale']), createdAt: z.string(), updatedAt: z.string() }).strict()
export const outlineCandidate = z.object({ schemaVersion: z.literal(1), candidateId: id, kind: z.literal('outline'),
  projectId: id, sessionId: id, basedOn: candidateBasis, sections: z.array(writingSection).min(1).max(40),
  changes: z.array(outlineChange).max(80).default([]), coverage: z.array(outlineCoverage).max(60).default([]),
  gaps: z.array(z.string().max(1000)).max(40).default([]), conflicts: z.array(candidateConflict).max(40).default([]),
  state: z.enum(['pending', 'adopted', 'discarded', 'stale']), createdAt: z.string(), updatedAt: z.string() }).strict()
export type RequirementCandidate = z.infer<typeof requirementCandidate>
export type OutlineCandidate = z.infer<typeof outlineCandidate>

/** Which preset this paper started from; the structure itself is the snapshot below. */
export const presetSelection = z.object({ id: presetId, source: presetSource, version: z.string().regex(/^\d+\.\d+\.\d+$/),
  derivedFrom: presetId.optional(), modified: z.boolean().default(false) }).strict()

/** A deliberate choice to depart from a confirmed requirement, kept for the quality report. */
export const specOverride = z.object({ field: z.string().min(1).max(200), requirementValue: z.string().max(2000),
  chosenValue: z.string().max(2000), at: z.string() }).strict()

export const creationSpec = z.object({ title: z.string().trim().min(1).max(300), type: projectType, language: z.enum(['zh-CN', 'en']),
  format: exportFormat, requirements: z.string().trim().min(1).max(12000),
  // Read-only compatibility: a stored project may still carry the single assignment file.
  assignmentPath: relativePath.optional(),
  requirementSources: z.array(requirementSource).max(200).default([]),
  materials: z.array(relativePath).max(500), online: z.boolean().default(false), targetLength: z.number().int().min(200).max(60000),
  countingPolicy, sections: z.array(writingSection).min(1).max(40), preset: presetSelection.optional(),
  // v1.2 additions: all optional so a stored draft keeps parsing (SPEC v1.2 §19).
  brief: requirementBrief.optional(), typography: typographySpec.optional(), cover: coverSpec.optional(),
  overrides: z.array(specOverride).max(40).default([]),
  manuscriptDir: relativePath.default('manuscript') }).strict()

export type CreationSpec = z.infer<typeof creationSpec>
export type RequirementSource = z.infer<typeof requirementSource>
export type CountingPolicy = z.infer<typeof countingPolicy>
export type PresetSelection = z.infer<typeof presetSelection>
export const writingQuestion = z.object({ id, title: z.string().min(1).max(2000), options: z.array(z.string().min(1).max(1000)).max(6),
  kind: z.enum(['requirements', 'materials', 'conflict', 'failure']), answered: z.string().max(12000).optional() }).strict()
/**
 * `usedModelCalls` and `elapsedMs` are telemetry (SPEC v1.2 §8): they are reported, never
 * enforced. `modelCallAllowance` survives only so a stored v1.1 task still parses.
 */
export const writingTaskSchema = z.object({ schemaVersion: z.literal(1), id, projectId: id, sessionId: id, spec: creationSpec,
  status: z.enum(['queued', 'running', 'waiting-input', 'paused', 'interrupted', 'cancelled', 'completed', 'failed']),
  stage: z.enum(['materials', 'research', 'evidence', 'outline', 'drafting', 'review', 'completed']),
  revision: z.number().int().nonnegative(), materialIndex: z.number().int().nonnegative(), sectionIndex: z.number().int().nonnegative(),
  usedModelCalls: z.number().int().nonnegative(), modelCallAllowance: z.number().int().positive().optional(),
  searchQueries: z.array(z.string()).default([]), searchQueryIndex: z.number().int().nonnegative().default(0),
  evidenceMaterialIndex: z.number().int().nonnegative().default(0), evidenceBlockIndex: z.number().int().nonnegative().default(0),
  materialSummaries: z.array(z.string()).default([]), modelReviewComplete: z.boolean().default(false), researchComplete: z.boolean().default(false), usedSearchQueries: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(),
  owner: z.string(), expectedDocumentHash: hash, childRunId: id.optional(), pendingProposalId: id.optional(),
  questions: z.array(writingQuestion), notes: z.array(z.string()), issues: z.array(taskIssue).max(200).default([]),
  consecutiveFailures: z.number().int().nonnegative().default(0), progressMark: z.number().int().nonnegative().default(0), onlineSources: z.array(id),
  createdAt: z.string(), updatedAt: z.string() }).strict()
export type WritingTask = z.infer<typeof writingTaskSchema>
export const creationPrepareRequest = z.object({ context: requestContext, spec: creationSpec }).strict()
export const writingTaskRequest = z.object({ context: requestContext, taskId: id.optional() }).strict()
export const writingTaskAction = writingTaskRequest.extend({ action: z.enum(['pause', 'resume', 'cancel', 'answer']),
  materials: z.array(relativePath).max(500).optional(), questionId: id.optional(), answer: z.string().trim().max(12000).optional() }).strict()
export const cowriteRequest = z.object({ context: requestContext, text: z.string().max(2 * 1024 * 1024), baseDocumentHash: hash,
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), instruction: z.string().trim().min(1).max(12000) }).strict()
/**
 * `baseBufferHash` covers a selection that is not saved yet (SPEC v1.2 §12.2): the editor
 * buffer is the basis, while `baseDocumentHash` still guards the committed manuscript.
 */
export const cowriteProposalRequest = cowriteRequest.extend({ baseBufferHash: hash.optional(), action: z.enum(['rewrite', 'polish', 'shorten', 'expand', 'custom']).default('custom'),
  instruction: z.string().trim().max(12000).default('') }).strict()
export const cowriteSuggestion = z.object({ schemaVersion: z.literal(1), id, projectId: id, sessionId: id, baseBufferHash: hash,
  baseDocumentHash: hash, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), before: z.string(), after: z.string(),
  protectedFactChanges: z.array(z.string()).default([]), citationChanges: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }).default({ added: [], removed: [] }),
  instruction: z.string(), action: z.enum(['rewrite', 'polish', 'shorten', 'expand', 'custom']).default('custom'),
  blockId: id.optional(), state: z.enum(['pending', 'accepted', 'rejected']), createdAt: z.string(), updatedAt: z.string() }).strict()

export const STRUCTURES: Record<CreationSpec['type'], string[]> = {
  'course-paper': ['引言', '主题分析', '讨论', '结论'],
  'literature-review': ['引言', '文献范围与检索方法', '主题综述', '讨论与展望', '结论'],
  'research-paper': ['引言', '研究方法', '结果', '讨论', '结论'],
}
// Offline fallback used before the preset library answers. Lengths stay automatic so a
// changed target recomputes them; the preset list replaces this in the wizard (Phase 4).
export function presetSections(type: CreationSpec['type'], length: number) {
  const titles = STRUCTURES[type]
  return titles.map((title, index) => ({ id: `section_${index + 1}`, title, purpose: '',
    targetLength: Math.max(50, Math.round(length / titles.length)), allocationMode: 'auto' as const }))
}
