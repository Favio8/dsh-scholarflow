import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPresetLibrary, type RawPresetEntry } from '../../src/core/presets/library.ts'

// A damaged entry is reported and skipped; its neighbours still load. Nothing here is
// repaired or guessed at (SPEC v1.1 §5.1).

const base = {
  schemaVersion: 1, id: 'course-argumentative', version: '1.0.0', updatedAt: '2026-10-06T00:00:00.000Z',
  paperType: 'course-paper', order: 1, title: { 'zh-CN': '论述型', en: 'Argumentative' }, summary: { 'zh-CN': '说明', en: 'Summary' },
  whenToUse: [{ 'zh-CN': '情形一', en: 'Case one' }, { 'zh-CN': '情形二', en: 'Case two' }],
  references: [{ label: 'R1', url: 'https://example.org/r1' }],
}
const chapter = (key: string, share: number, extra: Record<string, unknown> = {}) =>
  ({ key, title: { 'zh-CN': key, en: key }, focus: { 'zh-CN': key, en: key }, share, shareSource: 'heuristic', ...extra })
const entry = (id: string, document: Record<string, unknown>): RawPresetEntry =>
  ({ id, source: 'user', text: JSON.stringify({ ...base, id, ...document }) })
const neighbour = entry('course-lab-report', { sections: [chapter('intro', 1)] })
const load = (document: Record<string, unknown>) => loadPresetLibrary([entry('course-argumentative', document), neighbour])

const codes = (document: Record<string, unknown>) => load(document).issues.map(issue => issue.code)

test('a chapter whose lead-in and subsection shares do not close is refused', () => {
  const library = load({ sections: [chapter('argument', 1, { leadShare: 0.2,
    subsections: [chapter('claim', 0.5), chapter('evidence', 0.5)] })] })
  assert.deepEqual(library.issues.map(issue => issue.code), ['PRESET_SUBSECTION_SHARES_INVALID'])
  assert.equal(library.all.length, 1, '同批的合法条目照常载入')
  assert.equal(library.all[0]!.id, 'course-lab-report')
})

test('a subsection key that repeats inside its chapter is refused', () => {
  assert.deepEqual(codes({ sections: [chapter('argument', 1, { leadShare: 0,
    subsections: [chapter('claim', 0.5), chapter('claim', 0.5)] })] }), ['PRESET_SUBSECTION_KEY_DUPLICATE'])
})

test('a subsection key that repeats its own chapter key is refused', () => {
  assert.deepEqual(codes({ sections: [chapter('argument', 1, { leadShare: 0,
    subsections: [chapter('argument', 0.5), chapter('claim', 0.5)] })] }), ['PRESET_SUBSECTION_KEY_DUPLICATE'])
})

test('a chapter key that repeats is refused', () => {
  assert.deepEqual(codes({ sections: [chapter('intro', 0.5), chapter('intro', 0.5)] }), ['PRESET_SECTION_KEY_DUPLICATE'])
})

test('flattening past forty rows is refused rather than silently truncated', () => {
  const sections = Array.from({ length: 9 }, (_, index) => chapter(`chapter-${index}`, 1 / 9, { leadShare: 0,
    subsections: Array.from({ length: 8 }, (_, sub) => chapter(`sub-${index}-${sub}`, 1 / 8)) }))
  assert.equal(sections.length * 9, 81)
  assert.deepEqual(codes({ sections }), ['PRESET_TOO_MANY_SECTIONS'])
})

test('a well-formed nested chapter loads without an issue', () => {
  const library = load({ sections: [chapter('argument', 1, { leadShare: 0.2,
    subsections: [chapter('claim', 0.5), chapter('evidence', 0.3)] })] })
  assert.deepEqual(library.issues, [])
  assert.equal(library.all.length, 2)
})

test('a pure container chapter still carries body weight through its subsections', () => {
  // leadShare 0 is legal: the chapter itself takes the section minimum and its subsections
  // carry the share, so the flattened weights still sum to one and nothing needs guarding.
  const library = load({ sections: [chapter('argument', 1, { leadShare: 0,
    subsections: [chapter('claim', 0.5), chapter('evidence', 0.5)] })] })
  assert.deepEqual(library.issues, [])
  assert.equal(library.all.length, 2)
})

test('a subsection that is not an array is refused by the schema, not by a later crash', () => {
  const library = load({ sections: [chapter('argument', 1, { subsections: 'claim' })] })
  assert.deepEqual(library.issues.map(issue => issue.code), ['PRESET_INVALID'])
  assert.equal(library.all.length, 1)
})

test('an unknown supplemental kind is refused', () => {
  assert.deepEqual(codes({ sections: [chapter('intro', 1)],
    supplementalParts: [{ kind: 'dedication', description: '题献' }] }), ['PRESET_INVALID'])
})
