// TEST_ONLY local scheduler; no paid model, actual research or fabricated result.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { prepareWorkflow, startWorkflow, readWorkflow, prepareWorkflowAction, applyWorkflowAction } from '../../src/core/pipeline/workflow.ts'
import { prepareAutomatic, startAutomatic, driveAutomatic, readAutomatic, inspectAutomatic, prepareAutomaticAction, applyAutomaticAction } from '../../src/core/pipeline/workflow-automatic.ts'
import { automaticPolicySchema } from '../../src/shared/workflow-automatic.ts'
import { readDelivery } from '../../src/core/export/delivery.ts'
import { workflowBudgetInfo } from '../../src/core/pipeline/workflow-budget.ts'
import { runReview } from '../../src/core/review/review.ts'
import { prepareGeneration, executeGeneration } from '../../src/core/pipeline/generation.ts'
import { prepareModelReview } from '../../src/core/review/model.ts'
import { executeModelReview } from '../../src/core/review/model-run.ts'
import { projectMarkdown, validateRange } from '../../src/core/editing/markdown.ts'
import { reserveWorkflowCall } from '../../src/core/pipeline/workflow-budget.ts'
import { recover } from '../../src/core/store/transactions.ts'

const sessionId = 'session_TEST_ONLY_automatic', owner = { pid: 1, bootInstance: 'TEST_ONLY_local_controller' }
const goal = { researchQuestion: 'TEST_ONLY 怎样明确保留缺失实验？', minimumSources: 1, minimumLocatedEvidence: 1,
  noFormalRequirementsReason: 'TEST_ONLY 本测试没有课程要求，仍需保留缺失实验与所有未知项。' }
const policy = automaticPolicySchema.parse({ ruleReview: true, workingDraftDelivery: true,
  insufficientResearchReason: 'TEST_ONLY 没有定位证据，明确保留不足，不把结构草稿当真实研究。',
  stopRevisionReason: 'TEST_ONLY 原问题全部保留，实验未做，只交付带待补与未知的工作草稿。' })
async function setup(body = true) {
  const io = new MemoryStore({ 'unselected.txt': 'TEST_ONLY raw unchanged' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY finite controller', type: 'research-paper' }))
  const initial = await snapshot(io)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: goal.researchQuestion, thesis: 'TEST_ONLY 不编造实验', confirmation: 'confirmed',
    sections: [{ id: 'section_TEST_ONLY', title: '真实结果待补', purpose: '保留未知', claimIds: [], missingEvidence: ['TEST_ONLY 缺实验'] }] }, initial.ledger.revision, 0)
  if (body) { const current = await snapshot(io); await saveManual(io, '# TEST_ONLY\n\n## 真实结果待补\n\n[待补：真实实验与记录；TEST_ONLY 尚未完成。]\n', current.document.contentHash, current.ledger.revision) }
  const { workflowId } = await startWorkflow(io, await prepareWorkflow(io, goal, sessionId))
  return { io, workflowId }
}
async function start(io: MemoryStore, workflowId: string, selected = policy) {
  return (await startAutomatic(io, await prepareAutomatic(io, workflowId, sessionId, selected), owner)).automaticId
}
const execute = (io: MemoryStore, workflowId: string, automaticId: string, workers = {}) => driveAutomatic(io, workflowId, automaticId, new AbortController().signal, { pauseRequested: () => false }, workers)

