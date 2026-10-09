import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionsFromPreset, selectionFromPreset } from '../../src/core/presets/apply.ts'
import type { Preset } from '../../src/shared/presets.ts'

/** A chapter with the defaults filled in; `leadShare`/`subsections` are explicit on purpose. */
const sec = (key: string, zh: string, en: string, focusZh: string, focusEn: string, share: number) =>
  ({ key, title: { 'zh-CN': zh, en }, focus: { 'zh-CN': focusZh, en: focusEn }, share, shareSource: 'heuristic' as const,
    leadShare: 0, subsections: [] })

const preset = (overrides: Partial<Preset> = {}): Preset => ({
  schemaVersion: 1, id: 'course-argumentative', source: 'builtin', version: '1.0.0', updatedAt: '2026-10-06T00:00:00.000Z',
  paperType: 'course-paper', order: 1,
  title: { 'zh-CN': '论述/分析型', en: 'Argumentative' }, summary: { 'zh-CN': '说明', en: 'Summary' }, whenToUse: [],
  sections: [
    sec('intro', '引言', 'Introduction', '交代问题', 'Set up', 0.25),
    sec('body', '主题论证', 'Argument', '展开论证', 'Argue', 0.75)],
  supplementalParts: [], references: [], tags: [], ...overrides,
} as Preset)

test('applying a preset turns shares into automatic chapter lengths', () => {
  const sections = sectionsFromPreset(preset(), 'zh-CN', 4000)
  assert.deepEqual(sections.map(section => section.title), ['引言', '主题论证'])
  assert.deepEqual(sections.map(section => section.targetLength), [1000, 3000])
  assert.ok(sections.every(section => section.allocationMode === 'auto'), '预设带来的篇幅是自动的，改目标时会重算')
  assert.deepEqual(sections.map(section => section.allocationWeight), [0.25, 0.75])
  assert.deepEqual(sections.map(section => section.id), ['section_1_intro', 'section_2_body'])
})

test('the same preset in another language yields the other titles, not a translation', () => {
  const english = sectionsFromPreset(preset(), 'en', 4000)
  assert.deepEqual(english.map(section => section.title), ['Introduction', 'Argument'])
  assert.deepEqual(english.map(section => section.purpose), ['Set up', 'Argue'])
})

test('shares that do not sum to one are normalised rather than trusted', () => {
  const skewed = preset({ sections: [
    sec('a', '甲', 'A', '一', 'one', 1), sec('b', '乙', 'B', '二', 'two', 1)] })
  assert.deepEqual(sectionsFromPreset(skewed, 'zh-CN', 1000).map(section => section.targetLength), [500, 500])
})

test('a very small share still leaves a chapter above the minimum length', () => {
  const tiny = preset({ sections: [
    sec('a', '甲', 'A', '一', 'one', 0.999), sec('b', '乙', 'B', '二', 'two', 0.001)] })
  const sections = sectionsFromPreset(tiny, 'zh-CN', 4000)
  assert.ok(sections[1]!.targetLength >= 50, '短章节不得低于合同下限')
})

test('the recorded selection carries identity and version but never the structure', () => {
  const selection = selectionFromPreset(preset({ derivedFrom: 'course-argumentative', basedOnVersion: '1.0.0' }))
  assert.deepEqual(selection, { id: 'course-argumentative', source: 'builtin', version: '1.0.0', derivedFrom: 'course-argumentative', modified: false })
  assert.ok(!JSON.stringify(selection).includes('sections'), '论文只记录引用，结构本身另存为快照')
})
