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
export const semanticReviewChecks = ['argument_assessment', 'style_assessment', 'terminology_consistency', 'contribution_consistency', 'summary_body_consistency'] as const
export const pendingModelReviewDetails = {
  argument_assessment:'本轮未执行模型辅助论证审查；支持范围、反例与推论质量仍需审阅。',
  style_assessment:'本轮未执行模型辅助文风审查；不存在课程成绩或接收概率评分。',
  terminology_consistency:'本轮未审查跨节术语指代与已确认术语的一致性；需要全文模型辅助或人工核对。',
  contribution_consistency:'本轮未核对各节贡献项的数量、名称、范围及实际依据是否一致；不能把未实施贡献当作已完成。',
  summary_body_consistency:'本轮未将摘要和结论与实际已保存正文比较；缺项、待补实验和超出证据的总结保持未知。',
} as const
export const modelReviewRequest = z.object({ context: requestContext, assessmentScope: z.enum(['cross-section', 'argument-style']).default('cross-section') }).strict()
export const modelReviewOutputSchema = z.object({ checks: z.array(z.object({ id: z.enum(semanticReviewChecks), status: semanticStatus,
  detail: z.string().min(10).max(4000) }).strict()).min(2).max(5),
  findings: z.array(z.object({ category: z.enum(['citation', 'evidence', 'logic', 'structure', 'requirement', 'style', 'integrity']), severity: z.enum(['B0', 'B1', 'B2']),
    assessmentId: z.enum(semanticReviewChecks).optional(),
    title: z.string().min(1).max(500), explanation: z.string().min(10).max(4000), suggestedFix: z.string().min(1).max(4000), blockId: id, quote: z.string().min(1).max(4000),
    claimIds: z.array(id).max(100), evidenceIds: z.array(id).max(100), requirementIds: z.array(id).max(100) }).strict()).max(100),
  rechecks: z.array(z.object({ issueId: id, status: semanticStatus, reason: z.string().min(10).max(4000), blockId: id, quote: z.string().min(1).max(4000) }).strict()).max(100),
  limitations: z.array(z.string().min(1).max(4000)).max(50) }).strict()
export type ModelReviewOutput = z.infer<typeof modelReviewOutputSchema>