test('SF-027: local automatic progression records seven real gates and a same-version working delivery, preserving missing results, original body and raw materials with zero paid calls', async () => {
  const { io, workflowId } = await setup(), body = (await snapshot(io)).document.text, before = io.writes
  const plan = await prepareAutomatic(io, workflowId, sessionId, policy)
  assert.equal(io.writes, before); assert.equal((await inspectAutomatic(io, workflowId)).automatic, undefined)
  const automaticId = (await startAutomatic(io, plan, owner)).automaticId, result = await execute(io, workflowId, automaticId)
  assert.equal(result.status, 'completed-with-issues'); assert.ok(result.steps.every(row => row.state === 'settled'))
  const root = await readWorkflow(io, workflowId)
  assert.equal(root.gates.length, 7); assert.ok(root.gates.every(row => row.current)); assert.equal(root.checkpoint.status, 'completed-with-issues')
  assert.equal(root.checkpoint.stamps.find(row => row.stage === 'research')!.outcome, 'insufficient')
  assert.equal(root.checkpoint.automaticBudget!.usedSteps, 10)
  assert.equal((await snapshot(io)).document.text, body); assert.equal((await io.read('unselected.txt'))!.text, 'TEST_ONLY raw unchanged')
  const ledger = (await snapshot(io)).ledger, manifest = Object.values(ledger.deliveries)[0], files = (await readDelivery(io, manifest.id)).files
  assert.equal(manifest.reviewState, 'draft-incomplete'); assert.ok(Object.values(ledger.reviewIssues).some(row => row.severity === 'B0' && row.state === 'open'))
  assert.match(files.find(row => row.relativePath === 'quality-report.md')!.text, /B0 · open/u)
  assert.equal(root.checkpoint.budget!.calls.length, 0); assert.equal(root.checkpoint.budget!.childDurationMs[automaticId]! >= 0, true)
})

test('automatic progression waits for real requirements, insufficient research permission and missing saved chapters rather than asserting completion', async () => {
  const { io, workflowId } = await setup(false), automaticId = await start(io, workflowId)
  const result = await execute(io, workflowId, automaticId)
  assert.equal(result.status, 'waiting-input'); assert.equal(result.code, 'AUTOMATIC_USER_INPUT_REQUIRED')
  assert.equal((await readWorkflow(io, workflowId)).gates.find(row => row.stage === 'drafting')!.current, false)
  assert.equal(Object.keys((await snapshot(io)).ledger.deliveries).length, 0)
  const separate = await setup(), limitedPolicy = automaticPolicySchema.parse({ ruleReview: true, workingDraftDelivery: true })
  const separateId = await start(separate.io, separate.workflowId, limitedPolicy), stopped = await execute(separate.io, separate.workflowId, separateId)
  assert.equal(stopped.code, 'RESEARCH_INSUFFICIENT'); assert.equal(stopped.steps.length, 1)
  assert.equal((await readWorkflow(separate.io, separate.workflowId)).gates[1].current, false)
})

test('unchanged executor outcomes stop at the original no-progress cap without consuming model quota or inventing a report', async () => {
  const { io, workflowId } = await setup(), automaticId = await start(io, workflowId)
  let calls = 0
  const result = await execute(io, workflowId, automaticId, { rulesReview: async () => { calls++ } })
  assert.equal(calls, 2); assert.equal(result.code, 'AUTOMATIC_NO_PROGRESS'); assert.equal(result.status, 'completed-with-issues')
  const root = await readWorkflow(io, workflowId)
  assert.equal(root.checkpoint.automaticBudget!.noProgress, 2); assert.equal(root.checkpoint.automaticBudget!.usedSteps, 6)
  assert.equal(root.gates.find(row => row.stage === 'review')!.canComplete, false); assert.equal(root.checkpoint.budget!.calls.length, 0)
  const again = await start(io, workflowId), second = await execute(io, workflowId, again, { rulesReview: async () => { calls++ } })
  assert.equal(second.code, 'AUTOMATIC_NO_PROGRESS'); assert.equal(calls, 2)
  await assert.rejects(start(io, workflowId, { ...policy, maxNoProgress: 3 }), { code: 'AUTOMATIC_LIMIT_CHANGED' })
})

