import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callStageModel } from '../../src/host/executor/model.ts'

test('stage adapter retains only validated retry facts and does not retry or expose provider failure bodies', async () => {
  let calls = 0, flushed = false
  const session = { id: 'ses_TEST_ONLY', append: () => undefined }, ctx = { sessions: { flush: async () => { flushed = true; return true } },
    llm: { async *stream() { assert.equal(flushed, true); calls++; yield { type: 'finish', reason: { kind: 'error', failure: {
      code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 12000, message: 'TEST_ONLY private provider failure', requestId: 'TEST_ONLY_PRIVATE',
      headers: { authorization: 'TEST_ONLY_SECRET' } } } } } } }
  await assert.rejects(callStageModel(ctx, session, { provider: 'TEST_ONLY', model: 'TEST_ONLY' }, { system: 'TEST_ONLY', instruction: 'TEST_ONLY',
    context: {}, runId: 'run_TEST_ONLY', signal: new AbortController().signal }), error => {
    assert.equal((error as any).code, 'RATE_LIMIT')
    assert.deepEqual((error as any).details, { status: 429, providerRetryAfterMs: 12000 })
    assert.ok(!(error as Error).message.includes('private provider')); return true
  })
  assert.equal(calls, 1, 'Core owns the bounded retry policy, not the single-call Host adapter')
})
