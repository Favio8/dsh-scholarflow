import { z } from 'zod'
import { id, hash, requestContext } from './schema.ts'

export const writingProfileSchema = z.object({ id, scope: z.enum(['builtin', 'library', 'project']),
  displayName: z.string().trim().min(1).max(300), language: z.enum(['zh-CN', 'en']),
  instructions: z.string().min(1).max(65536), sourceDigest: hash,
  structuredPreferences: z.object({ tone: z.enum(['formal', 'neutral']).optional(),
    preferredTerms: z.record(z.string().max(100), z.string().max(200)).refine(terms => Object.keys(terms).length <= 100).optional(),
    discouragedPhrases: z.array(z.string().max(200)).max(100).optional(),
    paragraphLengthHint: z.object({ min: z.number().nonnegative(), max: z.number().nonnegative(), unit: z.string().max(100) }).strict().optional() }).strict().optional(),
}).strict()
export type WritingProfile = z.infer<typeof writingProfileSchema>
export const projectProfileSourceSchema = z.object({ schemaVersion: z.literal(1), projectId: id,
  path: z.literal('.scholarflow/profiles/writing.md'), profile: writingProfileSchema,
  operation: z.enum(['initialization', 'copy-template']), sourceSessionId: id.optional(), confirmedAt: z.iso.datetime() }).strict()
export const profileImportInput = writingProfileSchema.omit({ scope: true, sourceDigest: true }).extend({ id: id.optional() })
export const profileImportRequest = z.object({ profile: profileImportInput }).strict()
export const profileReadRequest = z.object({ id, sourceDigest: hash }).strict()
export const profileCopyRequest = profileReadRequest.extend({ context: requestContext }).strict()
export const profileConfirmRequest = z.object({ planId: id, planHash: hash }).strict()
export const profileCopyConfirmRequest = profileConfirmRequest.extend({ context: requestContext }).strict()