test('step exhaustion retains completed artifacts and original totals across a new explicit attempt without renewing the overall quota', async () => {
  const { io, workflowId } = await setup(), automaticId = await start(io, workflowId, { ...policy, maxSteps: 7 })
  const result = await execute(io, workflowId, automaticId)
  assert.equal(result.code, 'WORKFLOW_BUDGET_EXHAUSTED'); assert.equal(result.status, 'completed-with-issues')
  assert.equal((await readWorkflow(io, workflowId)).checkpoint.automaticBudget!.usedSteps, 7)
  assert.equal(Object.keys((await snapshot(io)).ledger.deliveries).length, 0)
  await assert.rejects(start(io, workflowId, { ...policy, maxSteps: 7 }), { code: 'WORKFLOW_BUDGET_EXHAUSTED' })
  await assert.rejects(start(io, workflowId, policy), { code: 'AUTOMATIC_LIMIT_CHANGED' })
  assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 0)
})

test('pause before dispatch and stale approvals preserve original body, pending scope and all source bytes', async () => {
  const { io, workflowId } = await setup(), plan = await prepareAutomatic(io, workflowId, sessionId, policy), body = (await snapshot(io)).document.text
  io.externalEdit('.scholarflow/context/terminology.md', 'TEST_ONLY externally changed instructions')
  const before = [...io.files.entries()]
  await assert.rejects(startAutomatic(io, plan, owner), { code: 'WORKFLOW_INPUT_CHANGED' }); assert.deepEqual([...io.files.entries()], before)
  const automaticId = await start(io, workflowId), state = await driveAutomatic(io, workflowId, automaticId, new AbortController().signal, { pauseRequested: () => true })
  assert.equal(state.status, 'paused'); assert.equal(state.steps.length, 0); assert.equal((await snapshot(io)).document.text, body)
  await assert.rejects(execute(io, workflowId, automaticId), { code: 'AUTOMATIC_RESUME_REQUIRED' })
})

test('interruption after an actual rule review keeps pending step and changed facts, and cold observation never reruns the executor or erases its report', async () => {
  const { io, workflowId } = await setup(), automaticId = await start(io, workflowId), controller = new AbortController()
  let calls = 0
  await assert.rejects(driveAutomatic(io, workflowId, automaticId, controller.signal, { pauseRequested: () => false }, { rulesReview: async (store, revision) => {
    calls++; await runReview(store, revision); throw new Error('TEST_ONLY lost completion acknowledgement')
  } }))
  const saved = await readAutomatic(io, workflowId, automaticId)
  assert.equal(saved.state.status, 'failed'); assert.equal(saved.state.steps.at(-1)!.state, 'pending'); assert.equal(calls, 1)
  const cold = new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text]))), before = cold.writes
  const observed = await inspectAutomatic(cold, workflowId)
  assert.equal(observed.automatic!.state.steps.at(-1)!.state, 'pending'); assert.equal(cold.writes, before)
  await assert.rejects(execute(cold, workflowId, automaticId, { rulesReview: async () => { calls++ } }), { code: 'AUTOMATIC_RESUME_REQUIRED' })
  assert.equal(calls, 1); assert.equal((await readWorkflow(cold, workflowId)).gates.find(row => row.stage === 'review')!.canComplete, true)
})

test('explicit cold pause resume preserves immutable input and original quotas while attributing later decisions to the actual new execution Session', async () => {
  const { io, workflowId } = await setup(), automaticId = await start(io, workflowId)
  await driveAutomatic(io, workflowId, automaticId, new AbortController().signal, { pauseRequested: () => true })
  const cold = new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text])))
  const before = await readAutomatic(cold, workflowId, automaticId), writes = cold.writes
  const plan = await prepareAutomaticAction(cold, workflowId, automaticId, 'session_TEST_ONLY_new', 'resume', 'TEST_ONLY 已核对原范围，恢复且保留全部原额度。', () => true)
  assert.equal(cold.writes, writes)
  await applyAutomaticAction(cold, plan, { pid: 2, bootInstance: 'TEST_ONLY_new_owner' }, () => true)
  const queued = await readAutomatic(cold, workflowId, automaticId)
  assert.equal(queued.inputFile.text, before.inputFile.text); assert.equal(queued.state.executionSessionId, 'session_TEST_ONLY_new')
  const result = await execute(cold, workflowId, automaticId)
  assert.equal(result.status, 'completed-with-issues')
  const root = await readWorkflow(cold, workflowId)
  assert.ok(root.checkpoint.stamps.every(row => row.sessionId === 'session_TEST_ONLY_new'))
  assert.equal(root.checkpoint.automaticBudget!.usedSteps, 10); assert.equal(root.checkpoint.budget!.calls.length, 0)
})

