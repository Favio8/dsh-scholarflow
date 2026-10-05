import { z } from 'zod'
import { requestContext, id, hash } from './schema.ts'
import { projectTextPaths } from './requirements.ts'

export const projectTextBufferSchema = z.object({ schemaVersion: z.literal(1), projectId: id, sessionId: id,
  path: z.enum(projectTextPaths), baseHash: hash, text: z.string().max(65536), state: z.enum(['dirty', 'cleared']), updatedAt: z.iso.datetime() }).strict()
export const projectTextBufferReadRequest = z.object({ context: requestContext, path: z.enum(projectTextPaths) }).strict()
export const projectTextBufferWriteRequest = projectTextBufferReadRequest.extend({ baseBufferHash: hash.nullable(), baseHash: hash,
  text: projectTextBufferSchema.shape.text, state: projectTextBufferSchema.shape.state })
