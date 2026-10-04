import { z } from 'zod'
import { hash, id, requestContext } from './schema.ts'
import { selectionSchema, paragraphClaimSchema, proposalSchema } from './editing.ts'
export const modelOutputSchema = z.object({ replacementText: z.string().min(1).max(2 * 1024 * 1024).refine(text => !!text.trim()), limitations: z.array(z.string()).max(100),
  sectionId: id.optional(), paragraphClaims: z.array(paragraphClaimSchema).max(2000).optional() }).strict()
export const generationRequest = z.object({ context: requestContext, instruction: z.string().min(1).max(16000), selection: selectionSchema.optional(), sectionId: id.optional(), skillBindingId: id.optional() }).strict()
  .refine(input => !(input.selection && input.sectionId), 'Selection and section scopes are mutually exclusive')
export const runStartRequest = z.object({ context: requestContext, planId: id, planHash: hash }).strict()
export const runControlRequest = z.object({ context: requestContext, runId: id }).strict()
export const runSnapshotSchema = z.object({ schemaVersion: z.literal(1), runId: id, projectId: id, sessionId: id, stage: z.enum(['drafting', 'revision']), configHash: hash,
  ledgerRevision: z.number().int().min(0), documentHash: hash, outlineVersion: z.number().int().min(0), materialHashes: z.record(id, hash), sourceHashes: z.record(id, hash), profileHash: hash,
  skillDigests: z.array(z.object({ qualifiedId: z.string(), digest: hash }).strict()), resourceLockHash: hash.optional(), modelDescriptor: z.object({ providerId: z.string(), modelId: z.string() }).strict(),
  budget: z.object({ maxModelCalls: z.number().int().min(1).max(40), maxSearchQueries: z.number().int().min(0).max(12), maxCandidateSources: z.number().int().min(1).max(80), maxDurationMinutes: z.number().int().min(1).max(30) }).strict(),
  networkScope: z.literal('local-only'), createdAt: z.string() }).strict()
export const runStateSchema = z.object({ schemaVersion: z.literal(1), runId: id, projectId: id, sessionId: id, status: z.enum(['queued', 'running', 'waiting-input', 'paused', 'interrupted', 'failed', 'cancelled', 'succeeded', 'completed-with-issues']),
  usedModelCalls: z.number().int().min(0), startedAt: z.string(), updatedAt: z.string(), proposalId: id.optional(), errorCode: z.string().optional(),
  planHash: hash.optional(), checkpointHash: hash.optional(), parentRunId: id.optional(), activeDurationMs: z.number().int().min(0).optional(), executionSessionId: id.optional(),
  owner: z.object({ pid: z.number().int().min(1), bootInstance: z.string() }).strict() }).strict()
export const generationCheckpointSchema = z.object({ schemaVersion: z.literal(1), runId: id, projectId: id, planHash: hash,
  formatAttempts: z.number().int().min(0).max(2), pendingCall: z.boolean(), repair: z.string().max(2000).optional(),
  output: modelOutputSchema.optional(), proposal: proposalSchema.optional() }).strict()
export type GenerationCheckpoint = z.infer<typeof generationCheckpointSchema>
export type RunState = z.infer<typeof runStateSchema>
export type RunSnapshot = z.infer<typeof runSnapshotSchema>