test('a live owner blocks unknown-step takeover; explicit closure after proven exit archives the uncertainty without replay or quota refund', async () => {
  const { io, workflowId } = await setup(), automaticId = await start(io, workflowId)
  await assert.rejects(execute(io, workflowId, automaticId, { rulesReview: async () => { throw new Error('TEST_ONLY unavailable completion') } }))
  const saved = await readAutomatic(io, workflowId, automaticId), path = `.scholarflow/runs/${workflowId}/automatic/${automaticId}/run.json`
  // TEST_ONLY fault fixture represents process loss while the pending record is
  // still nonterminal; it does not pretend that a real process died.
  io.externalEdit(path, JSON.stringify({ ...saved.state, status: 'interrupted' }))
  const reason = 'TEST_ONLY 已核对真实产物，结束未知登记且保留已消耗额度。', before = [...io.files.entries()]
  await assert.rejects(prepareAutomaticAction(io, workflowId, automaticId, sessionId, 'close', reason, () => true), { code: 'RUN_OWNER_ALIVE' })
  await assert.rejects(prepareAutomaticAction(io, workflowId, automaticId, sessionId, 'resume', reason, () => false), { code: 'AUTOMATIC_PENDING_OPERATION' })
  assert.deepEqual([...io.files.entries()], before)
  const used = (await readWorkflow(io, workflowId)).checkpoint.automaticBudget!.usedSteps
  const plan = await prepareAutomaticAction(io, workflowId, automaticId, sessionId, 'close', reason, () => false)
  await applyAutomaticAction(io, plan, owner, () => false)
  const closed = await readAutomatic(io, workflowId, automaticId)
  assert.equal(closed.state.status, 'cancelled'); assert.equal(closed.state.steps.at(-1)!.state, 'interrupted')
  assert.equal((await readWorkflow(io, workflowId)).checkpoint.automaticBudget!.usedSteps, used)
  await assert.rejects(prepareAutomaticAction(io, workflowId, automaticId, sessionId, 'resume', reason, () => false), { code: 'AUTOMATIC_TERMINAL' })
})

test('cancellation after durable step registration stops before execution and retains the charged step and manuscript', async () => {
  const { io, workflowId } = await setup(), automaticId = await start(io, workflowId), controller = new AbortController(), originalWrite = io.write.bind(io)
  const body = (await snapshot(io)).document.text
  io.write = async (path, text, expected) => {
    const result = await originalWrite(path, text, expected)
    if (path === `.scholarflow/runs/${workflowId}/automatic/${automaticId}/run.json` && JSON.parse(text).steps.some((row: any) => row.state === 'pending')) controller.abort('operator-cancel')
    return result
  }
  let workers = 0
  await assert.rejects(driveAutomatic(io, workflowId, automaticId, controller.signal, { pauseRequested: () => false }, { rulesReview: async () => { workers++ } }))
  const saved = await readAutomatic(io, workflowId, automaticId)
  assert.equal(saved.state.status, 'cancelled'); assert.equal(saved.state.steps.length, 1); assert.equal(workers, 0)
  assert.equal((await readWorkflow(io, workflowId)).checkpoint.automaticBudget!.usedSteps, 1)
  assert.equal((await snapshot(io)).document.text, body)
})

