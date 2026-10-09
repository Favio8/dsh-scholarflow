import type { CreationSpec } from '../../shared/writing-task.ts'
import { allocate } from '../presets/allocation.ts'

/** Explicit field projection for projects created before writing tasks existed. */
export function requirementsFallback(project: any): Omit<CreationSpec, 'targetLength'> & { targetLength?: number } {
  const { config, ledger } = project
  const length = Object.values<any>(ledger.requirements).find(row => row.kind === 'length')
  const described = length?.description.match(/(?:约|目标篇幅\s*[:：]?)\s*(\d+)/)?.[1]
  const targetLength = described ? Number(described) : typeof length?.constraint?.value === 'number' ? length.constraint.value : undefined
  let sections = ledger.outline.sections.map((section: any) => ({ id: section.id, title: section.title, purpose: section.purpose ?? '',
    targetLength: section.targetLength?.value, allocationMode: section.targetLength?.value === undefined ? 'auto' : 'manual',
    kind: section.kind ?? 'body' }))
  if (targetLength && sections.some((row: any) => row.targetLength === undefined)) {
    const planned = allocate(sections.map((row: any) => ({ ...row, targetLength: row.targetLength ?? 0 })), targetLength)
    if (!planned.minimumShortfall) sections = sections.map((row: any, index: number) => ({ ...row, targetLength: planned.sections[index].targetLength }))
  }
  return { title: config.project.title, type: config.project.type, language: config.project.language,
    format: config.output.defaultFormat ?? 'markdown', requirements: Object.values<any>(ledger.requirements).map(row => row.description).join('\n'),
    materials: [...config.materials.include], online: false, targetLength, sections, requirementSources: [], supplementalParts: [],
    countingPolicy: { scope: 'body', includeAbstract: false, algorithmVersion: 1 }, overrides: [], manuscriptDir: config.paths.manuscriptDir }
}
