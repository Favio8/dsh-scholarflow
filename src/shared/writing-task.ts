import { z } from 'zod'
import { id, hash, requestContext, projectType, relativePath } from './schema.ts'
import { exportFormat } from './presentation.ts'
import { presetId, presetSource, supplementalPart } from './presets.ts'

export const writingSection = z.object({ id, title: z.string().trim().min(1).max(160), purpose: z.string().max(2000).default(''),
  targetLength: z.number().int().min(50).max(30000),
  // Only a manual value is locked; editing a title or reordering never changes this.
  allocationMode: z.enum(['auto', 'manual']).default('manual'),
  // Zero is a container chapter: it holds a place for its subsections and the allocator
  // floors it to the section minimum instead of giving it a share of the budget.
  allocationWeight: z.number().nonnegative().finite().optional(),
  // A subsection hangs off its chapter; absent means a top-level chapter.
  parentId: id.optional(),
  // Front and back matter are drafted after the body, because a summary can only
  // summarise text that already exists. References never appear here: the exporter
  // builds them from the citation order.
  kind: z.enum(['body', 'front', 'back']).default('body') }).strict()

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
 *
 * The layout fields below carry the conventions a Chinese coursework paper is normally
 * submitted under. They are fields, not constants, so a requirement that states otherwise
 * overrides them; the exporter never prefers its own default over a stated one.
 */
// Model-authored and user-editable: a number written as a string is coerced, extra keys are
// stripped, and an absent field keeps its default. `.strict()` here rejected usable 排版 values.
export const typographySpec = z.object({ bodyFontZh: z.string().trim().min(1).max(80).default('宋体'),
  bodyFontEn: z.string().trim().min(1).max(80).default('Times New Roman'), bodySizePt: z.coerce.number().min(6).max(36).default(12),
  bodySizeLabel: z.string().trim().max(20).default('小四'), lineSpacing: z.coerce.number().min(1).max(3).default(1.2),
  marginsMm: z.coerce.number().min(10).max(50).default(25),
  headingNumbering: z.enum(['none', 'decimal', 'chinese']).default('decimal'),
  headingFontZh: z.string().trim().min(1).max(80).default('黑体'),
  firstLineIndentChars: z.coerce.number().min(0).max(6).default(2),
  captionSizePt: z.coerce.number().min(6).max(24).default(10.5),
  tableStyle: z.enum(['three-line', 'grid']).default('three-line'),
  referenceStyle: z.enum(['gbt7714', 'plain']).default('gbt7714'),
  tableOfContents: z.enum(['none', 'field', 'auto']).default('auto') }).prefault({})
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
export const briefCoverageItem = z.object({ id: id.optional(), text: z.string().trim().min(1).max(2000),
  kind: z.enum(['question', 'dimension', 'rubric']).default('dimension'), sourceRef: z.string().max(400).optional() }).strict()
/** Model-authored text can be empty or absent; an unusable decision is dropped, not fatal. */
const loose = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(value => value === null || value === undefined ? undefined : value, schema)
export const briefDecision = z.object({ topic: z.string().trim().max(200).default(''), question: z.string().trim().max(2000).default(''),
  options: z.array(z.string().trim().min(1).max(400)).max(6).default([]), blocked: z.boolean().default(false),
  values: z.array(z.object({ label: z.string().trim().min(1).max(200), value: z.string().trim().max(2000), origin: briefOrigin }).strict()).max(6).default([]) }).strict()
