import { z } from 'zod'
import { projectType } from './schema.ts'

// Structure presets are a plugin-level resource (SPEC v1.1 §5.1). Built-in entries
// ship inside the package; user entries live under <DSH_HOME>/scholarflow/presets/user.
// Everything here validates before use: a damaged entry is reported, never repaired.

export const presetId = z.string().min(1).max(80).regex(/^[a-z][a-z0-9-]{0,79}$/)
export const presetSectionKey = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]{0,63}$/)
export const presetSource = z.enum(['builtin', 'user'])
export const supplementalKind = z.enum(['abstract', 'keywords', 'references', 'appendix', 'publication-info',
  'abstract-en', 'acknowledgements', 'cover', 'toc'])

/** Built-ins carry both languages; user entries may carry a single string. */
export const localizedText = z.union([
  z.string().min(1).max(2000),
  z.object({ 'zh-CN': z.string().min(1).max(2000), en: z.string().min(1).max(2000).optional() }).strict(),
])
export type LocalizedText = z.infer<typeof localizedText>

/**
 * Where a supplemental part is produced. `manuscript` parts become real chapters the
 * user drafts; `export` parts are produced by the exporter from the manuscript itself
 * (references) or only declared here as an intention (cover, toc). Storing this as a
 * lookup instead of a field keeps every stored preset byte-compatible.
 */
export const SUPPLEMENTAL_PRODUCTION = {
  abstract: 'manuscript', keywords: 'manuscript', 'abstract-en': 'manuscript',
  references: 'export', appendix: 'manuscript', 'publication-info': 'manuscript',
  acknowledgements: 'manuscript', cover: 'export', toc: 'export',
} as const satisfies Record<z.infer<typeof supplementalKind>, 'manuscript' | 'export'>

/** Front matter comes before the body, back matter after it; export-only parts are placed too. */
export const SUPPLEMENTAL_PLACEMENT = {
  abstract: 'front', keywords: 'front', 'abstract-en': 'front', cover: 'front', toc: 'front',
  references: 'back', acknowledgements: 'back', appendix: 'back', 'publication-info': 'back',
} as const satisfies Record<z.infer<typeof supplementalKind>, 'front' | 'back'>

/**
 * The chapter title a manuscript part is drafted under. The preset's own `description`
 * stays the explanation shown in the wizard; a heading must not be free prose.
 */
export const SUPPLEMENTAL_LABELS = {
  abstract: { 'zh-CN': '摘要', en: 'Abstract' },
  keywords: { 'zh-CN': '关键词', en: 'Keywords' },
  'abstract-en': { 'zh-CN': 'Abstract', en: 'Abstract' },
  references: { 'zh-CN': '参考文献', en: 'References' },
  appendix: { 'zh-CN': '附录', en: 'Appendix' },
  'publication-info': { 'zh-CN': '书目信息', en: 'Publication Info' },
  acknowledgements: { 'zh-CN': '致谢', en: 'Acknowledgements' },
  cover: { 'zh-CN': '封面', en: 'Cover' },
  toc: { 'zh-CN': '目录', en: 'Contents' },
} as const satisfies Record<z.infer<typeof supplementalKind>, LocalizedText>

export const presetSubsection = z.object({
  key: presetSectionKey,
  title: localizedText,
  focus: localizedText,
  share: z.number().positive().finite(),
  // Widening this to `sourced` requires a contract update (SPEC v1.1 §5.1).
  shareSource: z.literal('heuristic').default('heuristic'),
}).strict()

export const presetSection = z.object({
  key: presetSectionKey,
  title: localizedText,
  focus: localizedText,
  share: z.number().positive().finite(),
  // Widening this to `sourced` requires a contract update (SPEC v1.1 §5.1).
  shareSource: z.literal('heuristic').default('heuristic'),
  // How much of this chapter is a lead-in before the first subsection. Zero means the
  // chapter is a pure container: it still occupies one outline row so its subsections
  // have a parent to hang from, and the allocator floors it to the section minimum.
  leadShare: z.number().min(0).max(1).default(0),
  // Nested one level deep. Shares are normalised inside the chapter, never across it.
  subsections: z.array(presetSubsection).max(8).default([]),
}).strict()

