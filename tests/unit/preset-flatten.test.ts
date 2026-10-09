import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flattenPresetSections, nestPresetSections, sectionsFromPreset } from '../../src/core/presets/apply.ts'
import { allocate } from '../../src/core/presets/allocation.ts'
import type { Preset } from '../../src/shared/presets.ts'

// Flattening is the one place that decides what nesting means, and saving is its inverse.
// A structure that survives save-then-apply unchanged is what lets the wizard offer "save as
// my preset" without silently rewriting the paper it came from.

const preset = (overrides: Partial<Preset> = {}): Preset => ({
  schemaVersion: 1, id: 'course-argumentative', source: 'builtin', version: '2.0.0', updatedAt: '2026-10-09T00:00:00.000Z',
  paperType: 'course-paper', order: 1,
  title: { 'zh-CN': '论述/分析型', en: 'Argumentative' }, summary: { 'zh-CN': '说明', en: 'Summary' }, whenToUse: [],
  sections: [], supplementalParts: [], references: [], tags: [], ...overrides,
} as Preset)

const chapter = (key: string, share: number, leadShare = 0, subsections: { key: string; share: number }[] = []) => ({
  key, title: { 'zh-CN': key, en: key }, focus: { 'zh-CN': key, en: key }, share, shareSource: 'heuristic' as const,
  leadShare, subsections: subsections.map(row => ({ ...row, title: { 'zh-CN': row.key, en: row.key },
    focus: { 'zh-CN': row.key, en: row.key }, shareSource: 'heuristic' as const })),
})

test('a chapter without subsections is one row carrying its whole share', () => {
  const flat = flattenPresetSections(preset({ sections: [chapter('intro', 0.3), chapter('conclusion', 0.7)] }))
  assert.deepEqual(flat.map(row => [row.key, row.parentKey, row.weight]), [['intro', undefined, 0.3], ['conclusion', undefined, 0.7]])
})

test('a chapter with subsections spends leadShare on itself and the rest on its subsections', () => {
  const flat = flattenPresetSections(preset({ sections: [
    chapter('argument', 0.6, 0.1, [{ key: 'claim', share: 0.45 }, { key: 'evidence', share: 0.45 }]),
    chapter('conclusion', 0.4)] }))
  assert.deepEqual(flat.map(row => [row.key, row.parentKey, row.weight]), [
    ['argument', undefined, 0.06], ['claim', 'argument', 0.27], ['evidence', 'argument', 0.27], ['conclusion', undefined, 0.4]])
  assert.equal(flat.reduce((sum, row) => sum + row.weight, 0), 1)
})

test('applying a nested preset keeps document order and points each subsection at its chapter', () => {
  const sections = sectionsFromPreset(preset({ sections: [
    chapter('intro', 0.2), chapter('argument', 0.6, 0.1, [{ key: 'claim', share: 0.9 }]), chapter('conclusion', 0.2)] }), 'zh-CN', 1000)
  assert.deepEqual(sections.map(section => section.title), ['intro', 'argument', 'claim', 'conclusion'])
  assert.deepEqual(sections.map(section => section.id), ['section_1_intro', 'section_2_argument', 'section_3_claim', 'section_4_conclusion'])
  assert.equal(sections[2]!.parentId, 'section_2_argument')
  assert.equal(sections[0]!.parentId, undefined)
  assert.deepEqual(sections.map(section => section.kind), ['body', 'body', 'body', 'body'])
})

test('a container chapter takes the section minimum and leaves the rest to its subsections', () => {
  const sections = sectionsFromPreset(preset({ sections: [
    chapter('argument', 0.8, 0, [{ key: 'claim', share: 0.5 }, { key: 'evidence', share: 0.5 }]),
    chapter('conclusion', 0.2)] }), 'zh-CN', 1000)
  assert.deepEqual(sections.map(section => section.title), ['argument', 'claim', 'evidence', 'conclusion'])
  // leadShare 0 means weight 0: the allocator floors it to the minimum instead of sharing the budget.
  assert.equal(sections[0]!.allocationWeight, 0)
  assert.equal(sections[0]!.targetLength, 50)
  assert.deepEqual(sections.slice(1).map(section => section.targetLength), [400, 400, 200])
  // The floor pass then takes those 50 back out of the weighted pool, so the plan still lands
  // exactly on the target without the allocator learning anything about nesting.
  const plan = allocate(sections.map(section => ({ id: section.id, targetLength: section.targetLength,
    allocationMode: section.allocationMode, allocationWeight: section.allocationWeight })), 1000)
  assert.deepEqual(plan.sections.map(section => section.targetLength), [50, 380, 380, 190])
  assert.equal(plan.total, 1000)
  assert.deepEqual(plan.notes, [])
})

