import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gbt7714Entry, referenceNotes } from '../../src/core/export/citations.ts'
import type { Source } from '../../src/shared/schema.ts'

// GB/T 7714-2015 entry text. The ledger holds what it holds: a missing venue or page range is
// left out rather than filled in, and the type tag comes from the registered kind.

const source = (overrides: Partial<Source> = {}): Source => ({
  id: 'src_TEST_ONLY', kind: 'paper', title: 'TEST_ONLY 题名', authors: [], identifiers: {}, citeKey: 'sf_TEST_ONLY',
  provenance: [], identity: { status: 'unverified', method: 'none' }, textAccess: 'metadata', ...overrides,
} as Source)

test('a journal article carries its tag, authors, venue and year in order', () => {
  const entry = gbt7714Entry(source({ authors: [{ literal: '张三' }, { literal: 'Watkins C' }],
    venue: '机器学习学报', year: 2024, identifiers: { doi: '10.1000/test' } }), 1)
  assert.equal(entry, '[1] 张三, Watkins C. TEST_ONLY 题名[J]. 机器学习学报, 2024, DOI: 10.1000/test.')
})

test('a missing venue or year is left out instead of being filled with 不详', () => {
  const entry = gbt7714Entry(source({ kind: 'book', title: 'TEST_ONLY 书名', authors: [{ literal: '李四' }] }), 3)
  assert.equal(entry, '[3] 李四. TEST_ONLY 书名[M].')
  assert.doesNotMatch(entry, /不详|unknown|N\/A/u)
})

test('each registered kind maps to its own type tag, and user results get none', () => {
  assert.match(gbt7714Entry(source({ kind: 'paper' }), 1), /\[J\]/u)
  assert.match(gbt7714Entry(source({ kind: 'book' }), 1), /\[M\]/u)
  assert.match(gbt7714Entry(source({ kind: 'web', identifiers: { url: 'https://example.org' } }), 1), /\[EB\/OL\]/u)
  assert.match(gbt7714Entry(source({ kind: 'dataset', identifiers: { url: 'https://example.org/d' } }), 1), /\[DB\/OL\]/u)
  assert.doesNotMatch(gbt7714Entry(source({ kind: 'user-result' }), 1), /\[[A-Z]/u, '用户自有结果不是文献，不标类型')
  assert.doesNotMatch(gbt7714Entry(source({ kind: 'other' }), 1), /\[[A-Z]/u, '未登记类型的来源不猜标签')
})

test('a web reference carries its URL, a paper its DOI', () => {
  assert.match(gbt7714Entry(source({ kind: 'web', identifiers: { url: 'https://example.org/a' } }), 1), /https:\/\/example\.org\/a/u)
  assert.match(gbt7714Entry(source({ identifiers: { doi: '10.1000/x' } }), 1), /DOI: 10\.1000\/x/u)
})

test('more than three authors are truncated with et al, as the standard asks', () => {
  const entry = gbt7714Entry(source({ authors: [{ literal: '一' }, { literal: '二' }, { literal: '三' }, { literal: '四' }] }), 1)
  assert.match(entry, /^\[1\] 一, 二, 三, et al\./u)
})

test('the notes say the tag is inferred and that user results are not literature', () => {
  const notes = referenceNotes([source({ kind: 'paper' }), source({ id: 'src_two', kind: 'user-result', citeKey: 'sf_two' })])
  assert.ok(notes.some(note => note.includes('推断')))
  assert.ok(notes.some(note => note.includes('用户自有结果')))
  assert.deepEqual(referenceNotes([source({ venue: '刊名', year: 2024 })]), [])
})
