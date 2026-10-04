import { z } from 'zod'
import { hash, id, requestContext } from './schema.ts'
import { selectionSchema } from './editing.ts'
export const generationRequest = z.object({ context: requestContext, instruction: z.string().min(1).max(16000), selection: selectionSchema.optional(), sectionId: id.optional() }).strict()
export const runStartRequest = z.object({ context: requestContext, planId: id, planHash: hash }).strict()
export const runControlRequest = z.object({ context: requestContext, runId: id }).strict()
export const runSnapshotSchema = z.object({ schemaVersion: z.literal(1), runId: id, projectId: id, sessionId: id, stage: z.enum(['drafting', 'revision']), configHash: hash,
  ledgerRevision: z.number().int().min(0), documentHash: hash, outlineVersion: z.number().int().min(0), materialHashes: z.record(id, hash), sourceHashes: z.record(id, hash), profileHash: hash,
  skillDigests: z.array(z.object({ qualifiedId: z.string(), digest: hash }).strict()), modelDescriptor: z.object({ providerId: z.string(), modelId: z.string() }).strict(),
  budget: z.object({ maxModelCalls: z.number().int().min(1).max(40), maxSearchQueries: z.number().int().min(0).max(12), maxCandidateSources: z.number().int().min(1).max(80), maxDurationMinutes: z.number().int().min(1).max(30) }).strict(),
  networkScope: z.literal('local-only'), createdAt: z.string() }).strict()
export const runStateSchema = z.object({ schemaVersion: z.literal(1), runId: id, projectId: id, sessionId: id, status: z.enum(['queued', 'running', 'waiting-input', 'paused', 'interrupted', 'failed', 'cancelled', 'succeeded', 'completed-with-issues']),
  usedModelCalls: z.number().int().min(0), startedAt: z.string(), updatedAt: z.string(), proposalId: id.optional(), errorCode: z.string().optional(),
  owner: z.object({ pid: z.number().int().min(1), bootInstance: z.string() }).strict() }).strict()
export type RunState = z.infer<typeof runStateSchema>
export type RunSnapshot = z.infer<typeof runSnapshotSchema>
