// TEST_ONLY provider/model functions; these tests do not claim online results.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, stringify } from 'yaml'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { projectMarkdown } from '../../src/core/editing/markdown.ts'
import { prepareWorkflow, startWorkflow, readWorkflow, prepareWorkflowAction, applyWorkflowAction } from '../../src/core/pipeline/workflow.ts'
import { workflowBudgetInfo, workflowCall, reserveWorkflowCall, syncWorkflowDuration } from '../../src/core/pipeline/workflow-budget.ts'
import { prepareGeneration, executeGeneration } from '../../src/core/pipeline/generation.ts'
import { prepareModelReview } from '../../src/core/review/model.ts'
import { executeModelReview } from '../../src/core/review/model-run.ts'
import { prepareSearch, executeSearch, prepareLookup, executeLookup } from '../../src/core/research/online.ts'
import { prepareResearchBatch, executeResearchBatch } from '../../src/core/research/batch.ts'
import { registerSource } from '../../src/core/evidence/evidence.ts'
import { recover } from '../../src/core/store/transactions.ts'
import type { ResearchProvider } from '../../src/shared/online-research.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { workflowAssociation } from '../../src/core/pipeline/workflow-budget.ts'
const owner = { pid: 12345, bootInstance: 'TEST_ONLY-budget-owner' }, signal = () => new AbortController().signal
const goal = { researchQuestion: 'TEST_ONLY 累计预算如何保留？', minimumSources: 1, minimumLocatedEvidence: 1,
  noFormalRequirementsReason: 'TEST_ONLY 当前功能测试没有正式课程要求，不宣称已具备证据。' }
const plain = 'TEST_ONLY 一个可独立改写的限定段落。'
async function setup(overrides: Record<string, number> = {}, reviewRounds = 2, store = new MemoryStore({ 'raw.txt': 'TEST_ONLY unchanged raw' })) {
  const io = store
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY aggregate budget', type: 'course-paper' }))
  await saveManual(io, plain, (await snapshot(io)).document.contentHash, 0)
  const path = '.scholarflow/project.yaml', config = parse((await io.read(path))!.text)
  config.workflow.budget = { ...config.workflow.budget, ...overrides }; config.workflow.maxReviewRounds = reviewRounds
  io.externalEdit(path, stringify(config))
  const workflowId = (await startWorkflow(io, await prepareWorkflow(io, goal, 'session_TEST_ONLY'))).workflowId
  return { io, workflowId }
}
async function context(io: MemoryStore) { const current = await snapshot(io); return { requestId: 'req_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY',
  sessionId: 'session_TEST_ONLY', projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision } }
async function writing(io: MemoryStore) {
  const current = await snapshot(io), block = projectMarkdown(current.document.text).blocks[0]
  return prepareGeneration(io, { context: await context(io), instruction: 'TEST_ONLY 保留限定，只改表达',
    selection: { projectId: current.ledger.projectId, documentId: 'paper', documentHash: current.document.contentHash, revisionId: current.document.revisionId,
      blockIds: [block.id], sourceRange: { startUtf16: block.start, endUtf16: block.end }, sourceText: plain, renderedText: plain, prefixContext: '', suffixContext: '',
      citationKeys: [], claimIds: [], scope: 'paragraph', capturedAt: new Date().toISOString() } }, { providerId: 'TEST_ONLY-provider', modelId: 'TEST_ONLY-model' })
}
const candidate = { candidateId: 'candidate_TEST_ONLY', provider: 'crossref' as const, recordId: '10.1000/test-only', sourceUrl: 'https://api.crossref.org/works/10.1000/test-only',
  retrievedAt: new Date().toISOString(), title: 'TEST_ONLY fake metadata', authors: [], identifiers: { doi: '10.1000/test-only', url: 'https://doi.org/10.1000/test-only' },
  textAccess: 'metadata' as const, kind: 'paper' as const, warnings: ['TEST_ONLY never claim real publication'] }
