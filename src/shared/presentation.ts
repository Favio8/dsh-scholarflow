import { z } from 'zod'
import { hash, projectType, requestContext } from './schema.ts'

export const exportFormat = z.enum(['markdown', 'latex', 'docx'])
export type ExportFormat = z.infer<typeof exportFormat>
export const exportPreflightRequest = z.object({ context: requestContext, format: exportFormat.default('markdown') }).strict()
export const projectPresentationRequest = z.object({ context: requestContext, baseConfigHash: hash,
  title: z.string().trim().min(1).max(300), type: projectType, language: z.enum(['zh-CN', 'en']) }).strict()
