import { z } from 'zod'
import { id, hash, requestContext } from './schema.ts'
import { runSnapshotSchema } from './runs.ts'

export const draftSequenceRequest = z.object({ context: requestContext, instruction: z.string().trim().min(1).max(12000),
  summarySectionIds: z.array(id).max(200).default([]) }).strict()
export const draftSequenceActionRequest = z.object({ context: requestContext, sequenceId: id,
  action: z.enum(['next', 'pause', 'resume', 'cancel']), reason: z.string().trim().max(4000).default('') }).strict()
export const draftSequenceInputSchema = z.object({ schemaVersion: z.literal(1), sequenceId: id, projectId: id, sessionId: id,
  instruction: z.string().min(1).max(12000), scopeHash: hash, model: runSnapshotSchema.shape.modelDescriptor,
  workflowId: id.optional(), initialDocumentHash: hash, initialRevisionId: id, createdAt: z.string(),
  skillDigests: z.array(z.object({ qualifiedId: z.string().min(1).max(300), digest: hash }).strict()).max(200).optional(),
  sections: z.array(z.object({ sectionId: id, title: z.string(), summary: z.boolean(), preserve: z.boolean() }).strict()).min(1).max(200) }).strict()
export const draftSequenceCheckpointSchema = z.object({ schemaVersion: z.literal(1), sequenceId: id, projectId: id, inputHash: hash,
  planHash: hash,
  revision: z.number().int().nonnegative(), status: z.enum(['waiting-input', 'paused', 'cancelled', 'completed-with-issues']),
  expectedDocumentHash: hash, expectedRevisionId: id, updatedAt: z.string(),
  steps: z.array(z.object({ sectionId: id, state: z.enum(['pending', 'preserved', 'dispatched', 'accepted']),
    childRunId: id.optional(), childPlanHash: hash.optional(), proposalId: id.optional(), acceptedRevisionId: id.optional(),
    acceptedDocumentHash: hash.optional(), gaps: z.array(z.string().max(4000)).max(100).default([]) }).strict()).min(1).max(200) }).strict()
export type DraftSequenceInput = z.infer<typeof draftSequenceInputSchema>
export type DraftSequenceCheckpoint = z.infer<typeof draftSequenceCheckpointSchema>
export const draftSequencePlanSchema = z.object({ schemaVersion: z.literal(1), sequenceId: id, projectId: id, inputHash: hash,
  sectionIds: z.array(id).min(1).max(200), contentHash: hash }).strict()
export const draftSequenceRunSchema = z.object({ schemaVersion: z.literal(1), sequenceId: id, projectId: id, inputHash: hash,
  planHash: hash, checkpointHash: hash, status: draftSequenceCheckpointSchema.shape.status, updatedAt: z.string() }).strict()
