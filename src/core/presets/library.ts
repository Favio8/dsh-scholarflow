import { presetDocument, presetId, comparePresets, sharesSumToOne, normalizeShares, type Preset, type PresetDocument, type LocalizedText } from '../../shared/presets.ts'

// Loading, merging and ordering of the structure-preset library (SPEC v1.1 §6).
// Core is I/O-free: callers pass raw entries with the source already decided by the
// directory the bytes came from, never by what the file claims about itself.

export type PresetSource = 'builtin' | 'user'
export interface RawPresetEntry { id: string; source: PresetSource; text: string }
export interface PresetIssue { id: string; source: PresetSource | 'unknown'; code: string; message: string }
export interface PresetLibrary { all: Preset[]; byType: Record<string, Preset[]>; issues: PresetIssue[] }

const PAPER_TYPES = ['course-paper', 'research-paper', 'literature-review'] as const

export function loadPresetLibrary(entries: RawPresetEntry[]): PresetLibrary {
  const issues: PresetIssue[] = []
  const seen = new Map<string, Preset>()
  const all: Preset[] = []
  // User entries are read first and win on a duplicate id; the clash is still reported.
  const ordered = [...entries].sort((a, b) => (a.source === b.source ? 0 : a.source === 'user' ? -1 : 1))
  for (const entry of ordered) {
    const parsed = readPreset(entry, issues)
    if (!parsed) continue
    if (seen.has(parsed.id)) { issues.push({ id: parsed.id, source: entry.source, code: 'PRESET_DUPLICATE_ID', message: `预设 id 重复：${parsed.id}` }); continue }
    seen.set(parsed.id, parsed); all.push(parsed)
  }
  const byType: Record<string, Preset[]> = {}
  for (const type of PAPER_TYPES) byType[type] = all.filter(preset => preset.paperType === type).sort(comparePresets)
  return { all, byType, issues }
}

function readPreset(entry: RawPresetEntry, issues: PresetIssue[]): Preset | undefined {
  if (!presetId.safeParse(entry.id).success) {
    issues.push({ id: entry.id, source: entry.source, code: 'PRESET_ID_INVALID', message: `文件名不是合法预设 id：${entry.id}` }); return undefined
  }
  let raw: unknown
  try { raw = JSON.parse(entry.text) } catch { issues.push({ id: entry.id, source: entry.source, code: 'PRESET_UNREADABLE', message: `预设不是有效 JSON：${entry.id}` }); return undefined }
  const parsed = presetDocument.safeParse(raw)
  if (!parsed.success) {
    issues.push({ id: entry.id, source: entry.source, code: 'PRESET_INVALID', message: `预设字段不合法：${entry.id}（${parsed.error.issues[0]?.path.join('.') || 'root'}）` }); return undefined
  }
  const document = parsed.data
  if (document.id !== entry.id) {
    issues.push({ id: entry.id, source: entry.source, code: 'PRESET_ID_MISMATCH', message: `预设 id 与文件名不一致：${entry.id}` }); return undefined
  }
  if (!sharesSumToOne(document.sections)) {
    issues.push({ id: entry.id, source: entry.source, code: 'PRESET_SHARES_INVALID', message: `正文占比合计不为 1：${entry.id}` }); return undefined
  }
  if (entry.source === 'builtin') {
    // Built-ins are the shipped reference set: they must be orderable, explain when to
    // use them and cite where the structure comes from (SPEC v1.1 §5.1).
    if (document.order === undefined) { issues.push({ id: entry.id, source: entry.source, code: 'PRESET_ORDER_REQUIRED', message: `内置预设缺少 order：${entry.id}` }); return undefined }
    if (document.whenToUse.length < 2) { issues.push({ id: entry.id, source: entry.source, code: 'PRESET_WHEN_TO_USE_REQUIRED', message: `内置预设需要 2–4 条适用场景：${entry.id}` }); return undefined }
    if (document.references.length === 0) { issues.push({ id: entry.id, source: entry.source, code: 'PRESET_SOURCE_REQUIRED', message: `内置预设需要来源依据：${entry.id}` }); return undefined }
    if (document.tags.length) { issues.push({ id: entry.id, source: entry.source, code: 'PRESET_TAGS_RESERVED', message: `内置预设不使用自由标签：${entry.id}` }); return undefined }
  }
  return { ...document, source: entry.source }
}

/** Built-in order must be unique inside one paper type; a clash is a content defect. */
export function duplicateOrders(library: PresetLibrary): PresetIssue[] {
  const issues: PresetIssue[] = []
  for (const [type, presets] of Object.entries(library.byType)) {
    const used = new Map<number, string>()
    for (const preset of presets) {
      if (preset.source !== 'builtin' || preset.order === undefined) continue
      const previous = used.get(preset.order)
      if (previous) issues.push({ id: preset.id, source: 'builtin', code: 'PRESET_ORDER_DUPLICATE', message: `${type} 内 order ${preset.order} 重复：${previous} 与 ${preset.id}` })
      else used.set(preset.order, preset.id)
    }
  }
  return issues
}

export function defaultPreset(library: PresetLibrary, paperType: string): Preset | undefined {
  // The lowest order is the default; entries without order never become the default
  // unless the type has nothing else (SPEC v1.1 §5.1).
  const presets = library.byType[paperType] ?? []
  return presets.find(preset => preset.source === 'builtin' && preset.order !== undefined) ?? presets.find(preset => preset.order !== undefined) ?? presets[0]
}

/** Builds a user preset body from the current paper structure (SPEC v1.1 §5.1). */
export function presetFromStructure(input: { title: LocalizedText; summary: LocalizedText; paperType: PresetDocument['paperType'],
  sections: { key: string; title: LocalizedText; focus: LocalizedText; targetLength: number }[],
  supplementalParts?: PresetDocument['supplementalParts']; tags?: string[]; derivedFrom?: string; basedOnVersion?: string }, now: string, version = '1.0.0'): Omit<PresetDocument, 'id'> {
  const shares = normalizeShares(input.sections.map(section => ({ key: section.key, share: Math.max(1, section.targetLength) })))
  const shareByKey = new Map(shares.map(row => [row.key, row.share]))
  return {
    schemaVersion: 1, version, updatedAt: now, paperType: input.paperType,
    title: input.title, summary: input.summary, whenToUse: [],
    sections: input.sections.map(section => ({ key: section.key, title: section.title, focus: section.focus,
      share: shareByKey.get(section.key)!, shareSource: 'heuristic' as const })),
    supplementalParts: input.supplementalParts ?? [], references: [],
    ...(input.derivedFrom && { derivedFrom: input.derivedFrom }),
    ...(input.basedOnVersion && { basedOnVersion: input.basedOnVersion }),
    tags: input.tags ?? [],
  }
}

export function summarize(preset: Preset) {
  return { id: preset.id, source: preset.source, paperType: preset.paperType, order: preset.order ?? null, version: preset.version,
    title: preset.title, summary: preset.summary, sectionCount: preset.sections.length }
}
