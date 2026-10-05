import { z } from 'zod'
import { hash, id, requestContext, stage } from './schema.ts'
import { runSnapshotSchema, generationRequest } from './runs.ts'
import { searchInput } from './online-research.ts'

export const automaticPolicySchema = z.object({ ruleReview: z.boolean().default(true), workingDraftDelivery: z.boolean().default(false),
  insufficientResearchReason: z.string().trim().min(10).max(4000).optional(), stopRevisionReason: z.string().trim().min(10).max(4000).optional(),
  maxSteps: z.number().int().min(7).max(64).default(32), maxNoProgress: z.number().int().min(1).max(3).default(2) }).strict()
export const automaticPrepareRequest = z.object({ context: requestContext, workflowId: id, policy: automaticPolicySchema, modelReview: z.boolean().default(false),
  generation: z.object({ instruction: generationRequest.shape.instruction, selection: generationRequest.shape.selection,
    sectionId: generationRequest.shape.sectionId, skillBindingId: generationRequest.shape.skillBindingId, reviewIssueId: generationRequest.shape.reviewIssueId }).strict().optional(), draftSequenceId: id.optional(),
  revision: z.object({ issueId: id, instruction: generationRequest.shape.instruction }).strict().optional(),
  searches: z.array(searchInput).min(1).max(12).optional() }).strict()
  .refine(value => [value.modelReview, value.generation, value.draftSequenceId, value.revision, value.searches].filter(Boolean).length <= 1,
    'Each preview authorizes one fixed paid stage; accepted changes require a new preview')
export const automaticActionRequest = z.object({ context: requestContext, workflowId: id, automaticId: id,
  action: z.enum(['resume', 'close']), reason: z.string().trim().min(10).max(4000) }).strict()
export const automaticOperation = z.enum(['acknowledge', 'rules-review', 'model-review', 'model-generation', 'research-batch', 'working-delivery', 'finish'])
export const automaticReviewPinSchema = runSnapshotSchema.pick({ runId: true, modelDescriptor: true, skillDigests: true }).extend({ planHash: hash, inputBytes: z.number().int().nonnegative() }).strict()
export const automaticChildGrantSchema = z.object({ workflowId: id, automaticId: id, stepId: id, runId: id, planHash: hash }).strict()
export type AutomaticChildGrant = z.infer<typeof automaticChildGrantSchema>
export const automaticWorkPinSchema = automaticReviewPinSchema.extend({ kind: z.enum(['generation', 'research']),
  stage: z.enum(['drafting', 'revision', 'research']), draftSequenceId: id.optional() }).strict()
export const automaticInputSchema = z.object({ schemaVersion: z.literal(1), automaticId: id, workflowId: id, projectId: id, sessionId: id,
  workflowPlanHash: hash, dependencyHash: hash, policy: automaticPolicySchema, createdAt: z.string(), modelReview: automaticReviewPinSchema.optional(), work: automaticWorkPinSchema.optional() }).strict()
  .refine(value => !(value.modelReview && value.work), 'A fixed review cannot be rebased onto a newly generated draft')
export const automaticStateSchema = z.object({ schemaVersion: z.literal(1), automaticId: id, workflowId: id, projectId: id, inputHash: hash,
  status: z.enum(['queued', 'running', 'waiting-input', 'paused', 'interrupted', 'failed', 'cancelled', 'succeeded', 'completed-with-issues']),
  revision: z.number().int().nonnegative(), startedAt: z.string(), updatedAt: z.string(), reason: z.string().max(4000), code: id.optional(),
  owner: z.object({ pid: z.number().int().min(1), bootInstance: z.string().min(1).max(200) }).strict(),
  executionSessionId: id.optional(),
  steps: z.array(z.object({ stepId: id, number: z.number().int().min(1).max(64), stage: stage.optional(), operation: automaticOperation,
    beforeProgress: hash, afterProgress: hash.optional(), child: z.object({ runId: id, planHash: hash }).strict().optional(), state: z.enum(['pending', 'settled', 'interrupted']),
    startedAt: z.string(), completedAt: z.string().optional() }).strict()).max(64) }).strict()
export type AutomaticPolicy = z.infer<typeof automaticPolicySchema>
export type AutomaticState = z.infer<typeof automaticStateSchema>
