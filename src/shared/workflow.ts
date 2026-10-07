import { z } from 'zod'
import { stage, hash, id, requestContext } from './schema.ts'
export const workflowGoalSchema = z.object({ researchQuestion: z.string().trim().min(3).max(4000),
  minimumSources: z.number().int().min(1).max(80).default(1), minimumLocatedEvidence: z.number().int().min(1).max(1000).default(1),
  noFormalRequirementsReason: z.string().trim().min(10).max(4000).optional() }).strict()
export type WorkflowGoal = z.infer<typeof workflowGoalSchema>
export const workflowStageState = z.enum(['pending', 'ready', 'running', 'blocked', 'completed', 'stale', 'skipped', 'failed'])
export const workflowStageSchema = z.object({ stage, state: workflowStageState, fingerprint: hash, canComplete: z.boolean(), canSkip: z.boolean(),
  outcome: z.enum(['ready', 'with-issues', 'insufficient', 'blocked']), artifacts: z.array(z.string().max(300)).max(200),
  reasons: z.array(z.string().max(4000)).max(100) }).strict()
export type WorkflowStageGate = z.infer<typeof workflowStageSchema>
export const workflowPrepareRequest = z.object({ context: requestContext, goal: workflowGoalSchema }).strict()
export const workflowActionRequest = z.object({ context: requestContext, workflowId: id,
  action: z.enum(['complete-stage', 'skip-stage', 'stop-revision', 'pause', 'resume', 'cancel', 'finish', 'close-unknown-call']),
  stage: stage.optional(), callId: id.optional(), reason: z.string().trim().max(4000).default('') }).strict()
export const workflowStampSchema = z.object({ stage, fingerprint: hash, outcome: z.enum(['ready', 'with-issues', 'insufficient']),
  decision: z.enum(['completed', 'skipped', 'stopped']), reason: z.string().max(4000), artifacts: z.array(z.string().max(300)).max(200),
  decidedAt: z.string(), sessionId: id }).strict()
export const workflowCheckpointSchema = z.object({ schemaVersion: z.literal(1), workflowId: id, projectId: id, planHash: hash,
  revision: z.number().int().min(0), status: z.enum(['waiting-input', 'paused', 'cancelled', 'succeeded', 'completed-with-issues']),
  stamps: z.array(workflowStampSchema).max(7), updatedAt: z.string(),
  automaticBudget: z.object({ maxSteps: z.number().int().min(7).max(64), usedSteps: z.number().int().min(0),
    maxNoProgress: z.number().int().min(1).max(3), noProgress: z.number().int().min(0), progressHash: hash }).strict().optional(),
  budget: z.object({ calls: z.array(z.object({ callId: id, runId: id, stage, kind: z.enum(['model', 'search', 'lookup']),
    state: z.enum(['pending', 'succeeded', 'failed', 'interrupted']), startedAt: z.string(), completedAt: z.string().optional(),
    owner: z.object({ pid: z.number().int().min(1), bootInstance: z.string().min(1).max(200) }).strict().optional(),
    reservedCandidates: z.number().int().min(0).max(80), receivedCandidates: z.number().int().min(0).max(80),
    startDurationMs: z.number().int().nonnegative() }).strict()), childDurationMs: z.record(id, z.number().int().nonnegative()) }).strict().optional(),
}).strict()
export type WorkflowCheckpoint = z.infer<typeof workflowCheckpointSchema>
