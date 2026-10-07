import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackRange } from '../../src/client/rewrite-range.ts'

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
