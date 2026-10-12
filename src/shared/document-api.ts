import { z } from 'zod'
import { requestContext, hash, id } from './schema.ts'
import { paragraphClaimSchema } from './editing.ts'
import { documentFormatting } from './formatting.ts'
export const saveDocumentRequest = z.object({ context: requestContext, text: z.string().max(2 * 1024 * 1024), baseHash: hash, formatting: documentFormatting.optional() }).strict()
export const proposalRequest = z.object({ context: requestContext, proposalId: id }).strict()
export const applyProposalRequest = proposalRequest.extend({ proposalHash: hash })
export const reviewImprovementApplyRequest = z.object({ context: requestContext,
  proposals: z.array(z.object({ proposalId: id, proposalHash: hash }).strict()).min(1).max(100)
    .refine(rows => new Set(rows.map(row => row.proposalId)).size === rows.length, 'Duplicate proposals') }).strict()
export const undoDocumentRequest = z.object({ context: requestContext, revisionId: id, baseHash: hash }).strict()
export const proposalRevisionRequest = applyProposalRequest.extend({ replacementText: z.string().min(1).max(2 * 1024 * 1024),
  paragraphClaims: z.array(paragraphClaimSchema).max(2000).optional(), reason: z.string().trim().min(1).max(4000).default('用户编辑候选并明确请求重新校验。') }).strict()
