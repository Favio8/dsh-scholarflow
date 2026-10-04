import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transientRetry, waitRetrySlice } from '../../src/core/pipeline/retry.ts'
import { ScholarError } from '../../src/shared/errors.ts'

test('temporary provider retries respect windows, exponential jitter and a total limit of two', () => {
  const error = new ScholarError('RATE_LIMIT', 'TEST_ONLY', { status: 429, providerRetryAfterMs: 12000 })
  assert.deepEqual(transientRetry(error, 0, 100, () => 0), { retry: 1, notBefore: 12100, delayMs: 12000, code: 'RATE_LIMIT' })
  assert.equal(transientRetry(new ScholarError('SERVER', 'TEST_ONLY', { status: 503 }), 0, 100, () => 1)!.delayMs, 550)
  assert.equal(transientRetry(new ScholarError('SERVER', 'TEST_ONLY', { status: 503 }), 1, 100, () => 1)!.delayMs, 1100)
  assert.equal(transientRetry(error, 2, 100), undefined)
  for (const error of [new ScholarError('AUTH', 'TEST_ONLY', { status: 503 }), new ScholarError('SERVER', 'TEST_ONLY', { status: 401 }),
    new ScholarError('RATE_LIMIT', 'TEST_ONLY', { status: 403 }), new ScholarError('NO_ADAPTER', 'TEST_ONLY'), new Error('TEST_ONLY transient-looking text')])
    assert.equal(transientRetry(error, 0), undefined)
})

test('a provider-window wait is abortable without waiting out the window', async () => {
  const controller = new AbortController(), waiting = waitRetrySlice(60000, controller.signal)
  controller.abort(new Error('TEST_ONLY user cancellation'))
  await assert.rejects(waiting, /TEST_ONLY user cancellation/)
})
