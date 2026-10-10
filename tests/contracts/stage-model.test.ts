import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callStageModel, selectedModel } from '../../src/host/executor/model.ts'

test('streamed and thrown provider errors retain safe diagnostics and report rate limits without an HTTP status', async () => {
  for (const thrown of [false, true]) {
    const logs: any[] = []
    const session = { id: 's_test', append: (_: string, data: any) => logs.push(JSON.parse(data.content[0].text)) }
    const failure = { code: 'RATE_LIMIT', message: 'SECRET_KEY_AND_PRIVATE_PROMPT', providerRetryAfterMs: 5000 }
    const ctx = { sessions: { flush: async () => true }, llm: { async *stream() {
      if (thrown) throw Object.assign(new Error('PRIVATE_PROMPT'), { failure })
      yield { type: 'finish', reason: { kind: 'error', failure } }
    } } }
    await assert.rejects(callStageModel(ctx, session, { provider: 'TEST_ONLY', model: 'TEST_ONLY' },
      { system: 'test', instruction: 'test', context: {}, runId: 'run_test', signal: new AbortController().signal }),
    (error: any) => error.code === 'RATE_LIMIT' && /频率或并发/.test(error.message) && error.details.providerRetryAfterMs === 5000)
    const result = logs.find(row => row.phase === 'result')
    assert.equal(result.payload.failure.code, 'RATE_LIMIT')
    assert.equal(JSON.stringify(logs).includes('PRIVATE_PROMPT'), false)
    assert.equal(JSON.stringify(logs).includes('SECRET_KEY'), false)
  }
})

test('each operation follows the current Host selection and keeps a frozen request without a plugin default', async () => {
  let projection: any = { pending: { provider: 'TEST_ONLY-current', model: 'model-A', reasoningEffort: 'high' }, lastUsed: { provider: 'TEST_ONLY-old', model: 'old' } }
  const session = { id: 'session_TEST_ONLY' }, seen: string[] = []
  const ctx = { sessionController: { resolveAgent: async () => ({ agent: { session } }) },
    sessionProjections: { stateOf: () => projection }, agentDefaultModel: { currentSelection: () => ({ provider: 'TEST_ONLY-default', model: 'default' }) },
    llm: { resolveModelInfo: async (provider: string, model: string) => { seen.push(`${provider}/${model}`); return { context: { contextWindow: 100000 }, inputModalities: ['text'] } } } }
  const first = await selectedModel(ctx, session.id, new AbortController().signal)
  projection.pending.model = 'model-B'
  const next = await selectedModel(ctx, session.id, new AbortController().signal)
  assert.equal(first.selected.model, 'model-A'); assert.equal(next.selected.model, 'model-B')
  assert.deepEqual(seen, ['TEST_ONLY-current/model-A', 'TEST_ONLY-current/model-B'])
  projection = { lastUsed: { provider: 'TEST_ONLY-old', model: 'old' } }
  assert.equal((await selectedModel(ctx, session.id, new AbortController().signal)).selected.model, 'old')
})

test('stage adapter retains only validated retry facts and does not retry or expose provider failure bodies', async () => {
  let calls = 0, flushed = false
  const session = { id: 'ses_TEST_ONLY', append: () => undefined }, ctx = { sessions: { flush: async () => { flushed = true; return true } },
    llm: { async *stream() { assert.equal(flushed, true); calls++; yield { type: 'finish', reason: { kind: 'error', failure: {
      code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 12000, message: 'TEST_ONLY private provider failure', requestId: 'TEST_ONLY_PRIVATE',
      headers: { authorization: 'TEST_ONLY_SECRET' } } } } } } }
  await assert.rejects(callStageModel(ctx, session, { provider: 'TEST_ONLY', model: 'TEST_ONLY' }, { system: 'TEST_ONLY', instruction: 'TEST_ONLY',
    context: {}, runId: 'run_TEST_ONLY', signal: new AbortController().signal }), error => {
    assert.equal((error as any).code, 'RATE_LIMIT')
    assert.deepEqual((error as any).details, { status: 429, providerRetryAfterMs: 12000, category: 'provider/transport', operation: 'model.request',
      phase: 'provider-stream', runId: 'run_TEST_ONLY', provider: 'TEST_ONLY', model: 'TEST_ONLY' })
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
