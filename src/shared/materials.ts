import { z } from 'zod'
import { locator, hash, id, relativePath, materialSchema, requestContext } from './schema.ts'

export const PARSER_VERSION = 'scholarflow-parsers-1'
export const parseRange = z.object({ kind: z.enum(['pages', 'paragraphs']), from: z.number().int().min(1), to: z.number().int().min(1) }).strict().refine(value => value.to >= value.from && value.to - value.from < 100, 'Read at most 100 pages / paragraphs per request')
export const parsedMaterialSchema = z.object({
  schemaVersion: z.literal(1), materialId: id, sourceContentHash: hash,
  parser: z.object({ id: z.string(), version: z.string() }).strict(),
  blocks: z.array(z.object({ text: z.string().max(64000), locator, kind: z.enum(['heading', 'paragraph', 'table', 'caption', 'other']) }).strict()).max(10000),
  coverage: z.enum(['complete', 'partial']), warnings: z.array(z.string()),
  unprocessedContent: z.array(z.enum(['images', 'formulas', 'tables', 'pages'])),
  ranges: z.array(z.object({ kind: z.enum(['pages', 'paragraphs']), from: z.number().int().min(1), to: z.number().int().min(1) }).strict()),
}).strict()
export type ParsedMaterial = z.infer<typeof parsedMaterialSchema>
export type ParsedBody = Omit<ParsedMaterial, 'schemaVersion' | 'materialId' | 'sourceContentHash'>
export const scanRequest = z.object({ context: requestContext, directory: relativePath.optional(), cursor: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict()
export const registerMaterialRequest = z.object({ context: requestContext, relativePath, role: materialSchema.shape.role, confirmExcludedFile: z.boolean().default(false) }).strict()
export const parseMaterialRequest = z.object({ context: requestContext, materialId: id, range: parseRange.optional() }).strict()
export const readMaterialRequest = z.object({ context: requestContext, materialId: id }).strict()
