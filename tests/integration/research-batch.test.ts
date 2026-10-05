// TEST_ONLY: provider fixtures and simulated abrupt process loss; no live papers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { prepareResearchBatch, executeResearchBatch, prepareResearchBatchAction, readResearchBatch, closeResearchBatch } from '../../src/core/research/batch.ts'
import { candidateSchema, type ResearchProvider } from '../../src/shared/online-research.ts'
import { decideCandidate, readSearch } from '../../src/core/research/online.ts'
import { ScholarError } from '../../src/shared/errors.ts'
import { ACTIVE_RUN } from '../../src/core/pipeline/run-store.ts'
import { json } from '../../src/core/store/files.ts'

const owner = { pid: 1234, bootInstance: 'TEST_ONLY' }
const searches = [1, 2, 3].map(n => ({ query: `TEST_ONLY query ${n}`, purpose: `TEST_ONLY purpose ${n}`, limit: 2 }))
const candidate = candidateSchema.parse({ candidateId: 'candidate_TEST_ONLY', provider: 'crossref', recordId: '10.5555/test_only',
  sourceUrl: 'https://api.crossref.org/works/10.5555%2Ftest_only', retrievedAt: '2026-10-05T01:00:00.000Z', title: 'TEST_ONLY provider fixture',
  authors: [], year: 2024, identifiers: { doi: '10.5555/test_only', url: 'https://doi.org/10.5555/test_only' }, kind: 'paper', textAccess: 'metadata', warnings: [] })
const provider: ResearchProvider = { id: 'crossref', capabilities: { search: true, lookupIdentifier: false, fullText: false },
  async search() { return { records: [candidate], warnings: ['TEST_ONLY metadata only'] } }, async lookup() { return null } }
