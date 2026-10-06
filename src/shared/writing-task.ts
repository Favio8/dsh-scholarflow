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

/** Which preset this paper started from; the structure itself is the snapshot below. */
export const presetSelection = z.object({ id: presetId, source: presetSource, version: z.string().regex(/^\d+\.\d+\.\d+$/),
  derivedFrom: presetId.optional(), modified: z.boolean().default(false) }).strict()

export const creationSpec = z.object({ title: z.string().trim().min(1).max(300), type: projectType, language: z.enum(['zh-CN', 'en']),
  format: exportFormat, requirements: z.string().trim().min(1).max(12000),
  // Read-only compatibility: a stored project may still carry the single assignment file.
  assignmentPath: relativePath.optional(),
  requirementSources: z.array(requirementSource).max(200).default([]),
  materials: z.array(relativePath).max(500), online: z.boolean().default(false), targetLength: z.number().int().min(200).max(60000),
  countingPolicy, sections: z.array(writingSection).min(1).max(40), preset: presetSelection.optional(),
  manuscriptDir: relativePath.default('manuscript') }).strict()
export type CreationSpec = z.infer<typeof creationSpec>
export type RequirementSource = z.infer<typeof requirementSource>
export type CountingPolicy = z.infer<typeof countingPolicy>
export type PresetSelection = z.infer<typeof presetSelection>
export const writingQuestion = z.object({ id, title: z.string().min(1).max(2000), options: z.array(z.string().min(1).max(1000)).max(6),
  kind: z.enum(['requirements', 'materials', 'conflict', 'budget', 'failure']), answered: z.string().max(12000).optional() }).strict()
export const writingTaskSchema = z.object({ schemaVersion: z.literal(1), id, projectId: id, sessionId: id, spec: creationSpec,
  status: z.enum(['queued', 'running', 'waiting-input', 'paused', 'interrupted', 'cancelled', 'completed', 'failed']),
  stage: z.enum(['materials', 'research', 'evidence', 'outline', 'drafting', 'review', 'completed']),
  revision: z.number().int().nonnegative(), materialIndex: z.number().int().nonnegative(), sectionIndex: z.number().int().nonnegative(),
  usedModelCalls: z.number().int().nonnegative(), modelCallAllowance: z.number().int().positive().default(40),
  searchQueries: z.array(z.string()).default([]), searchQueryIndex: z.number().int().nonnegative().default(0),
  evidenceMaterialIndex: z.number().int().nonnegative().default(0), evidenceBlockIndex: z.number().int().nonnegative().default(0),
  materialSummaries: z.array(z.string()).default([]), modelReviewComplete: z.boolean().default(false), researchComplete: z.boolean().default(false), usedSearchQueries: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(),
  owner: z.string(), expectedDocumentHash: hash, childRunId: id.optional(), pendingProposalId: id.optional(),
  questions: z.array(writingQuestion), notes: z.array(z.string()), onlineSources: z.array(id),
  createdAt: z.string(), updatedAt: z.string() }).strict()
export type WritingTask = z.infer<typeof writingTaskSchema>
export const creationPrepareRequest = z.object({ context: requestContext, spec: creationSpec }).strict()
export const writingTaskRequest = z.object({ context: requestContext, taskId: id.optional() }).strict()
export const writingTaskAction = writingTaskRequest.extend({ action: z.enum(['pause', 'resume', 'cancel', 'answer']),
  materials: z.array(relativePath).max(500).optional(), questionId: id.optional(), answer: z.string().trim().max(12000).optional() }).strict()
export const cowriteRequest = z.object({ context: requestContext, text: z.string().max(2 * 1024 * 1024), baseDocumentHash: hash,
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), instruction: z.string().trim().min(1).max(12000) }).strict()
export const cowriteSuggestion = z.object({ schemaVersion: z.literal(1), id, projectId: id, sessionId: id, baseBufferHash: hash,
  baseDocumentHash: hash, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), before: z.string(), after: z.string(),
  protectedFactChanges: z.array(z.string()).default([]), citationChanges: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }).default({ added: [], removed: [] }),
  instruction: z.string(), state: z.enum(['pending', 'accepted', 'rejected']), createdAt: z.string(), updatedAt: z.string() }).strict()

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
