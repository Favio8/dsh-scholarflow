import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionsFromPreset, selectionFromPreset } from '../../src/core/presets/apply.ts'
import type { Preset } from '../../src/shared/presets.ts'

const preset = (overrides: Partial<Preset> = {}): Preset => ({
  schemaVersion: 1, id: 'course-argumentative', source: 'builtin', version: '1.0.0', updatedAt: '2026-10-06T00:00:00.000Z',
  paperType: 'course-paper', order: 1,
  title: { 'zh-CN': '论述/分析型', en: 'Argumentative' }, summary: { 'zh-CN': '说明', en: 'Summary' }, whenToUse: [],
  sections: [
    { key: 'intro', title: { 'zh-CN': '引言', en: 'Introduction' }, focus: { 'zh-CN': '交代问题', en: 'Set up' }, share: 0.25, shareSource: 'heuristic' },
    { key: 'body', title: { 'zh-CN': '主题论证', en: 'Argument' }, focus: { 'zh-CN': '展开论证', en: 'Argue' }, share: 0.75, shareSource: 'heuristic' }],
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
    { key: 'a', title: '甲', focus: '一', share: 1, shareSource: 'heuristic' },
    { key: 'b', title: '乙', focus: '二', share: 1, shareSource: 'heuristic' }] })
  assert.deepEqual(sectionsFromPreset(skewed, 'zh-CN', 1000).map(section => section.targetLength), [500, 500])
})

test('a very small share still leaves a chapter above the minimum length', () => {
  const tiny = preset({ sections: [
    { key: 'a', title: '甲', focus: '一', share: 0.999, shareSource: 'heuristic' },
    { key: 'b', title: '乙', focus: '二', share: 0.001, shareSource: 'heuristic' }] })
  const sections = sectionsFromPreset(tiny, 'zh-CN', 4000)
  assert.ok(sections[1]!.targetLength >= 50, '短章节不得低于合同下限')
})

test('the recorded selection carries identity and version but never the structure', () => {
  const selection = selectionFromPreset(preset({ derivedFrom: 'course-argumentative', basedOnVersion: '1.0.0' }))
  assert.deepEqual(selection, { id: 'course-argumentative', source: 'builtin', version: '1.0.0', derivedFrom: 'course-argumentative', modified: false })
  assert.ok(!JSON.stringify(selection).includes('sections'), '论文只记录引用，结构本身另存为快照')
})
