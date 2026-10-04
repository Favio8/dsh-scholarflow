import { z } from 'zod'

export const id = z.string().min(1).max(200).regex(/^[\w.-]+$/)
export const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/)
export const relativePath = z.string().min(1).max(800).refine(path => {
  if (path.includes('\\') || path.includes(':') || path.includes('\0') || path.startsWith('/')) return false
  return path.split('/').every(part => part.length && part !== '.' && part !== '..' && !/[. ]$/.test(part)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}, 'Relative paths must be unambiguous, use /, and stay within the project')
export const projectType = z.enum(['course-paper', 'literature-review', 'research-paper'])
export const stage = z.enum(['requirements', 'research', 'outline', 'drafting', 'review', 'revision', 'delivery'])
const defaultExcludes = ['**/.env*', '**/node_modules/**', '**/.git/**', '**/credentials/**', '**/secrets/**']
const configObject = z.object({
  schemaVersion: z.literal(1),
  project: z.object({ id, title: z.string().min(1).max(300).default('未命名论文'), type: projectType.default('course-paper'), language: z.enum(['zh-CN', 'en']).default('zh-CN') }).strict(),
  paths: z.object({ manuscriptDir: relativePath, mainDocument: relativePath, references: relativePath }).strict(),
  materials: z.object({ selection: z.literal('explicit').default('explicit'), include: z.array(relativePath).default([]), exclude: z.array(z.string()).default(defaultExcludes) }).strict().prefault({}),
  writing: z.object({ preset: z.string(), projectProfile: relativePath.default('.scholarflow/profiles/writing.md'), useApprovedProjectMemory: z.boolean().default(true) }).strict(),
  skills: z.object({ bindings: z.array(z.object({ ref: z.string(), stages: z.array(stage) }).strict()).default([]) }).strict().prefault({}),
  workflow: z.object({ executionMode: z.enum(['guided', 'automatic']).default('guided'), confirmOutline: z.literal(true).default(true), maxReviewRounds: z.number().int().min(1).max(2).default(2),
    budget: z.object({ maxModelCalls: z.number().int().min(1).max(40).default(40), maxSearchQueries: z.number().int().min(0).max(12).default(12), maxCandidateSources: z.number().int().min(1).max(80).default(80), maxDurationMinutes: z.number().int().min(1).max(30).default(30) }).strict().prefault({}) }).strict().prefault({}),
  research: z.object({ providerRefs: z.array(z.string()).default([]), allowLocalOnly: z.boolean().default(true), fullTextDownload: z.literal('ask').default('ask') }).strict().prefault({}),
  privacy: z.object({ sendSelectedContentOnly: z.literal(true).default(true), verboseModelLogging: z.literal(false).default(false) }).strict().prefault({}),
  output: z.object({ formats: z.array(z.enum(['markdown', 'bibtex', 'quality-report'])).default(['markdown', 'bibtex', 'quality-report']) }).strict().prefault({}),
}).strict().superRefine((config, ctx) => {
  for (const key of ['mainDocument', 'references'] as const)
    if (!config.paths[key].startsWith(config.paths.manuscriptDir + '/')) ctx.addIssue({ code: 'custom', path: ['paths', key], message: 'Must be within the confirmed manuscript directory' })
  if (config.paths.manuscriptDir.split('/')[0] === '.scholarflow') ctx.addIssue({ code: 'custom', path: ['paths'], message: 'Manuscript and metadata directories must be separate' })
})
// Defaults never invent project identity or rewrite the source YAML. Derived paths
// follow the explicitly configured output directory, rather than a second root.
export const configSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const input = value as Record<string, any>
  const paths = input.paths === undefined ? {} : input.paths
  const writing = input.writing === undefined ? {} : input.writing
  return { ...input,
    paths: paths && typeof paths === 'object' && !Array.isArray(paths) ? {
      manuscriptDir: 'manuscript', mainDocument: `${paths.manuscriptDir ?? 'manuscript'}/paper.md`,
      references: `${paths.manuscriptDir ?? 'manuscript'}/references.bib`, ...paths,
    } : paths,
    writing: writing && typeof writing === 'object' && !Array.isArray(writing) ? {
      preset: `builtin:${input.project?.type ?? 'course-paper'}-${input.project?.language === 'en' ? 'en' : 'zh'}`, ...writing,
    } : writing,
  }
}, configObject)
export type ProjectConfig = z.infer<typeof configSchema>

