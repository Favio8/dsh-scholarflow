import { z } from 'zod'
import { requestContext, id, hash } from './schema.ts'

export const bufferSchema = z.object({ schemaVersion: z.literal(1), projectId: id, sessionId: id, documentId: z.literal('paper'),
  baseHash: hash, text: z.string().max(2 * 1024 * 1024), state: z.enum(['dirty', 'cleared']), updatedAt: z.string() }).strict()
export const bufferWriteRequest = z.object({ context: requestContext, baseBufferHash: hash.nullable(), baseHash: hash,
  text: bufferSchema.shape.text, state: bufferSchema.shape.state }).strict()
