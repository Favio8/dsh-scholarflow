import { z } from 'zod'
import { hash, id, requestContext } from './schema.ts'
import { searchInput } from './online-research.ts'
import { runSnapshotSchema } from './runs.ts'

export const batchPrepareRequest = z.object({ context: requestContext, searches: z.array(searchInput).min(1).max(12) }).strict()
export const batchActionRequest = z.object({ context: requestContext, runId: id, action: z.enum(['resume', 'retry', 'close']) }).strict()
export const batchPlanSchema = z.object({ schemaVersion: z.literal(1), id, snapshot: runSnapshotSchema,
  ledgerHash: hash, searches: z.array(z.object({ queryId: id, search: searchInput }).strict()).min(1).max(12),
  parentRunId: id.optional(), contentHash: hash }).strict()
export const batchCheckpointSchema = z.object({ schemaVersion: z.literal(1), runId: id, projectId: id, planHash: hash,
  queriesUsed: z.number().int().min(0).max(12), candidatesReceived: z.number().int().min(0).max(80),
  queries: z.array(z.object({ queryId: id, state: z.enum(['pending', 'running', 'completed', 'failed']),
    attempts: z.array(z.object({ searchId: id, state: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
      outcomeHash: hash.optional(), errorCode: z.string().max(100).optional() }).strict()).max(3),
    transientRetries: z.number().int().min(0).max(2), retryNotBefore: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }).strict()).min(1).max(12) }).strict()
export type ResearchBatchPlan = z.infer<typeof batchPlanSchema>
export type ResearchBatchCheckpoint = z.infer<typeof batchCheckpointSchema>
