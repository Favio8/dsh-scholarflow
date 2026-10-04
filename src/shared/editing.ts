import { z } from 'zod'
import { id, hash, requestContext } from './schema.ts'

export const sourceRange = z.object({ startUtf16: z.number().int().min(0), endUtf16: z.number().int().min(0) }).strict()
export const paragraphClaimSchema = z.object({ paragraphIndex: z.number().int().min(0), claimIds: z.array(id).max(100) }).strict()
export const sectionCandidateSchema = z.object({ sectionId: id, outlineVersion: z.number().int().min(0), body: z.string().min(1).max(2 * 1024 * 1024),
  paragraphClaims: z.array(paragraphClaimSchema).max(2000), limitations: z.array(z.string()).max(100) }).strict()
export const anchorUpsertRequest = z.object({ context: requestContext, documentHash: hash, blockId: id, blockTextHash: hash,
  anchorId: id.optional(), claimIds: z.array(id).max(100) }).strict()
export const selectionSchema = z.object({ projectId: id, documentId: id, documentHash: hash, revisionId: id,
  blockIds: z.array(id).min(1), sourceRange, sourceText: z.string().min(1).max(64000), renderedText: z.string().max(64000),
  prefixContext: z.string().max(500), suffixContext: z.string().max(500), citationKeys: z.array(z.string()), claimIds: z.array(id),
  scope: z.enum(['inline', 'paragraph', 'section']), capturedAt: z.string() }).strict()
export const proposalSchema = z.object({ schemaVersion: z.literal(1), id, projectId: id, runId: id, documentId: id,
  baseDocumentHash: hash, baseRevisionId: id, scope: z.enum(['selection', 'section', 'document']), instruction: z.string().min(1).max(16000), selection: selectionSchema.optional(),
  section: sectionCandidateSchema.optional(),
  edits: z.array(z.object({ startUtf16: z.number().int().min(0), endUtf16: z.number().int().min(0), expectedText: z.string(), replacementText: z.string() }).strict()).min(1).max(100),
  citationChanges: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }).strict(), protectedFactChanges: z.array(z.string()), dependentEvidenceIds: z.array(id),
  checks: z.array(z.object({ id: z.string(), status: z.enum(['pass', 'fail', 'unknown']), detail: z.string() }).strict()), createdAt: z.string() }).strict()
export type SelectionPayload = z.infer<typeof selectionSchema>
export type EditProposal = z.infer<typeof proposalSchema>