test('real writing and model-review executors share charged calls; format repair spends the original budget without modifying the manuscript', async () => {
  const { io, workflowId } = await setup({ maxModelCalls: 2 }), plan = await writing(io)
  assert.equal(plan.snapshot.workflowId, workflowId)
  let calls = 0
  const result = await executeGeneration(io, plan, owner, signal(), async request => {
    assert.equal(request.maxTokens, plan.snapshot.modelDescriptor.maxOutputTokens)
    const budget = await workflowBudgetInfo(io); assert.equal(budget!.used!.modelCalls, ++calls)
    assert.equal(budget!.pendingCalls.length, 1, 'reservation is durable before the external request')
    return calls === 1 ? 'TEST_ONLY invalid JSON' : JSON.stringify({ replacementText: 'TEST_ONLY 改善表达，限定不变。', limitations: ['TEST_ONLY 仍需核对语义'] })
  }, () => true)
  assert.equal(result.run.usedModelCalls, 2); assert.equal(calls, 2)
  const review = await prepareModelReview(io, { context: await context(io) }, { providerId: 'TEST_ONLY-provider', modelId: 'TEST_ONLY-model' })
  await assert.rejects(executeModelReview(io, review, owner, signal(), async () => { calls++; return '' }, () => true, { pauseRequested: () => false }), { code: 'WORKFLOW_BUDGET_EXHAUSTED' })
  assert.equal(calls, 2); assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 2)
  assert.equal((await snapshot(io)).document.text, plain); assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY unchanged raw')
})
test('single search, multi-query batch and DOI verification share query and candidate budgets; a blocked lookup preserves identity', async () => {
  const { io } = await setup({ maxSearchQueries: 3, maxCandidateSources: 4 })
  let queries = 0, lookups = 0
  const provider: ResearchProvider = { id: 'crossref', capabilities: { search: true, lookupIdentifier: true, fullText: false },
    async search() { queries++; return { records: [candidate], warnings: ['TEST_ONLY'] } }, async lookup() { lookups++; return candidate } }
  await executeSearch(io, await prepareSearch(io, { query: 'TEST_ONLY first', purpose: 'TEST_ONLY', limit: 2 }), provider, signal(), owner)
  const batch = await prepareResearchBatch(io, { context: await context(io), searches: [1, 2].map(n => ({ query: `TEST_ONLY batch ${n}`, purpose: 'TEST_ONLY', limit: 1 })) })
  const result = await executeResearchBatch(io, batch, provider, signal(), owner, () => true)
  assert.equal(result.run.status, 'completed-with-issues'); assert.equal(queries, 3)
  const source = await registerSource(io, { title: candidate.title, kind: 'paper', authors: [], identifiers: candidate.identifiers }, (await snapshot(io)).ledger.revision)
  const before = (await snapshot(io)).ledger.sources[source.source.id]
  const lookup = await executeLookup(io, await prepareLookup(io, source.source.id), provider, signal(), owner)
  assert.equal(lookup.errorCode, 'WORKFLOW_BUDGET_EXHAUSTED'); assert.equal(lookups, 0)
  assert.deepEqual((await snapshot(io)).ledger.sources[source.source.id], before)
  const used = (await workflowBudgetInfo(io))!.used!
  assert.equal(used.searchQueries, 3); assert.equal(used.candidates, 3); assert.equal(used.modelCalls, 0)
})
test('review retries in the same run do not create new rounds; the next review round is bounded independently of writing', async () => {
  const { io, workflowId } = await setup({ maxModelCalls: 4 }, 1)
  let calls = 0
  for (const number of [1, 2]) await workflowCall(io, workflowId, { callId: `call_TEST_ONLY_review_${number}`, runId: 'run_TEST_ONLY_review',
    stage: 'review', kind: 'model', owner }, signal(), async () => ++calls)
  await assert.rejects(workflowCall(io, workflowId, { callId: 'call_TEST_ONLY_review_3', runId: 'run_TEST_ONLY_next_review', stage: 'review', kind: 'model', owner },
    signal(), async () => ++calls), { code: 'WORKFLOW_REVIEW_LIMIT' })
  await workflowCall(io, workflowId, { callId: 'call_TEST_ONLY_writing', runId: 'run_TEST_ONLY_writing', stage: 'revision', kind: 'model', owner }, signal(), async () => ++calls)
  assert.equal(calls, 3); assert.equal((await workflowBudgetInfo(io))!.used!.reviewRounds, 1)
})
test('unknown response survives cold restart; live ownership blocks closure and dead ownership preserves charged request and unknown candidate cap', async () => {
  const { io, workflowId } = await setup({ maxSearchQueries: 2, maxCandidateSources: 4 })
  const request = { callId: 'call_TEST_ONLY_unknown', runId: 'search_TEST_ONLY', stage: 'research' as const, kind: 'search' as const, candidateLimit: 2, owner }
  await reserveWorkflowCall(io, workflowId, request)
  const cold = new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text])))
  assert.equal((await workflowBudgetInfo(cold))!.used!.searchQueries, 1); assert.equal((await workflowBudgetInfo(cold))!.used!.candidates, 2)
  await assert.rejects(reserveWorkflowCall(cold, workflowId, request), { code: 'WORKFLOW_CALL_ALREADY_CHARGED' })
  await assert.rejects(reserveWorkflowCall(cold, workflowId, { ...request, callId: 'call_TEST_ONLY_second' }), { code: 'WORKFLOW_CALL_PENDING' })
  const action = { context: await context(cold), workflowId, action: 'close-unknown-call' as const, callId: request.callId, reason: 'TEST_ONLY 进程已退出，无完整响应，保留未知请求和候选额度。' }
  await assert.rejects(prepareWorkflowAction(cold, action, () => true), { code: 'WORKFLOW_CALL_OWNER_ALIVE' })
  const plan = await prepareWorkflowAction(cold, action, () => false)
  await assert.rejects(applyWorkflowAction(cold, plan, () => true), { code: 'WORKFLOW_CALL_OWNER_ALIVE' })
  await applyWorkflowAction(cold, plan, () => false)
  const budget = await workflowBudgetInfo(cold)
  assert.equal(budget!.pendingCalls.length, 0); assert.equal(budget!.used!.searchQueries, 1); assert.equal(budget!.used!.candidates, 2)
  assert.equal((await readWorkflow(cold, workflowId)).checkpoint.budget!.calls[0].state, 'interrupted')
  let calls = 0
  await assert.rejects(workflowCall(cold, workflowId, { ...request, callId: 'call_TEST_ONLY_new', candidateLimit: 3 }, signal(), async () => ++calls), { code: 'WORKFLOW_BUDGET_EXHAUSTED' })
  assert.equal(calls, 0)
})
test('total child duration is not charged twice and exhausted aggregate time stops dispatch across stages', async () => {
  const { io, workflowId } = await setup({ maxDurationMinutes: 1 })
  await workflowCall(io, workflowId, { callId: 'call_TEST_ONLY_duration', runId: 'run_TEST_ONLY_duration', stage: 'drafting', kind: 'model', owner }, signal(), async () => 'TEST_ONLY')
  await syncWorkflowDuration(io, workflowId, 'run_TEST_ONLY_duration', 60000)
  await syncWorkflowDuration(io, workflowId, 'run_TEST_ONLY_duration', 60000)
  assert.equal((await workflowBudgetInfo(io))!.used!.durationMs, 60000)
  let called = false
  await assert.rejects(workflowCall(io, workflowId, { callId: 'call_TEST_ONLY_after_time', runId: 'run_TEST_ONLY_review', stage: 'review', kind: 'model', owner },
    signal(), async () => { called = true }), { code: 'WORKFLOW_BUDGET_EXHAUSTED' })
  assert.equal(called, false)
})
test('old unbound query plans cannot bypass a newly confirmed guided task and pause does not refresh its budget', async () => {
  const { io, workflowId } = await setup()
  const pause = await prepareWorkflowAction(io, { context: await context(io), workflowId, action: 'pause', reason: '' })
  await applyWorkflowAction(io, pause)
  await assert.rejects(prepareSearch(io, { query: 'TEST_ONLY paused', purpose: 'TEST_ONLY', limit: 1 }), { code: 'WORKFLOW_PAUSED' })
  await applyWorkflowAction(io, await prepareWorkflowAction(io, { context: await context(io), workflowId, action: 'resume', reason: '' }))
  let calls = 0
  await assert.rejects(workflowCall(io, undefined, { callId: 'call_TEST_ONLY_unbound', runId: 'search_TEST_ONLY_unbound', stage: 'research', kind: 'search', candidateLimit: 1, owner },
    signal(), async () => ++calls), { code: 'WORKFLOW_BINDING_CHANGED' })
  assert.equal(calls, 0); assert.equal((await workflowBudgetInfo(io))!.used!.searchQueries, 0)
})
test('reservation publication failure prevents paid dispatch and transaction recovery retains an uncertain charged call', async () => {
  class FaultStore extends MemoryStore {
    fail?: string
    override async write(path: string, text: string, expected: any) {
      if (path === this.fail) { this.fail = undefined; throw new Error('TEST_ONLY crash during budget publication') }
      return super.write(path, text, expected)
    }
  }
  const { io: base, workflowId } = await setup({}, 2, new FaultStore()), io = base as FaultStore
  io.fail = `.scholarflow/runs/${workflowId}/run.json`
  let calls = 0
  const request = { callId: 'call_TEST_ONLY_journal', runId: 'run_TEST_ONLY_journal', stage: 'drafting' as const, kind: 'model' as const, owner }
  await assert.rejects(workflowCall(io, workflowId, request, signal(), async () => ++calls), /TEST_ONLY crash/)
  assert.equal(calls, 0)
  await io.lock(() => recover(io, 'manuscript'))
  assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 1)
  await assert.rejects(reserveWorkflowCall(io, workflowId, request), { code: 'WORKFLOW_CALL_ALREADY_CHARGED' })
})
test('explicit material selection preserves the original overall quota; budget and permission policy changes stop new dispatch', async () => {
  const { io, workflowId } = await setup({ maxModelCalls: 2 })
  await workflowCall(io, workflowId, { callId: 'call_TEST_ONLY_before_material', runId: 'run_TEST_ONLY_before_material', stage: 'drafting', kind: 'model', owner }, signal(), async () => 'TEST_ONLY')
  const oldConfigHash = (await snapshot(io)).configHash
  await registerMaterial(io, { relativePath: 'raw.txt', role: 'notes', confirmExcludedFile: false }, (await snapshot(io)).ledger.revision)
  assert.notEqual((await snapshot(io)).configHash, oldConfigHash)
  assert.equal(await workflowAssociation(io), workflowId); assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 1)
  const path = '.scholarflow/project.yaml', config = parse((await io.read(path))!.text)
  config.workflow.budget.maxModelCalls = 1; io.externalEdit(path, stringify(config))
  await assert.rejects(workflowAssociation(io), { code: 'WORKFLOW_INPUT_CHANGED' })
  assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 1); assert.equal((await workflowBudgetInfo(io))!.limits!.maxModelCalls, 2)
})
