import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { parseOutlineJson, readOutlineResponse } from '../../src/host/bridge/outline-response.ts'
import { ScholarError } from '../../src/shared/errors.ts'

test('plain JSON and a complete fenced JSON envelope preserve the same content', () => {
  const data = { taskSummary: 'TEST_ONLY', sections: [{ title: '测试章节' }] }
  for (const text of [JSON.stringify(data), '\uFEFF' + JSON.stringify(data), '```json\n' + JSON.stringify(data) + '\n```', '```JSON\r\n' + JSON.stringify(data) + '\r\n```', '```\n' + JSON.stringify(data) + '\n```'])
    assert.deepEqual(parseOutlineJson(text), data)
  for (const text of ['说明文字 {"a":1}', '```json\n{}\n```\n```json\n{}\n```', '{"a":', '({a:1})']) assert.throws(() => parseOutlineJson(text))
})

test('valid fenced responses require no extra model request', async () => {
  const schema = z.object({ title: z.string() })
  const result = await readOutlineResponse('```json\n{"title":"TEST_ONLY"}\n```', value => schema.parse(value), async () => { throw new Error('must not repair valid content') }, 'generation')
  assert.equal(result.title, 'TEST_ONLY')
})

test('format issues get exactly one repair with field paths and no raw user values', async () => {
  const schema = z.object({ title: z.string(), length: z.number() })
  let calls = 0
  const result = await readOutlineResponse('{"title":"TEST_ONLY"}', value => schema.parse(value), async (previous, issues) => {
    calls++; assert.equal(previous, '{"title":"TEST_ONLY"}'); assert.deepEqual(issues, [{ path: 'length', code: 'invalid_type' }])
    return '{"title":"TEST_ONLY","length":1500}'
  }, 'generation')
  assert.equal(calls, 1); assert.equal(result.length, 1500)
  calls = 0
  await assert.rejects(readOutlineResponse('broken', value => schema.parse(value), async () => { calls++; return 'still broken' }, 'review'), /已尝试修复一次/)
  assert.equal(calls, 1)
})

test('semantic/source refusal and cancellation are not repaired away', async () => {
  let calls = 0
  await assert.rejects(readOutlineResponse('{}', () => { throw new ScholarError('OUTLINE_UNGROUNDED', '没有来源') }, async () => { calls++; return '{}' }, 'generation'), /没有来源/)
  assert.equal(calls, 0)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readOutlineResponse('broken', value => value, async () => { controller.signal.throwIfAborted(); return '{}' }, 'generation'), { name: 'AbortError' })
})
