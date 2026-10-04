import { z } from 'zod'
import { requestContext, hash, id } from './schema.ts'
export const saveDocumentRequest = z.object({ context: requestContext, text: z.string().max(2 * 1024 * 1024), baseHash: hash }).strict()
export const proposalRequest = z.object({ context: requestContext, proposalId: id }).strict()
export const applyProposalRequest = proposalRequest.extend({ proposalHash: hash })
export const undoDocumentRequest = z.object({ context: requestContext, revisionId: id, baseHash: hash }).strict()