async function setup(count = 3) {
  const io = new MemoryStore({ '原资料.txt': 'TEST_ONLY untouched raw\r\n' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 多查询', type: 'literature-review' }))
  const current = await snapshot(io), request = { context: { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'ses_TEST_ONLY', projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision }, searches: searches.slice(0, count) }
  return { io, current, request, plan: await prepareResearchBatch(io, request) }
}
test('SF-009/027: multi-query preview writes nothing, reserves bounded scopes, and preserves successful metadata when another query fails', async () => {
  const { io, current, plan, request } = await setup(), writes = io.writes
  await prepareResearchBatch(io, request); assert.equal(io.writes, writes)
  await assert.rejects(prepareResearchBatch(io, { ...request, searches: Array.from({ length: 5 }, () => ({ ...searches[0], limit: 20 })) }), { code: 'RESEARCH_BUDGET_EXHAUSTED' })
  let calls = 0
  const result = await executeResearchBatch(io, plan, { ...provider, async search(input) {
    calls++; const data = await readResearchBatch(io, plan.snapshot.runId)
    assert.equal(data.checkpoint.queriesUsed, calls); assert.equal(data.checkpoint.queries[calls - 1].state, 'running')
    assert.equal(await io.lock(async () => true), true, 'no writer lock during provider IO')
    if (input.query === searches[1].query) throw new ScholarError('RESEARCH_ACCESS_DENIED', 'TEST_ONLY denied', { status: 403 })
    return { records: [candidate], warnings: [] }
  } }, new AbortController().signal, owner, () => true)
  assert.equal(calls, 3); assert.equal(result.run.status, 'completed-with-issues'); assert.equal(result.run.usedModelCalls, 0)
  assert.deepEqual(result.checkpoint.queries.map(row => row.state), ['completed', 'failed', 'completed'])
  assert.equal(result.checkpoint.candidatesReceived, 2)
  assert.equal((await snapshot(io)).document.text, current.document.text); assert.deepEqual((await snapshot(io)).ledger.sources, {})
  const [first, , third] = result.checkpoint.queries.map(row => row.attempts[0].searchId)
  const source = await decideCandidate(io, first, candidate.candidateId, 'include', 'TEST_ONLY first', 0)
  const duplicate = await decideCandidate(io, third, candidate.candidateId, 'include', 'TEST_ONLY same DOI', source.revision)
  assert.deepEqual(duplicate.source, source.source); assert.equal(Object.keys((await snapshot(io)).ledger.sources).length, 1)
  await readResearchBatch(io, plan.snapshot.runId) // User decisions do not mutate provider outcome hashes.
  assert.equal((await io.read('原资料.txt'))!.text, 'TEST_ONLY untouched raw\r\n')
})
test('a paused batch resumes in a new session without re-sending completed requests or resetting used budgets', async () => {
  const { io, plan } = await setup(), controller = new AbortController(); let pause = false, calls = 0
  const fixture = { ...provider, async search() { calls++; pause = true; return { records: [candidate], warnings: [] } } }
  const first = await executeResearchBatch(io, plan, fixture, controller.signal, owner, () => true, { pauseRequested: () => pause })
  assert.equal(first.run.status, 'paused'); assert.equal(calls, 1)
  const action = await prepareResearchBatchAction(io, first.run.runId, 'resume', () => true)
  pause = false
  const resumed = await executeResearchBatch(io, plan, provider, new AbortController().signal, { ...owner, bootInstance: 'TEST_ONLY second' }, () => true,
    { pauseRequested: () => false, action, executionSessionId: 'ses_TEST_ONLY_second' })
  assert.equal(resumed.run.status, 'completed-with-issues'); assert.equal(resumed.checkpoint.queriesUsed, 3)
  assert.equal(resumed.run.executionSessionId, 'ses_TEST_ONLY_second'); assert.equal(resumed.checkpoint.queries[0].attempts.length, 1)
})
test('AT-23: abrupt loss charges an unanswered request; explicit recovery archives it and reuses earlier successful searches', async () => {
  const { io, plan } = await setup(), originalWrite = io.write.bind(io); let failWrites = false, calls = 0
  io.write = async (...args) => { if (failWrites) throw new Error('TEST_ONLY process died'); return originalWrite(...args) }
  await assert.rejects(executeResearchBatch(io, plan, { ...provider, async search() {
    if (++calls === 2) { failWrites = true; throw new Error('TEST_ONLY process died') }
    return { records: [candidate], warnings: [] }
  } }, new AbortController().signal, owner, () => true))
  failWrites = false
  assert.equal((await readResearchBatch(io, plan.snapshot.runId)).checkpoint.queriesUsed, 2)
  await assert.rejects(prepareResearchBatchAction(io, plan.snapshot.runId, 'resume', () => true), { code: 'RUN_OWNER_ALIVE' })
  const action = await prepareResearchBatchAction(io, plan.snapshot.runId, 'resume', () => false)
  const resumed = await executeResearchBatch(io, plan, provider, new AbortController().signal, { ...owner, pid: 1235 }, () => false,
    { pauseRequested: () => false, action })
  assert.equal(resumed.checkpoint.queriesUsed, 4); assert.equal(resumed.checkpoint.queries[0].attempts.length, 1)
  assert.deepEqual(resumed.checkpoint.queries[1].attempts.map(row => row.state), ['interrupted', 'completed'])
  const original = await readSearch(io, resumed.checkpoint.queries[1].attempts[0].searchId)
  assert.equal(original.record.state, 'interrupted'); assert.equal(original.record.records.length, 0)
})
test('cancellation aborts the current request and retains completed results; retries are new linked runs with old terminal state intact', async () => {
  const { io, plan } = await setup(), controller = new AbortController(); let calls = 0
  const cancelled = await executeResearchBatch(io, plan, { ...provider, async search(_input, signal) {
    calls++; if (calls === 2) { controller.abort('user-cancel'); assert.equal(signal.aborted, true) }
    return { records: [candidate], warnings: [] }
  } }, controller.signal, owner, () => true)
  assert.equal(cancelled.run.status, 'cancelled'); assert.equal(cancelled.checkpoint.queriesUsed, 2)
  assert.equal(cancelled.checkpoint.queries[0].state, 'completed'); assert.equal(cancelled.checkpoint.queries[1].attempts[0].state, 'cancelled')
  const action = await prepareResearchBatchAction(io, plan.snapshot.runId, 'retry', () => true, 'ses_TEST_ONLY_retry')
  const retried = await executeResearchBatch(io, action.retryPlan!, provider, new AbortController().signal, owner, () => true, { pauseRequested: () => false, action })
  assert.equal(retried.run.parentRunId, plan.snapshot.runId); assert.equal(retried.run.sessionId, 'ses_TEST_ONLY_retry')
  assert.equal((await readResearchBatch(io, plan.snapshot.runId)).stored.run.status, 'cancelled')
})
test('temporary failures retry at most twice with durable request accounting and a preserved provider wait window', async () => {
  const { io, plan } = await setup(1); let calls = 0, pause = false, lastFailure = 0
  const fixture = { ...provider, async search() { calls++; lastFailure = Date.now(); pause = true; throw new ScholarError('RATE_LIMIT', 'TEST_ONLY', { status: 429, providerRetryAfterMs: 650 }) } }
  const first = await executeResearchBatch(io, plan, fixture, new AbortController().signal, owner, () => true, { pauseRequested: () => pause })
  assert.equal(first.run.status, 'paused'); assert.ok(first.checkpoint.queries[0].retryNotBefore! >= lastFailure + 650)
  const action = await prepareResearchBatchAction(io, plan.snapshot.runId, 'resume', () => true)
  const resumed = await executeResearchBatch(io, plan, { ...provider, async search() {
    assert.ok(Date.now() >= first.checkpoint.queries[0].retryNotBefore!); calls++
    throw new ScholarError('RESEARCH_PROVIDER_FAILED', 'TEST_ONLY 503', { status: 503 })
  } }, new AbortController().signal, owner, () => true, { pauseRequested: () => false, action })
  assert.equal(resumed.run.status, 'failed'); assert.equal(calls, 3); assert.equal(resumed.checkpoint.queriesUsed, 3)
  assert.equal(resumed.checkpoint.queries[0].transientRetries, 2)
})
test('429 without an exposed retry window pauses all dispatch without guessing an automatic delay', async () => {
  const { io, plan } = await setup(); let calls = 0
  const paused = await executeResearchBatch(io, plan, { ...provider, async search() {
    calls++; throw new ScholarError('RESEARCH_RATE_LIMITED', 'TEST_ONLY Host has no headers', { status: 429, retryWindowUnavailable: true })
  } }, new AbortController().signal, owner, () => true)
  assert.equal(calls, 1); assert.equal(paused.run.status, 'paused'); assert.equal(paused.run.errorCode, 'RESEARCH_RETRY_WINDOW_UNAVAILABLE')
  assert.equal(paused.checkpoint.queries[1].attempts.length, 0)
  const action = await prepareResearchBatchAction(io, plan.snapshot.runId, 'close', () => true)
  assert.equal((await closeResearchBatch(io, action, () => true)).run.status, 'cancelled')
})
test('one project run lock prevents concurrent batches and preserves externally edited active state', async () => {
  const { io, plan, request } = await setup(1), second = await prepareResearchBatch(io, request)
  let finish!: () => void
  const first = executeResearchBatch(io, plan, { ...provider, search: () => new Promise(resolve => { finish = () => resolve({ records: [], warnings: [] }) }) }, new AbortController().signal, owner, () => true)
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1))
  await assert.rejects(executeResearchBatch(io, second, provider, new AbortController().signal, owner, () => true), { code: 'RUN_IN_PROGRESS' })
  io.externalEdit(ACTIVE_RUN, json({ TEST_ONLY_external: true })); finish()
  await assert.rejects(first, { code: 'RUN_STATE_CHANGED' }); assert.deepEqual(JSON.parse((await io.read(ACTIVE_RUN))!.text), { TEST_ONLY_external: true })
})
test('resume approvals reject changed configuration, outcomes, checkpoints, or forged plans before any provider IO', async () => {
  const { io, plan } = await setup(1)
  const first = await executeResearchBatch(io, plan, provider, new AbortController().signal, owner, () => true, { pauseRequested: () => true })
  assert.equal(first.run.status, 'paused')
  const action = await prepareResearchBatchAction(io, plan.snapshot.runId, 'resume', () => true)
  await assert.rejects(executeResearchBatch(io, { ...plan, searches: [{ ...plan.searches[0], search: { ...searches[0], query: 'TEST_ONLY altered' } }] }, provider,
    new AbortController().signal, owner, () => true, { pauseRequested: () => false, action }), { code: 'RUN_CHECKPOINT_CHANGED' })
  const config = (await io.read('.scholarflow/project.yaml'))!.text; io.externalEdit('.scholarflow/project.yaml', config + '\n# TEST_ONLY changed\n')
  await assert.rejects(executeResearchBatch(io, plan, provider, new AbortController().signal, owner, () => true, { pauseRequested: () => false, action }), { code: 'RUN_STATE_CHANGED' })
})