/** Structure only: a round trip passes through the localised paper, so text shape changes. */
const shape = (sections: ReturnType<typeof nestPresetSections>) => sections.map(section =>
  [section.key, section.share, section.leadShare, section.subsections.map(row => [row.key, row.share])])

test('saving a nested paper and applying it again lands on the same structure', () => {
  const source = preset({ sections: [
    chapter('intro', 0.2), chapter('argument', 0.6, 0.25, [{ key: 'claim', share: 0.3 }, { key: 'evidence', share: 0.45 }]),
    chapter('conclusion', 0.2)] })
  const applied = sectionsFromPreset(source, 'zh-CN', 4000)
  const saved = nestPresetSections(applied.map(section => ({ key: section.id.replace(/^section_\d+_/, ''),
    title: section.title, focus: section.purpose, targetLength: section.targetLength,
    ...(section.parentId ? { parentKey: section.parentId.replace(/^section_\d+_/, '') } : {}) })))
  assert.deepEqual(shape(saved), shape(source.sections), '保存后再应用必须得到同一结构')
})

test('saving a flat paper keeps it flat', () => {
  const source = preset({ sections: [chapter('intro', 0.4), chapter('conclusion', 0.6)] })
  const applied = sectionsFromPreset(source, 'zh-CN', 2000)
  const saved = nestPresetSections(applied.map(section => ({ key: section.id.replace(/^section_\d+_/, ''),
    title: section.title, focus: section.purpose, targetLength: section.targetLength })))
  assert.deepEqual(shape(saved), shape(source.sections))
  assert.ok(saved.every(section => section.subsections.length === 0 && section.leadShare === 0))
})

test('front matter leads the outline and back matter closes it, both drafted after the body', () => {
  const sections = sectionsFromPreset(preset({ sections: [chapter('intro', 0.5), chapter('conclusion', 0.5)],
    supplementalParts: [
      { kind: 'references', description: '参考文献' },
      { kind: 'abstract', description: '摘要', suggestedLength: 300 },
      { kind: 'keywords', description: '关键词' },
      { kind: 'acknowledgements', description: '致谢' }] }), 'zh-CN', 2000)
  assert.deepEqual(sections.map(section => [section.title, section.kind]), [
    ['摘要', 'front'], ['关键词', 'front'], ['intro', 'body'], ['conclusion', 'body'], ['致谢', 'back']])
  assert.deepEqual(sections.map(section => section.allocationMode), ['manual', 'manual', 'auto', 'auto', 'manual'])
  assert.equal(sections[0]!.targetLength, 300)
  // References are built by the exporter from the citation order, never drafted as a chapter.
  assert.ok(!sections.some(section => section.title === '参考文献'))
})

test('the user may drop a supplemental part without touching the body', () => {
  const base = preset({ sections: [chapter('intro', 1)],
    supplementalParts: [{ kind: 'abstract', description: '摘要' }, { kind: 'keywords', description: '关键词' }] })
  const kept = sectionsFromPreset(base, 'zh-CN', 1000, { supplementalKinds: ['keywords'] })
  assert.deepEqual(kept.map(section => section.title), ['关键词', 'intro'])
  assert.equal(kept.at(-1)!.targetLength, 1000, '正文篇幅不受取消前置部分影响')
})

test('an export-only part is declared, never drafted', () => {
  const sections = sectionsFromPreset(preset({ sections: [chapter('intro', 1)],
    supplementalParts: [{ kind: 'toc', description: '目录' }, { kind: 'cover', description: '封面' }] }), 'zh-CN', 1000)
  assert.deepEqual(sections.map(section => section.title), ['intro'])
})
