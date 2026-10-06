import { localized, type Preset } from '../../shared/presets.ts'
import type { CreationSpec } from '../../shared/writing-task.ts'

// Applying a preset to a paper: the preset's shares become automatic chapter lengths, and
// the section identity is stable so re-applying does not orphan anything. Pure, so the
// mapping is testable without rendering the wizard.

export function sectionsFromPreset(preset: Preset, language: 'zh-CN' | 'en', target: number): CreationSpec['sections'] {
  const total = preset.sections.reduce((sum, section) => sum + section.share, 0) || 1
  return preset.sections.map((section, index) => ({ id: `section_${index + 1}_${section.key}`,
    title: localized(section.title, language), purpose: localized(section.focus, language),
    targetLength: Math.max(50, Math.round(target * section.share / total)),
    allocationMode: 'auto' as const, allocationWeight: section.share }))
}

/** The preset reference recorded on the paper, without copying the preset's own fields. */
export function selectionFromPreset(preset: Preset) {
  return { id: preset.id, source: preset.source, version: preset.version,
    ...(preset.derivedFrom === undefined ? {} : { derivedFrom: preset.derivedFrom }), modified: false }
}
