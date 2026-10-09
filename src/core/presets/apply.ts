import { localized, SUPPLEMENTAL_LABELS, SUPPLEMENTAL_PLACEMENT, SUPPLEMENTAL_PRODUCTION,
  type LocalizedText, type Preset, type PresetDocument } from '../../shared/presets.ts'
import type { CreationSpec } from '../../shared/writing-task.ts'
import { MINIMUM_SECTION_LENGTH } from './allocation.ts'

// Applying a preset to a paper: the preset's shares become automatic chapter lengths, and
// the section identity is stable so re-applying does not orphan anything. Pure, so the
// mapping is testable without rendering the wizard.
//
// A preset chapter may carry subsections. Flattening is the single place that decides what
// nesting means: a chapter with subsections keeps one outline row of its own (so its
// subsections have a parent to hang from) and spends `leadShare` of its share on a lead-in;
// a chapter without them is one plain row carrying its whole share.

/** One flattened row of a preset, in document order. */
export interface FlatSection {
  key: string
  /** Set when this row is a subsection of the chapter named by `key` above it. */
  parentKey?: string
  title: LocalizedText
  focus: LocalizedText
  /** Absolute share of the body target, after the chapter share is applied. */
  weight: number
}

export function flattenPresetSections(preset: Preset): FlatSection[] {
  const rows: FlatSection[] = []
  for (const section of preset.sections) {
    if (!section.subsections.length) {
      rows.push({ key: section.key, title: section.title, focus: section.focus, weight: section.share })
      continue
    }
    rows.push({ key: section.key, title: section.title, focus: section.focus, weight: section.share * section.leadShare })
    for (const subsection of section.subsections) {
      rows.push({ key: subsection.key, parentKey: section.key, title: subsection.title, focus: subsection.focus,
        weight: section.share * subsection.share })
    }
  }
  return rows
}

/** A paper row as the save path hands it over: a key, a parent key and a planned length. */
export interface NestableSection { key: string; title: LocalizedText; focus: LocalizedText; targetLength: number; parentKey?: string }

/**
 * The inverse of `flattenPresetSections`: paper rows become a nested preset again. Chapter
 * shares are re-derived from the planned lengths, so a round trip through save and apply
 * lands on the same structure instead of drifting.
 */
export function nestPresetSections(sections: NestableSection[]): PresetDocument['sections'] {
  const weightOf = (section: NestableSection) => Math.max(1, section.targetLength)
  const childrenOf = (key: string) => sections.filter(section => section.parentKey === key)
  const roots = sections.filter(section => section.parentKey === undefined || !sections.some(row => row.key === section.parentKey))
  const chapterWeight = (root: NestableSection) => weightOf(root) + childrenOf(root.key).reduce((sum, child) => sum + weightOf(child), 0)
  const total = roots.reduce((sum, root) => sum + chapterWeight(root), 0) || 1
  return roots.map(root => {
    const children = childrenOf(root.key)
    const chapter = chapterWeight(root)
    return { key: root.key, title: root.title, focus: root.focus, share: chapter / total, shareSource: 'heuristic' as const,
      leadShare: children.length ? weightOf(root) / chapter : 0,
      subsections: children.map(child => ({ key: child.key, title: child.title, focus: child.focus,
        share: weightOf(child) / chapter, shareSource: 'heuristic' as const })) }
  })
}

/** Suggested length for a part the preset left open; every value stays an editable起点. */
const SUPPLEMENTAL_LENGTH: Record<string, number> = { abstract: 300, keywords: 50, 'abstract-en': 150,
  acknowledgements: 100, appendix: 200, 'publication-info': 100 }

export interface PresetApplyOptions {
  /** Which supplemental parts the user kept. Defaults to every part the preset declares. */
  supplementalKinds?: readonly string[]
}

/** A planned row before ids are assigned; `key`/`parentKey` are preset-local identities. */
interface PlannedSection {
  key: string
  parentKey?: string
  title: string
  purpose: string
  targetLength: number
  allocationMode: 'auto' | 'manual'
  allocationWeight?: number
  kind: 'body' | 'front' | 'back'
}

export function sectionsFromPreset(preset: Preset, language: 'zh-CN' | 'en', target: number,
  options: PresetApplyOptions = {}): CreationSpec['sections'] {
  const flat = flattenPresetSections(preset)
  const total = flat.reduce((sum, row) => sum + row.weight, 0) || 1
  const kept = options.supplementalKinds
  const supplemental = (placement: 'front' | 'back') => preset.supplementalParts.filter(part =>
    (!kept || kept.includes(part.kind)) && SUPPLEMENTAL_PRODUCTION[part.kind] === 'manuscript'
    && SUPPLEMENTAL_PLACEMENT[part.kind] === placement)
    .map(part => ({ key: part.kind, title: localized(SUPPLEMENTAL_LABELS[part.kind], language),
      purpose: localized(part.description, language),
      targetLength: Math.max(MINIMUM_SECTION_LENGTH, part.suggestedLength ?? SUPPLEMENTAL_LENGTH[part.kind] ?? MINIMUM_SECTION_LENGTH),
      allocationMode: 'manual' as const, kind: placement }))
  // Front matter leads the outline, back matter closes it; both are drafted after the body.
  const planned: PlannedSection[] = [...supplemental('front'),
    ...flat.map(row => ({ key: row.key, parentKey: row.parentKey, title: localized(row.title, language),
      purpose: localized(row.focus, language),
      targetLength: Math.max(MINIMUM_SECTION_LENGTH, Math.round(target * row.weight / total)),
      allocationMode: 'auto' as const, allocationWeight: row.weight, kind: 'body' as const })),
    ...supplemental('back')]
  const idByKey = new Map<string, string>()
  return planned.map((row, index) => {
    const id = `section_${index + 1}_${row.key}`
    idByKey.set(row.key, id)
    return { id, title: row.title, purpose: row.purpose, targetLength: row.targetLength,
      allocationMode: row.allocationMode,
      ...(row.allocationWeight === undefined ? {} : { allocationWeight: row.allocationWeight }),
      ...(row.parentKey === undefined || !idByKey.has(row.parentKey) ? {} : { parentId: idByKey.get(row.parentKey) }),
      kind: row.kind }
  })
}

/** The preset reference recorded on the paper, without copying the preset's own fields. */
export function selectionFromPreset(preset: Preset) {
  return { id: preset.id, source: preset.source, version: preset.version,
    ...(preset.derivedFrom === undefined ? {} : { derivedFrom: preset.derivedFrom }), modified: false }
}
