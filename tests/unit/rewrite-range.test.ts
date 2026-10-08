import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackRange, rewriteTarget } from '../../src/client/rewrite-range.ts'

test('rebasing keeps unrelated edits before and after the accepted span', () => {
  const before = '序言\n目标段落\n结尾', range = { start: 3, end: 7 }
  assert.deepEqual(trackRange(range, before, '新' + before), { start: 4, end: 8 })
  assert.deepEqual(trackRange(range, before, before + '后记'), range)
  assert.equal(trackRange(range, before, before.replace('目标', '修改')), undefined)
})
test('a known input range distinguishes identical paragraphs and keeps UTF-16 offsets', () => {
  const before = '重复\n重复\n😀目标', range = { start: 3, end: 5 }
  assert.deepEqual(trackRange(range, before, '重复\n重复\n重复\n😀目标', { start: 0, end: 0 }), { start: 6, end: 8 })
  assert.equal(trackRange(range, before, '重复\n新段\n😀目标', { start: 3, end: 5 }), undefined)
  assert.deepEqual(trackRange({ start: 8, end: 10 }, before, '前\r\n' + before), { start: 11, end: 13 })
})

test('the marked range is the open candidate, and the user selection before one exists', () => {
  const selection = { start: 10, end: 24 }
  // Nothing chosen yet: nothing is marked.
  assert.equal(rewriteTarget(undefined, undefined), undefined)
  // Chosen but not generated: the selection itself is the target, so it can be shown immediately.
  assert.deepEqual(rewriteTarget(undefined, selection), { start: 10, end: 24, state: 'selected' })
  // A running or finished candidate is the target, and it keeps its own state so the mark can flow.
  for (const state of ['generating', 'ready', 'stopped', 'failed']) {
    assert.deepEqual(rewriteTarget({ start: 4, end: 9, state }, selection), { start: 4, end: 9, state })
  }
  // A decided candidate stops being the target; the selection underneath is what remains.
  for (const state of ['accepted', 'discarded']) {
    assert.deepEqual(rewriteTarget({ start: 4, end: 9, state }, selection), { start: 10, end: 24, state: 'selected' })
  }
  assert.equal(rewriteTarget({ start: 4, end: 9, state: 'accepted' }, undefined), undefined)
})
