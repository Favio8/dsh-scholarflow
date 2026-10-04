import { z } from 'zod'
import { requestContext, id, hash, sourceSchema, evidenceSchema, claimSchema, outlineSchema } from './schema.ts'

export const sourceInput = z.object({ title: sourceSchema.shape.title, authors: sourceSchema.shape.authors, year: sourceSchema.shape.year,
  venue: sourceSchema.shape.venue, kind: sourceSchema.shape.kind, identifiers: sourceSchema.shape.identifiers, materialId: id.optional() }).strict()
export const registerSourceRequest = z.object({ context: requestContext, source: sourceInput }).strict()
export const confirmEvidenceRequest = z.object({ context: requestContext, sourceId: id, sourceContentHash: hash, locator: evidenceSchema.shape.locator,
  excerpt: evidenceSchema.shape.excerpt, interpretation: evidenceSchema.shape.interpretation, kind: evidenceSchema.shape.kind }).strict()
export const upsertClaimRequest = z.object({ context: requestContext, claim: claimSchema.omit({ status: true, reviewedBy: true }).extend({ id: id.optional() }) }).strict()
export const confirmOutlineRequest = z.object({ context: requestContext, outline: outlineSchema, expectedOutlineVersion: z.number().int().min(0) }).strict()
