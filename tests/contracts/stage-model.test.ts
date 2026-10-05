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

test('stage adapter sends only the frozen output budget and fails a truncated reasoning response without automatic retries', async () => {
  let calls = 0, logged: any, flushed = false
  const session = { id: 'ses_TEST_ONLY', append: (type: string, data: any) => { assert.equal(type, 'user/message');
    const audit = JSON.parse(data.content[0].text); if (audit.phase === 'request') logged = audit.payload } }
  const ctx = { sessions: { flush: async () => { flushed = true; return true } }, llm: { async *stream(request: any) {
    assert.equal(flushed, true); assert.equal(request.maxTokens, 16384); assert.equal(logged.maxTokens, 16384); calls++
    yield { type: 'finish', reason: { kind: 'max-tokens' } }
  } } }
  const call = { system: 'TEST_ONLY', instruction: 'TEST_ONLY', context: {}, runId: 'run_TEST_ONLY', signal: new AbortController().signal, maxTokens: 16384 }
  await assert.rejects(callStageModel(ctx, session, { provider: 'TEST_ONLY', model: 'TEST_ONLY' }, call), { code: 'MODEL_OUTPUT_LIMIT_REACHED' })
  assert.equal(calls, 1)
  await assert.rejects(callStageModel(ctx, session, { provider: 'TEST_ONLY', model: 'TEST_ONLY' }, { ...call, maxTokens: 32769 }), { code: 'MODEL_OUTPUT_BUDGET_INVALID' })
  assert.equal(calls, 1)
})

test('stage request and result use restorable public envelopes with an explicit audit producer, without waking an AgentLoop', async () => {
  const events: any[] = [], flushes: number[] = []
  const session = { id: 'ses_TEST_ONLY', append: (type: string, data: any, options: any) => {
    assert.equal(type, 'user/message'); assert.deepEqual(options, { surfaceOp: 'append' })
    assert.equal(data.role, 'user'); assert.equal(data.source.kind, 'scholarflow-stage-audit')
    assert.equal(data.source.runId, 'run_TEST_ONLY'); assert.ok(data.id)
    events.push({ type, data, ...options })
  } }
  const ctx = { sessions: { flush: async () => { flushes.push(events.length); return true } }, llm: { async *stream() {
    assert.deepEqual(flushes, [1]); yield { type: 'text-delta', text: 'TEST_ONLY candidate' }; yield { type: 'finish', reason: { kind: 'stop' } }
  } } }
  assert.equal(await callStageModel(ctx, session, { provider: 'TEST_ONLY', model: 'TEST_ONLY' }, { system: 'TEST_ONLY system',
    instruction: 'TEST_ONLY instruction', context: { selectedEvidence: 'TEST_ONLY data' }, runId: 'run_TEST_ONLY', signal: new AbortController().signal }), 'TEST_ONLY candidate')
  assert.deepEqual(flushes, [1, 2]); assert.notEqual(events[0].data.id, events[1].data.id)
  const audits = events.map(event => JSON.parse(event.data.content[0].text))
  assert.deepEqual(audits.map(audit => audit.phase), ['request', 'result'])
  assert.equal(audits[0].payload.messages[0].content[0].text, 'TEST_ONLY system')
  assert.equal(JSON.parse(audits[0].payload.messages[1].content[0].text).researchData.selectedEvidence, 'TEST_ONLY data')
  assert.equal(audits[1].payload.text, 'TEST_ONLY candidate')
})

test('unconfirmed audit persistence refuses provider dispatch or candidate publication', async () => {
  let calls = 0, flushes = 0
  const session = { id: 'ses_TEST_ONLY', append: () => undefined }, call = { system: 'TEST_ONLY', instruction: 'TEST_ONLY', context: {},
    runId: 'run_TEST_ONLY', signal: new AbortController().signal }
  const ctx = { sessions: { flush: async () => ++flushes > 1 }, llm: { async *stream() { calls++; yield { type: 'text-delta', text: 'TEST_ONLY' }; yield { type: 'finish', reason: { kind: 'stop' } } } } }
  await assert.rejects(callStageModel(ctx, session, { provider: 'TEST_ONLY', model: 'TEST_ONLY' }, call), { code: 'UNSUPPORTED_DSH_CAPABILITY' })
  assert.equal(calls, 0)
  ctx.sessions.flush = async () => ++flushes === 2
  await assert.rejects(callStageModel(ctx, session, { provider: 'TEST_ONLY', model: 'TEST_ONLY' }, call), { code: 'UNSUPPORTED_DSH_CAPABILITY' })
  assert.equal(calls, 1)
})
