import { z } from 'zod'
import { id, hash, requestContext, projectType, relativePath } from './schema.ts'
import { exportFormat } from './presentation.ts'

export const writingSection = z.object({ id, title: z.string().trim().min(1).max(160), purpose: z.string().max(2000).default(''),
  targetLength: z.number().int().min(50).max(30000) }).strict()
export const creationSpec = z.object({ title: z.string().trim().min(1).max(300), type: projectType, language: z.enum(['zh-CN', 'en']),
  format: exportFormat, requirements: z.string().trim().min(1).max(12000), assignmentPath: relativePath.optional(),
  materials: z.array(relativePath).max(500), online: z.boolean().default(false), targetLength: z.number().int().min(200).max(60000),
  sections: z.array(writingSection).min(1).max(40), manuscriptDir: relativePath.default('manuscript') }).strict()
export type CreationSpec = z.infer<typeof creationSpec>
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
export function presetSections(type: CreationSpec['type'], length: number) {
  const titles = STRUCTURES[type]
  return titles.map((title, index) => ({ id: `section_${index + 1}`, title, purpose: '', targetLength: Math.max(50, Math.round(length / titles.length)) }))
}
