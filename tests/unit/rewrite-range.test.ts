import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackRange, rewriteTarget, sourceOffset, paneOffset } from '../../src/client/rewrite-range.ts'

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
test('a pane offset and a manuscript offset are the two directions of one conversion', () => {
  const lf = '第一行\n第二行\n', breaks = (text: string) => text.match(/\n/g)?.length ?? 0
  // Without CRLF the two spaces are the same, and a bare CR only counts once.
  for (let index = 0; index <= lf.length; index++) assert.equal(sourceOffset(lf, index, 'lf'), index)
  // With CRLF every line break before the offset adds one, and the pair round-trips both ways.
  for (let index = 0; index <= lf.length; index++) assert.equal(sourceOffset(lf, index, 'crlf'), index + breaks(lf.slice(0, index)))
  const crlf = lf.replace(/\n/g, '\r\n')
  for (let index = 0; index <= lf.length; index++) assert.equal(paneOffset(crlf, sourceOffset(lf, index, 'crlf')), index)
  assert.equal(paneOffset('a\rb\r\nc', 5), 4)
  // An offset past the end clamps to the whole text rather than inventing a position.
  assert.equal(sourceOffset(lf, 999, 'lf'), lf.length); assert.equal(paneOffset(crlf, 999), lf.length)
})
