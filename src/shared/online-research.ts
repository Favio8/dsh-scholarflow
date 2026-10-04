import { z } from 'zod'
import { id, hash, requestContext, sourceSchema } from './schema.ts'

export const normalizeDoi = (value: string) => value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()
export const doi = z.string().max(1000).transform(normalizeDoi).refine(value => /^10\.\d{4,9}\/\S+$/u.test(value) && !/[\u0000-\u001f\u007f]/u.test(value), 'Invalid DOI')
export const searchInput = z.object({ query: z.string().trim().min(3).max(1000), purpose: z.string().trim().min(1).max(2000), limit: z.number().int().min(1).max(20).default(10),
  yearFrom: z.number().int().min(1).max(9999).optional(), yearTo: z.number().int().min(1).max(9999).optional() }).strict()
  .refine(value => !value.yearFrom || !value.yearTo || value.yearFrom <= value.yearTo, 'Invalid year interval')
export const candidateSchema = z.object({ candidateId: id, provider: z.literal('crossref'), recordId: doi, sourceUrl: z.url(), retrievedAt: z.iso.datetime(),
  title: z.string().min(1).max(4000), authors: sourceSchema.shape.authors.max(100), year: sourceSchema.shape.year, venue: z.string().max(2000).optional(),
  identifiers: z.object({ doi, url: z.url() }).strict(), textAccess: z.literal('metadata'), kind: sourceSchema.shape.kind,
  warnings: z.array(z.string().max(2000)).max(20) }).strict()
export type SourceCandidate = z.infer<typeof candidateSchema>
export interface ResearchProvider {
  id: 'crossref'
  capabilities: { search: boolean; lookupIdentifier: boolean; fullText: boolean }
  search(input: z.infer<typeof searchInput>, signal: AbortSignal): Promise<{ records: SourceCandidate[]; warnings: string[] }>
  lookup(identifier: string, signal: AbortSignal): Promise<SourceCandidate | null>
}
export const searchPrepareRequest = z.object({ context: requestContext, search: searchInput }).strict()
export const onlineConfirmRequest = z.object({ context: requestContext, planId: id, planHash: hash }).strict()
export const candidateDecisionRequest = z.object({ context: requestContext, searchId: id, candidateId: id,
  decision: z.enum(['include', 'exclude']), reason: z.string().trim().min(1).max(2000) }).strict()
export const lookupPrepareRequest = z.object({ context: requestContext, sourceId: id }).strict()

export const searchRecordSchema = z.object({ schemaVersion: z.literal(1), projectId: id, id, search: searchInput,
  provider: z.literal('crossref'), createdAt: z.iso.datetime(), completedAt: z.iso.datetime().optional(),
  state: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']), queriesUsed: z.literal(1),
  records: z.array(candidateSchema).max(80), warnings: z.array(z.string()).max(30), errorCode: z.string().optional(),
  decisions: z.record(id, z.object({ decision: z.enum(['include', 'exclude']), reason: z.string().min(1).max(2000),
    sourceId: id.optional(), decidedAt: z.iso.datetime() }).strict()) }).strict()
export type SearchRecord = z.infer<typeof searchRecordSchema>
export const lookupRecordSchema = z.object({ schemaVersion: z.literal(1), projectId: id, id, sourceId: id, sourceHash: hash, doi,
  provider: z.literal('crossref'), createdAt: z.iso.datetime(), completedAt: z.iso.datetime().optional(), queriesUsed: z.literal(1),
  state: z.enum(['running', 'completed', 'failed', 'cancelled', 'conflict']), found: candidateSchema.nullable().optional(),
  identity: sourceSchema.shape.identity.optional(), errorCode: z.string().max(100).optional() }).strict()
