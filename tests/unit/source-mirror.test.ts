// TEST_ONLY: the mirror's content contract, checked without a browser. The split is what decides
// which characters carry the gradient, so its edges — clipping, an empty range, an inverted one — are
// worth pinning down on their own rather than only through a rendered pane.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitPaneText } from '../../src/client/source-mirror.ts'

test('the split covers the whole value and the middle is exactly the range', () => {
  const value = '第一句。第二句。第三句。'
  const parts = splitPaneText(value, 4, 8)
  assert.deepEqual(parts, { before: '第一句。', marked: '第二句。', after: '第三句。' })
  assert.equal(parts.before + parts.marked + parts.after, value)
})

test('a range at either end of the value still splits losslessly', () => {
  const value = '标题\n\n正文'
  assert.deepEqual(splitPaneText(value, 0, 2), { before: '', marked: '标题', after: '\n\n正文' })
  assert.deepEqual(splitPaneText(value, 3, 6), { before: '标题\n', marked: '\n正文', after: '' })
})

test('out-of-range bounds are clipped rather than trusted', () => {
  const value = 'abc'
  assert.deepEqual(splitPaneText(value, -5, 99), { before: '', marked: 'abc', after: '' })
  assert.deepEqual(splitPaneText(value, 1, 99), { before: 'a', marked: 'bc', after: '' })
  assert.deepEqual(splitPaneText(value, -5, 2), { before: '', marked: 'ab', after: 'c' })
})

test('an empty or inverted range splits nothing, so the caller paints no mark at all', () => {
  assert.equal(splitPaneText('abc', 2, 2), undefined)
  assert.equal(splitPaneText('abc', 2, 1), undefined)
  assert.equal(splitPaneText('', 0, 0), undefined)
})

test('a range that covers the whole value has empty surroundings', () => {
  assert.deepEqual(splitPaneText('abc', 0, 3), { before: '', marked: 'abc', after: '' })
})
