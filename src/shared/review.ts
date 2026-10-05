import { z } from 'zod'
import { id, hash, issueSchema, requestContext } from './schema.ts'

export const reviewReportSchema = z.object({ schemaVersion: z.literal(1), id, projectId: id, documentId: z.literal('paper'),
  documentHash: hash, revisionId: id, ledgerRevision: z.number().int().min(0), dependencyHash: hash, createdAt: z.string(),
  checks: z.array(z.object({ id, status: z.enum(['pass', 'fail', 'unknown']), method: z.enum(['deterministic', 'model-assisted', 'manual']), detail: z.string() }).strict()),
  issues: z.array(issueSchema), limitations: z.array(z.string()),
  statistics: z.object({ chineseCharacters: z.number().int().min(0), westernWords: z.number().int().min(0), uniqueReferences: z.number().int().min(0), countingPolicyId: z.string() }).strict(),
  parentReviewId: id.optional(), manualAssessmentId: id.optional(), modelRunId: id.optional(),
}).strict()
export type ReviewReport = z.infer<typeof reviewReportSchema>
export const issueDecisionRequest = z.object({ context: requestContext, issueId: id, state: z.enum(['accepted-risk', 'dismissed']), reason: z.string().trim().min(1).max(2000) }).strict()
export const exportCreateRequest = z.object({ context: requestContext, planId: id, planHash: hash, deliveryType: z.enum(['working-draft', 'reviewed-draft']) }).strict()
export const manualAssessmentSchema = z.object({ checkId: id, status: z.enum(['pass', 'fail', 'unknown']),
  reason: z.string().trim().min(10).max(4000), evidenceIds: z.array(id).max(100), claimIds: z.array(id).max(100), requirementIds: z.array(id).max(100) }).strict()
export const manualReviewRequest = z.object({ context: requestContext, reviewId: id, assessments: z.array(manualAssessmentSchema).min(1).max(100) }).strict()
const semanticStatus = z.enum(['pass', 'fail', 'unknown'])
export const modelReviewRequest = z.object({ context: requestContext }).strict()
export const modelReviewOutputSchema = z.object({ checks: z.array(z.object({ id: z.enum(['argument_assessment', 'style_assessment']), status: semanticStatus,
  detail: z.string().min(10).max(4000) }).strict()).length(2),
  findings: z.array(z.object({ category: z.enum(['citation', 'evidence', 'logic', 'structure', 'requirement', 'style', 'integrity']), severity: z.enum(['B0', 'B1', 'B2']),
    title: z.string().min(1).max(500), explanation: z.string().min(10).max(4000), suggestedFix: z.string().min(1).max(4000), blockId: id, quote: z.string().min(1).max(4000),
    claimIds: z.array(id).max(100), evidenceIds: z.array(id).max(100), requirementIds: z.array(id).max(100) }).strict()).max(100),
  rechecks: z.array(z.object({ issueId: id, status: semanticStatus, reason: z.string().min(10).max(4000), blockId: id, quote: z.string().min(1).max(4000) }).strict()).max(100),
  limitations: z.array(z.string().min(1).max(4000)).max(50) }).strict()
export type ModelReviewOutput = z.infer<typeof modelReviewOutputSchema>
