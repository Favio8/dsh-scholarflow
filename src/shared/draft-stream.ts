import { z } from 'zod'
import { id, hash } from './schema.ts'
export const draftPreviewSchema = z.object({ schemaVersion: z.literal(1), taskId: id, projectId: id, sessionId: id,
  attemptId: id, seq: z.number().int().nonnegative(), sectionId: id, title: z.string(), text: z.string().max(2 * 1024 * 1024),
  baseDocumentHash: hash, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  prefix: z.string().max(1000).optional(),
  status: z.enum(['generating','validating','saved','paused','stopped','failed']), savedDocumentHash: hash.optional() }).strict()
export type DraftPreview = z.infer<typeof draftPreviewSchema>