export const locator = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pdf'), pageNumber: z.number().int().min(1), printedPageLabel: z.string().optional(), section: z.string().optional() }).strict(),
  z.object({ kind: z.literal('text'), lineStart: z.number().int().min(1), lineEnd: z.number().int().min(1) }).strict(),
  z.object({ kind: z.literal('docx'), paragraphId: id, paragraphIndex: z.number().int().min(1) }).strict(),
  z.object({ kind: z.literal('web'), heading: z.string().optional(), paragraphIndex: z.number().int().min(1), snapshotHash: hash }).strict(),
  z.object({ kind: z.literal('data'), relativePath, rowRange: z.string().optional(), metric: z.string().optional() }).strict(),
  z.object({ kind: z.literal('manual'), description: z.string().min(1) }).strict(),
])
export const requirementSchema = z.object({ id, kind: z.enum(['length', 'references', 'section', 'topic', 'format', 'rubric', 'deadline', 'ai-policy', 'other']), description: z.string().min(1),
  origin: z.object({ type: z.enum(['user', 'material', 'inference']), materialId: id.optional(), locator: locator.optional(), excerpt: z.string().optional() }).strict(),
  confirmation: z.enum(['proposed', 'confirmed', 'conflicting']),
  constraint: z.object({ operator: z.enum(['min', 'max', 'equals', 'contains', 'ratio']), value: z.union([z.number(), z.string()]), unit: z.enum(['zh-characters', 'words', 'items', 'percent']).optional(), countingPolicyId: z.string().optional(), windowStart: z.string().optional(), windowEnd: z.string().optional() }).strict().optional(),
  verificationMethod: z.enum(['deterministic', 'model-assisted', 'manual']), confirmedAt: z.string().optional(),
}).strict()
export const materialSchema = z.object({ id, projectRelativePath: relativePath, role: z.enum(['assignment', 'rubric', 'paper', 'notes', 'slides', 'data', 'code', 'other']), mediaType: z.string(), sizeBytes: z.number().int().min(0), contentHash: hash.optional(),
  parseStatus: z.enum(['registered', 'queued', 'parsing', 'ready', 'partial', 'unsupported', 'failed', 'stale']),
  parsedRanges: z.array(z.object({ kind: z.enum(['pages', 'paragraphs']), from: z.number().int().min(1), to: z.number().int().min(1) }).strict()),
  parser: z.object({ id: z.string(), version: z.string() }).strict().optional(), failureCode: z.string().optional(),
}).strict()
export const sourceSchema = z.object({ id, kind: z.enum(['paper', 'dataset', 'web', 'book', 'user-result', 'other']), title: z.string().min(1), authors: z.array(z.object({ literal: z.string(), family: z.string().optional(), given: z.string().optional() }).strict()),
  year: z.number().int().min(1).max(9999).optional(), venue: z.string().optional(),
  identifiers: z.object({ doi: z.string().optional(), arxiv: z.string().optional(), url: z.string().optional(), other: z.array(z.string()).optional() }).strict(),
  citeKey: z.string().regex(/^sf_[a-zA-Z0-9_]+$/), provenance: z.array(z.object({ provider: z.string(), retrievedAt: z.string(), recordId: z.string().optional() }).strict()),
  identity: z.object({ status: z.enum(['unverified', 'matched', 'mismatch', 'unavailable']), method: z.enum(['identifier-lookup', 'metadata-match', 'user-confirmed', 'none']), checkedAt: z.string().optional(), reason: z.string().optional() }).strict(),
  textAccess: z.enum(['none', 'metadata', 'abstract', 'excerpt', 'fulltext']), materialId: id.optional(), storedAssetPath: relativePath.optional(), contentHash: hash.optional(), publicationState: z.enum(['preprint', 'published', 'unknown']).optional(),
}).strict()
export const evidenceSchema = z.object({ id, sourceId: id, sourceContentHash: hash, locator, excerpt: z.string().min(1).max(64000), interpretation: z.string().optional(), kind: z.enum(['quotation', 'method', 'result', 'limitation', 'table', 'user-measurement', 'other']),
  acquisition: z.enum(['parser', 'user-confirmed', 'model-located']), validation: z.enum(['located', 'needs-check', 'invalid', 'stale']),
  measurement: z.object({ metric: z.string(), value: z.union([z.number(), z.string()]), unit: z.string().optional(), conditions: z.string().min(1), origin: z.enum(['reported-in-source', 'user-supplied']) }).strict().optional(),
}).strict()
export const claimSchema = z.object({ id, text: z.string().min(1), kind: z.enum(['external-fact', 'author-inference', 'method-proposal', 'user-observation', 'planned-experiment']), scope: z.string().min(1),
  evidenceLinks: z.array(z.object({ evidenceId: id, relation: z.enum(['supports', 'contradicts', 'background', 'partial']), rationale: z.string().optional() }).strict()),
  status: z.enum(['draft', 'supported', 'partially-supported', 'unsupported', 'disputed', 'stale']), limitations: z.array(z.string()), reviewedBy: z.enum(['user', 'model', 'rule']).optional(),
}).strict()
export const outlineSchema = z.object({ version: z.number().int().min(0), title: z.string(), researchQuestion: z.string(), thesis: z.string(), confirmation: z.enum(['draft', 'confirmed']),
  sections: z.array(z.object({ id, parentId: id.optional(), title: z.string().min(1), purpose: z.string(), claimIds: z.array(id), targetLength: z.object({ value: z.number().min(1), unit: z.enum(['words', 'zh-characters']) }).strict().optional(), missingEvidence: z.array(z.string()) }).strict()),
}).strict()
export const documentSchema = z.object({ id, relativePath, format: z.literal('markdown'), currentHash: hash, revisionId: id, encoding: z.literal('utf-8'), lineEnding: z.enum(['lf', 'crlf', 'mixed']), initialPlaceholder: z.boolean() }).strict()
export const anchorSchema = z.object({ id, documentId: id, documentHash: hash, blockId: id, blockTextHash: hash, claimIds: z.array(id), status: z.enum(['current', 'needs-remap', 'stale']) }).strict()
export const proposalStateSchema = z.object({ proposalId: id, state: z.enum(['pending', 'accepted', 'rejected', 'stale']), acceptedRevisionId: id.optional(), updatedAt: z.string() }).strict()
export const issueSchema = z.object({ id, reviewId: id, category: z.enum(['citation', 'evidence', 'logic', 'structure', 'requirement', 'style', 'integrity']), severity: z.enum(['B0', 'B1', 'B2']), title: z.string(), explanation: z.string(), documentId: id.optional(), documentHash: hash.optional(), anchorId: id.optional(), claimIds: z.array(id), evidenceIds: z.array(id), requirementIds: z.array(id), checkMethod: z.enum(['deterministic', 'model-assisted', 'manual']), state: z.enum(['open', 'proposed-fix', 'resolved', 'accepted-risk', 'dismissed']), suggestedFix: z.string().optional(), resolutionReason: z.string().optional(), stale: z.boolean() }).strict()
// Delivery schema is completed alongside the exporter, before any delivery is persisted.
export const deliverySchema = z.object({ id, projectId: id, documentId: id, documentHash: hash, revisionId: id, status: z.enum(['draft-incomplete', 'draft-reviewed', 'review-stale']), relativePath, createdAt: z.string(), files: z.array(z.object({ relativePath, contentHash: hash }).strict()), limitations: z.array(z.string()) }).strict()
const record = <T extends z.ZodType>(schema: T) => z.record(id, schema)
export const ledgerSchema = z.object({ schemaVersion: z.literal(1), projectId: id, revision: z.number().int().min(0), requirements: record(requirementSchema), materials: record(materialSchema), sources: record(sourceSchema), evidence: record(evidenceSchema), claims: record(claimSchema), outline: outlineSchema,
  documents: record(documentSchema), claimAnchors: record(anchorSchema), proposalStates: record(proposalStateSchema), reviewIssues: record(issueSchema), deliveries: record(deliverySchema),
}).strict()
export type Ledger = z.infer<typeof ledgerSchema>
export type Source = z.infer<typeof sourceSchema>
export type Evidence = z.infer<typeof evidenceSchema>
export type Claim = z.infer<typeof claimSchema>
export type Requirement = z.infer<typeof requirementSchema>
export type Outline = z.infer<typeof outlineSchema>
export type Material = z.infer<typeof materialSchema>

export const requestContext = z.object({ requestId: id, workspaceId: id, sessionId: id, projectId: id.optional(), expectedLedgerRevision: z.number().int().min(0).optional(), idempotencyKey: id.optional() }).strict()
export type RequestContext = z.infer<typeof requestContext>