export const supplementalPart = z.object({
  kind: supplementalKind,
  description: localizedText,
  suggestedLength: z.number().int().min(1).max(100000).optional(),
}).strict()

export const presetReference = z.object({ label: z.string().min(1).max(200), url: z.string().url().max(2000) }).strict()

export const presetDocument = z.object({
  schemaVersion: z.literal(1),
  id: presetId,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  updatedAt: z.string().datetime(),
  paperType: projectType,
  order: z.number().int().nonnegative().max(1000).optional(),
  title: localizedText,
  summary: localizedText,
  whenToUse: z.array(localizedText).max(4).default([]),
  sections: z.array(presetSection).min(1).max(40),
  supplementalParts: z.array(supplementalPart).max(12).default([]),
  methodNotes: localizedText.optional(),
  references: z.array(presetReference).max(20).default([]),
  derivedFrom: presetId.optional(),
  basedOnVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
}).strict()
export type PresetDocument = z.infer<typeof presetDocument>

/** A loaded entry: the document plus the identity decided by the loading directory. */
export type Preset = PresetDocument & { source: z.infer<typeof presetSource> }

export const presetSummary = z.object({
  id: presetId, source: presetSource, paperType: projectType,
  order: z.number().int().nonnegative().nullable(), version: z.string(),
  title: localizedText, summary: localizedText, sectionCount: z.number().int().positive(),
  subsectionCount: z.number().int().nonnegative().default(0),
  modified: z.boolean().optional(),
}).strict()

export const presetSelectionRequest = z.object({ id: presetId }).strict()
/** What the wizard sends: the paper's own structure, with absolute chapter lengths. */
export const presetStructureSection = z.object({ key: presetSectionKey, title: localizedText, focus: localizedText,
  targetLength: z.number().int().min(50).max(30000), parentKey: presetSectionKey.optional() }).strict()
export const presetSaveRequest = z.object({ title: localizedText, summary: localizedText, paperType: projectType,
  sections: z.array(presetStructureSection).min(1).max(40), supplementalParts: z.array(supplementalPart).max(12).default([]),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]), derivedFrom: presetId.optional() }).strict()
export const presetUpdateRequest = presetSaveRequest.extend({ id: presetId, expectedVersion: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict()
export const presetCopyRequest = z.object({ id: presetId, title: localizedText.optional() }).strict()
export const presetRenameRequest = z.object({ id: presetId, title: localizedText }).strict()
export const presetRemoveRequest = z.object({ id: presetId }).strict()

/** Text in the requested language, falling back to the only available language. */
export function localized(text: LocalizedText, language: 'zh-CN' | 'en'): string {
  if (typeof text === 'string') return text
  return text[language] ?? text['zh-CN']
}

/**
 * Shares are stored normalised to 1. Rejects negative, zero, NaN and all-zero
 * sets; a damaged file is reported instead of silently corrected (SPEC v1.1 §5.1).
 */
export function normalizeShares(sections: { key: string; share: number }[]): { key: string; share: number }[] {
  const total = sections.reduce((sum, section) => sum + section.share, 0)
  if (!Number.isFinite(total) || total <= 0) throw new Error('PRESET_SHARES_INVALID')
  return sections.map(section => ({ key: section.key, share: section.share / total }))
}

/** Compares two share sets within the stored floating-point tolerance. */
export function sharesSumToOne(sections: { share: number }[], tolerance = 1e-6): boolean {
  const total = sections.reduce((sum, section) => sum + section.share, 0)
  return Math.abs(total - 1) <= tolerance
}

/** Same-type display order: `order` ascending, then missing order, then title then id. */
export function comparePresets(a: Preset, b: Preset): number {
  const left = a.order ?? Number.MAX_SAFE_INTEGER, right = b.order ?? Number.MAX_SAFE_INTEGER
  if (left !== right) return left - right
  const titleA = localized(a.title, 'zh-CN'), titleB = localized(b.title, 'zh-CN')
  if (titleA !== titleB) return titleA < titleB ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
