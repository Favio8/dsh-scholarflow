import { z } from 'zod'
import { requirementSchema, requestContext, id, hash } from './schema.ts'

export const requirementInput = requirementSchema.omit({ id: true, confirmation: true, confirmedAt: true }).extend({ id: id.optional(), description: z.string().min(1).max(4000) })
export const requirementUpsertRequest = z.object({ context: requestContext, requirement: requirementInput, changeReason: z.string().trim().min(1).max(2000).optional() }).strict()
export const requirementExtractRequest = z.object({ context: requestContext, materialId: id }).strict()
export const countingPolicies = ['sf-body-han-western-v1', 'sf-body-han-plus-western-v1', 'sf-cited-year-window-v1', 'sf-cited-year-window-ratio-v1'] as const
export const requirementConfirmRequest = z.object({ context: requestContext, requirementId: id, countingPolicyId: z.enum(countingPolicies).optional() }).strict()
export const requirementResolveRequest = z.object({ context: requestContext, requirementIds: z.array(id).min(2).max(20), selectedId: id, reason: z.string().trim().min(1).max(2000) }).strict()
export const requirementRemoveRequest = z.object({ context: requestContext, requirementId: id, reason: z.string().trim().min(1).max(2000) }).strict()
export const projectTextPaths = ['.scholarflow/profiles/writing.md', '.scholarflow/profiles/review.md', '.scholarflow/context/decisions.md', '.scholarflow/context/terminology.md', '.scholarflow/context/writing-memory.md'] as const
export const projectTextReadRequest = z.object({ context: requestContext, path: z.enum(projectTextPaths) }).strict()
export const projectTextSaveRequest = projectTextReadRequest.extend({ text: z.string().max(65536), baseHash: hash })
