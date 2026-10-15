import { z } from 'zod'
import { requestContext, id, hash, sourceSchema, evidenceSchema, claimSchema, outlineSchema } from './schema.ts'

export const sourceInput = z.object({ title: sourceSchema.shape.title, authors: sourceSchema.shape.authors, year: sourceSchema.shape.year,
  venue: sourceSchema.shape.venue,bibliography:sourceSchema.shape.bibliography, kind: sourceSchema.shape.kind, identifiers: sourceSchema.shape.identifiers, materialId: id.optional() }).strict()
export const registerSourceRequest = z.object({ context: requestContext, source: sourceInput }).strict()
export const duplicateSourceReview = z.object({ decision: z.literal('keep-separate'), reason: z.string().trim().min(1).max(4000),
  matches: z.array(z.object({ sourceId: id, sourceHash: hash }).strict()).min(1).max(1000) }).strict()
export const confirmEvidenceRequest = z.object({ context: requestContext, sourceId: id, sourceContentHash: hash, locator: evidenceSchema.shape.locator,
  excerpt: evidenceSchema.shape.excerpt, interpretation: evidenceSchema.shape.interpretation, kind: evidenceSchema.shape.kind,
  measurement: evidenceSchema.shape.measurement }).strict().superRefine((input, ctx) => {
    if (input.measurement && (!input.measurement.metric.trim() || !input.measurement.conditions.trim() ||
      typeof input.measurement.value === 'string' && !input.measurement.value.trim()))
      ctx.addIssue({ code: 'custom', path: ['measurement'], message: '指标、原值与实验条件不能为空。' })
    if (input.kind === 'user-measurement' && (!input.measurement || input.measurement.origin !== 'user-supplied'))
      ctx.addIssue({ code: 'custom', path: ['measurement'], message: '用户测量必须提供指标、原值、条件及作者供给来源。' })
  })
export const upsertClaimRequest = z.object({ context: requestContext, claim: claimSchema.omit({ status: true, reviewedBy: true }).extend({ id: id.optional() }) }).strict()
export const confirmOutlineRequest = z.object({ context: requestContext, outline: outlineSchema, expectedOutlineVersion: z.number().int().min(0) }).strict()