/** The six groups PRD §3.2 asks for; a group the source never mentioned stays absent. */
export const requirementBrief = z.object({ schemaVersion: z.literal(2).default(2),
  task: z.object({ nature: loose(z.string().max(2000).optional()), subject: loose(z.string().max(2000).optional()),
    deliverable: loose(z.string().max(2000).optional()) }).prefault({}),
  coverage: z.array(briefCoverageItem).max(60).default([]), length: lengthSpec.prefault({}),
  format: z.object({ fileFormat: loose(z.string().max(200).optional()), citationStyle: loose(z.string().max(200).optional()),
    cover: loose(z.boolean().optional()) }).prefault({}),
  submission: z.object({ when: loose(z.string().max(500).optional()), where: loose(z.string().max(500).optional()), how: loose(z.string().max(500).optional()),
    needsConfirmation: z.array(z.string().max(200)).max(20).default([]) }).prefault({}),
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
  skipped: z.number().int().nonnegative().default(0),
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
export const outlineRequirement = z.object({ id, text: z.string().trim().min(1).max(2000), quote: z.string().max(2000) }).strict()
export const outlineCoverageScope = z.enum(['sections', 'document', 'submission', 'unclassified'])
export const outlineDocumentField = z.enum(['cover', 'format', 'bodyTarget', 'plannedBodyLength', 'typography', 'requestedPages', 'submission'])
export const semanticCoverage = z.object({ itemId: id, sectionIds: z.array(id).max(60),
  scope: outlineCoverageScope.optional(), documentFields: z.array(outlineDocumentField).max(7).optional(),
  status: z.enum(['covered', 'partial', 'missing', 'pending']), reason: z.string().trim().min(1).max(2000) }).strict()
export const outlineReview = z.object({ coverage: z.array(semanticCoverage).max(60),
  issues: z.array(z.string().max(1000)).max(30).default([]) }).strict()
export const outlineGeneration = z.object({ taskSummary: z.string().trim().min(1).max(2000),
  targetLength: z.number().int().min(200).max(60000), sections: z.array(writingSection).min(1).max(60),
  requirements: z.array(outlineRequirement).min(1).max(60) }).strict()
export const outlineCoverage = z.object({ itemId: id, text: z.string().max(2000), sectionIds: z.array(id).max(60), covered: z.boolean(),
  scope: outlineCoverageScope.optional(), documentFields: z.array(outlineDocumentField).max(7).optional(),
  status: z.enum(['covered', 'partial', 'missing', 'pending']).optional(), reason: z.string().max(2000).optional() }).strict()
export const outlineChange = z.object({ sectionId: id.optional(), title: z.string().max(160),
  kind: z.enum(['added', 'removed', 'renamed', 'reordered', 'reallocated']), before: z.string().max(400).optional(), after: z.string().max(400).optional() }).strict()
export const requirementCandidate = z.object({ schemaVersion: z.literal(1), candidateId: id, kind: z.literal('requirements'),
  projectId: id, sessionId: id, basedOn: candidateBasis, brief: requirementBrief, readIds: z.array(id).max(20).default([]),
  diff: z.array(candidateDiff).max(200).default([]), conflicts: z.array(candidateConflict).max(40).default([]),
  state: z.enum(['pending', 'adopted', 'discarded', 'stale']), createdAt: z.string(), updatedAt: z.string() }).strict()
export const outlineCandidate = z.object({ schemaVersion: z.literal(1), candidateId: id, kind: z.literal('outline'),
  taskSummary: z.string().max(2000).optional(), targetLength: z.number().int().min(200).max(60000).optional(),
  requirements: z.array(outlineRequirement).max(60).optional(), review: outlineReview.optional(),
  materialNotes: z.array(z.string().max(1000)).max(500).optional(), materialHashes: z.record(z.string(), hash).optional(),
  projectId: id, sessionId: id, basedOn: candidateBasis, sections: z.array(writingSection).min(1).max(60),
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
  structureOrigin: z.enum(['manual', 'preset', 'generated']).optional(), targetLengthOrigin: z.enum(['user', 'requirements']).optional(),
  format: exportFormat, requirements: z.string().trim().min(1).max(12000),
  // Read-only compatibility: a stored project may still carry the single assignment file.
  assignmentPath: relativePath.optional(),
  requirementSources: z.array(requirementSource).max(200).default([]),
  materials: z.array(relativePath).max(500), online: z.boolean().default(false), targetLength: z.number().int().min(200).max(60000),
  countingPolicy, sections: z.array(writingSection).min(1).max(60), preset: presetSelection.optional(),
  // Which front and back matter this paper drafts. A snapshot, not a reference: deleting a
  // preset must not change the paper (SPEC v1.1 §6).
  supplementalParts: z.array(supplementalPart).max(12).default([]),
  // v1.2 additions: all optional so a stored draft keeps parsing (SPEC v1.2 §19).
  brief: requirementBrief.optional(), typography: typographySpec.optional(), cover: coverSpec.optional(),
  overrides: z.array(specOverride).max(40).default([]),
  manuscriptDir: relativePath.default('manuscript') }).strict()

export type CreationSpec = z.infer<typeof creationSpec>
/** Reading and adopting requirements happen before the title or requirement text exists.
 * Keep submission strict; a selected file is input to reading, not confirmed requirements. */
export const requirementDraftSpec = creationSpec.extend({
  sections: z.array(writingSection).max(60),
  title: z.string().trim().max(300),
  requirements: z.string().trim().max(12000),
}).superRefine((spec, ctx) => {
  if (!spec.requirements && !spec.requirementSources.length && !spec.assignmentPath)
    ctx.addIssue({ code: 'custom', path: ['requirements'], message: '请填写写作要求，或添加要求文件／文件夹。' })
})
export type RequirementSource = z.infer<typeof requirementSource>
export type CountingPolicy = z.infer<typeof countingPolicy>
export type PresetSelection = z.infer<typeof presetSelection>
export const writingSourceConflict = z.object({ materialId: id, materialPath: relativePath, materialHash: hash, title: z.string().min(1),
  configHash: hash, ledgerHash: hash, ledgerRevision: z.number().int().nonnegative(), previewHash: hash,
  matches: z.array(z.object({ sourceId: id, sourceHash: hash, title: z.string(), citeKey: z.string(),
    materialPath: relativePath.optional(), contentHash: hash.optional() }).strict()).min(1).max(1000) }).strict()
export const writingQuestion = z.object({ id, title: z.string().min(1).max(2000), options: z.array(z.string().min(1).max(1000)).max(6),
  kind: z.enum(['requirements', 'materials', 'conflict', 'failure']), answered: z.string().max(12000).optional(),
  sourceConflict: writingSourceConflict.optional() }).strict()
// Only persisted history accepts budget; producers still use writingQuestion above.
const storedWritingQuestion = writingQuestion.extend({ kind: z.enum(['requirements', 'materials', 'conflict', 'failure', 'budget']) })
export const pendingQuestion = (row: { kind: string; answered?: string }) => row.kind !== 'budget' && row.answered === undefined
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
  materialSummaries: z.array(z.string()).default([]), modelReviewComplete: z.boolean().default(false),
  revisionPlan: z.object({ inputHash: hash, items: z.array(z.object({ sectionId: id, instruction: z.string().max(4000) }).strict()), index: z.number().int().nonnegative() }).strict().optional(),
  lastReviewSignature: hash.optional(), reviewStalls: z.number().int().nonnegative().default(0), generatedSectionHashes: z.record(id, hash).default({}),
  lastSemanticReviewSignature: hash.optional(), semanticReviewStalls: z.number().int().nonnegative().default(0),
  researchComplete: z.boolean().default(false), usedSearchQueries: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(),
  owner: z.string(), expectedDocumentHash: hash, childRunId: id.optional(), pendingProposalId: id.optional(),
  questions: z.array(storedWritingQuestion), notes: z.array(z.string()), issues: z.array(taskIssue).max(200).default([]),
  consecutiveFailures: z.number().int().nonnegative().default(0), progressMark: z.number().int().nonnegative().default(0), onlineSources: z.array(id),
  createdAt: z.string(), updatedAt: z.string() }).strict()