test('AT-24: queued local scheduling blocks independent writer, model review and query reservation before any paid dispatch or stage publication', async () => {
  const { io, workflowId } = await setup(), current = await snapshot(io), projection = projectMarkdown(current.document.text), block = projection.blocks[0], range = validateRange(projection, block.start, block.end, 'paragraph')
  const context = { requestId: 'request_TEST_ONLY', projectId: current.ledger.projectId, workspaceId: 'workspace_TEST_ONLY', sessionId, expectedLedgerRevision: current.ledger.revision }
  const model = { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' }, selection = { projectId: current.ledger.projectId, documentId: 'paper', documentHash: current.document.contentHash,
    revisionId: current.document.revisionId, blockIds: [block.id], sourceRange: { startUtf16: block.start, endUtf16: block.end }, sourceText: current.document.text.slice(block.start, block.end),
    renderedText: range.renderedText, prefixContext: '', suffixContext: '', citationKeys: range.citationKeys, claimIds: [], scope: 'paragraph', capturedAt: new Date().toISOString() }
  const generation = await prepareGeneration(io, { context, instruction: 'TEST_ONLY 保留缺失实验标记，仅生成待审阅改写。', selection }, model)
  const review = await prepareModelReview(io, { context }, model)
  await start(io, workflowId)
  const before = [...io.files.entries()]; let calls = 0
  const provider = async () => { calls++; throw new Error('TEST_ONLY must not dispatch') }
  await assert.rejects(executeGeneration(io, generation, owner, new AbortController().signal, provider, () => false), { code: 'RUN_IN_PROGRESS' })
  await assert.rejects(executeModelReview(io, review, owner, new AbortController().signal, provider, () => false), { code: 'RUN_IN_PROGRESS' })
  await assert.rejects(reserveWorkflowCall(io, workflowId, { callId: 'call_TEST_ONLY', runId: 'run_TEST_ONLY', stage: 'research', kind: 'search', owner, candidateLimit: 1 }), { code: 'RUN_IN_PROGRESS' })
  assert.equal(calls, 0); assert.deepEqual([...io.files.entries()], before)
})

test('a dispatch registration interrupted between parent and state publication recovers one charged pending step and never guesses replay', async () => {
  const { io, workflowId } = await setup(), automaticId = await start(io, workflowId), originalWrite = io.write.bind(io)
  let fault = true
  io.write = async (path, text, expected) => {
    if (fault && path === `.scholarflow/runs/${workflowId}/automatic/${automaticId}/run.json` && JSON.parse(text).steps.some((row: any) => row.state === 'pending')) {
      fault = false; throw new Error('TEST_ONLY interrupted parent/child registration')
    }
    return originalWrite(path, text, expected)
  }
  let calls = 0
  await assert.rejects(execute(io, workflowId, automaticId, { rulesReview: async () => { calls++ } }))
  await io.lock(() => recover(io, 'manuscript'))
  const saved = await readAutomatic(io, workflowId, automaticId)
  assert.equal(saved.root.checkpoint.automaticBudget!.usedSteps, 1); assert.equal(saved.state.steps.at(-1)!.state, 'pending')
  assert.equal(calls, 0); assert.equal(saved.root.checkpoint.stamps.length, 0)
  await assert.rejects(execute(io, workflowId, automaticId), { code: 'AUTOMATIC_RESUME_REQUIRED' })
})

test('two concurrent dispatchers cannot claim the same queued plan or overwrite each other; old goal pointers cannot authorize new scheduling', async () => {
  const { io, workflowId } = await setup(), automaticId = await start(io, workflowId)
  const results = await Promise.allSettled([execute(io, workflowId, automaticId), execute(io, workflowId, automaticId)])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.equal((await readAutomatic(io, workflowId, automaticId)).state.status, 'completed-with-issues')
  assert.equal((await readWorkflow(io, workflowId)).checkpoint.automaticBudget!.usedSteps, 10)
  const separate = await setup()
  separate.io.externalEdit('.scholarflow/workflows/current.json', JSON.stringify({ schemaVersion: 1, projectId: (await snapshot(separate.io)).ledger.projectId, workflowId: 'workflow_TEST_ONLY_other' }))
  const before = [...separate.io.files.entries()]
  await assert.rejects(prepareAutomatic(separate.io, separate.workflowId, sessionId, policy), { code: 'WORKFLOW_BINDING_CHANGED' })
  assert.deepEqual([...separate.io.files.entries()], before)
})
