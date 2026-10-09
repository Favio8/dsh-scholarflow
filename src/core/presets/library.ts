import { presetDocument, presetId, comparePresets, sharesSumToOne, type Preset, type PresetDocument, type LocalizedText } from '../../shared/presets.ts'
import { flattenPresetSections, nestPresetSections } from './apply.ts'

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
  const structureIssue = structureInvariant(entry, document)
  if (structureIssue) { issues.push(structureIssue); return undefined }
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

/**
 * Chapter and subsection identities must be unique and their shares must close inside the
 * chapter. A damaged entry is reported, never repaired (SPEC v1.1 §5.1).
 */
function structureInvariant(entry: RawPresetEntry, document: PresetDocument): PresetIssue | undefined {
  const fail = (code: string, message: string): PresetIssue => ({ id: entry.id, source: entry.source, code, message })
  const chapterKeys = new Set<string>()
  for (const section of document.sections) {
    if (chapterKeys.has(section.key)) return fail('PRESET_SECTION_KEY_DUPLICATE', `章节 key 重复：${entry.id}（${section.key}）`)
    chapterKeys.add(section.key)
    if (!section.subsections.length) continue
    const subKeys = new Set<string>([section.key])
    let total = section.leadShare
    for (const subsection of section.subsections) {
      if (subKeys.has(subsection.key)) return fail('PRESET_SUBSECTION_KEY_DUPLICATE', `子章节 key 重复或与所在章节相同：${entry.id}（${section.key}／${subsection.key}）`)
      subKeys.add(subsection.key)
      total += subsection.share
    }
    if (!sharesSumToOne([{ share: total }])) return fail('PRESET_SUBSECTION_SHARES_INVALID',
      `章首导语与子章节占比合计不为 1：${entry.id}（${section.key}，合计 ${total}）`)
  }
  const flat = flattenPresetSections({ ...document, source: entry.source })
  if (flat.length > 40) return fail('PRESET_TOO_MANY_SECTIONS', `展平后章节超过 40：${entry.id}（${flat.length}）`)
  return undefined
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
  sections: { key: string; title: LocalizedText; focus: LocalizedText; targetLength: number; parentKey?: string }[],
  supplementalParts?: PresetDocument['supplementalParts']; tags?: string[]; derivedFrom?: string; basedOnVersion?: string }, now: string, version = '1.0.0'): Omit<PresetDocument, 'id'> {
  return {
    schemaVersion: 1, version, updatedAt: now, paperType: input.paperType,
    title: input.title, summary: input.summary, whenToUse: [],
    // Nesting is rebuilt from the parent keys, so a saved paper keeps its subsections and a
    // flat one stays flat; shares are re-derived from the planned lengths either way.
    sections: nestPresetSections(input.sections),
    supplementalParts: input.supplementalParts ?? [], references: [],
    ...(input.derivedFrom && { derivedFrom: input.derivedFrom }),
    ...(input.basedOnVersion && { basedOnVersion: input.basedOnVersion }),
    tags: input.tags ?? [],
  }
}

export function summarize(preset: Preset) {
  return { id: preset.id, source: preset.source, paperType: preset.paperType, order: preset.order ?? null, version: preset.version,
    title: preset.title, summary: preset.summary, sectionCount: preset.sections.length,
    subsectionCount: preset.sections.reduce((sum, section) => sum + section.subsections.length, 0) }
}