export type WritingTask = z.infer<typeof writingTaskSchema>
/** File work units only: a selected folder authorises its members, not a material
 * called after the folder itself. Shared by scheduling and progress counters. */
export function writingReadPaths(spec: CreationSpec) {
  const paths = new Set(spec.materials)
  if (!spec.requirementSources.length && spec.assignmentPath) paths.add(spec.assignmentPath)
  for (const source of spec.requirementSources) {
    if (source.origin !== 'workspace') continue
    if (source.kind === 'file' && source.path) paths.add(source.path)
    if (source.kind === 'folder') for (const member of source.members) paths.add(member.name)
  }
  return [...paths]
}
export const creationPrepareRequest = z.object({ context: requestContext, spec: creationSpec }).strict()
export const writingTaskRequest = z.object({ context: requestContext, taskId: id.optional() }).strict()
export const writingRequirementsRequest = z.object({ context: requestContext }).strict()
export const writingPreferencesRequest = z.object({ context: requestContext, spec: creationSpec, baseSpecHash: hash.nullable().optional() }).strict()
export const writingTaskAction = writingTaskRequest.extend({ action: z.enum(['pause', 'resume', 'cancel', 'answer']),
  materials: z.array(relativePath).max(500).optional(), questionId: id.optional(), answer: z.string().trim().max(12000).optional(),
  duplicateDecision: z.literal('keep-separate').optional(), sourceConflictHash: hash.optional() }).strict()
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
    targetLength: Math.max(50, Math.round(length / titles.length)), allocationMode: 'auto' as const, kind: 'body' as const }))
}
