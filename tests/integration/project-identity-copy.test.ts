// TEST_ONLY data, owners and models. No live provider/session identity is claimed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, mutateLedger, updateProjectText, CONFIG_PATH, LEDGER_PATH } from '../../src/core/project/project.ts'
import { prepareProjectCopy, applyProjectCopy, verifiedIdentityLineage, isDetachedProjectPointer, detachedPaths, IDENTITY_CURRENT, pendingCopyTransition, copyPlanTransition } from '../../src/core/project/identity.ts'
import { saveManual, buildProposal, storeProposal } from '../../src/core/editing/proposals.ts'
import { approvedMemory } from '../../src/core/project/memory.ts'
import { verifiedMemoryProjection, memoryHistory } from '../../src/core/project/memory-entries.ts'
import { prepareWorkflow, startWorkflow, currentWorkflow, readWorkflowRecord, WORKFLOW_POINTER } from '../../src/core/pipeline/workflow.ts'
import { reserveWorkflowCall, workflowBudgetInfo, workflowAssociation } from '../../src/core/pipeline/workflow-budget.ts'
import { readRun, inspectRuns, ACTIVE_RUN } from '../../src/core/pipeline/run-store.ts'
import { inspectDraftSequence } from '../../src/core/pipeline/draft-sequence.ts'
import { runReview, inspectReview } from '../../src/core/review/review.ts'
import { digest, json } from '../../src/core/store/files.ts'
import { recover, inspectRecovery } from '../../src/core/store/transactions.ts'

const goal = { researchQuestion: 'TEST_ONLY copied project identity', minimumSources: 1, minimumLocatedEvidence: 1,
  noFormalRequirementsReason: 'TEST_ONLY 没有正式课程要求，不声称已具备证据。' }
const input = (revision: number) => ({ expectedRevision: revision, sourceSessionId: 'session_TEST_ONLY_copy', rootFingerprint: digest('TEST_ONLY copy root'),
  reason: 'TEST_ONLY 用户明确将当前工作区绑定为独立副本，旧任务只归档不重放。' })
async function setup() {
  const a = new MemoryStore({ 'raw.txt': '\ufeffTEST_ONLY unchanged source\r\n' })
  await initialize(a, await prepareInit(a, { title: 'TEST_ONLY copy', type: 'course-paper' }))
  await mutateLedger(a, 0, ledger => {
    ledger.sources.source_TEST_ONLY = { id: 'source_TEST_ONLY', kind: 'other', title: 'TEST_ONLY unverified source', authors: [], identifiers: {},
      citeKey: 'sf_TEST_ONLY', provenance: [], identity: { status: 'unverified', method: 'none' }, textAccess: 'none' }
  })
  let current = await snapshot(a)
  await saveManual(a, '\ufeff# TEST_ONLY copied body\r\n\r\nTEST_ONLY 人工段落保持原样。 [@sf_TEST_ONLY]\r\n', current.document.contentHash, current.ledger.revision)
  const memoryPath = '.scholarflow/context/terminology.md', memory = (await a.read(memoryPath))!
  current = await snapshot(a)
  await updateProjectText(a, memoryPath, '# TEST_ONLY 术语\n\nTEST_ONLY 原用户明确确认的术语。\n', digest(memory.text), current.ledger.revision, 'session_TEST_ONLY_original', 'TEST_ONLY 原用户明确确认术语。')
  current = await snapshot(a); await runReview(a, current.ledger.revision)
  const workflowId = (await startWorkflow(a, await prepareWorkflow(a, goal, 'session_TEST_ONLY_original'))).workflowId
  const oldProjectId = (await snapshot(a)).ledger.projectId
  const owner = { pid: 34567, bootInstance: 'TEST_ONLY-original-request-owner' }
  await reserveWorkflowCall(a, workflowId, { callId: 'call_TEST_ONLY_unknown', runId: 'run_TEST_ONLY_old', kind: 'model', stage: 'drafting', owner })
  current = await snapshot(a)
  await storeProposal(a, buildProposal(current, { runId: 'run_TEST_ONLY_old', instruction: 'TEST_ONLY preserved candidate', replacementText: current.document.text,
    dependentEvidenceIds: [] }), current.ledger.revision)
  const state = { schemaVersion: 1, runId: 'run_TEST_ONLY_old', projectId: oldProjectId, sessionId: 'session_TEST_ONLY_original',
    status: 'running', usedModelCalls: 1, owner, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), planHash: digest('TEST_ONLY old plan') }
  a.externalEdit('.scholarflow/runs/run_TEST_ONLY_old/run.json', json(state)); a.externalEdit(ACTIVE_RUN, json(state))
  a.externalEdit('.scholarflow/drafting/current.json', json({ schemaVersion: 1, sequenceId: 'draft_TEST_ONLY_original', projectId: oldProjectId }))
  a.externalEdit(CONFIG_PATH, (await a.read(CONFIG_PATH))!.text + '# TEST_ONLY preserve YAML comments\n')
  const b = new MemoryStore(Object.fromEntries([...a.files].map(([path, image]) => [path, image.text])))
  return { a, b, oldProjectId, workflowId, memoryPath }
}

test('copy preview is read-only; the explicit identity transaction preserves content IDs, BOM/CRLF, source bytes, settings and the original root', async () => {
  const { a, b, oldProjectId } = await setup(), beforeA = [...a.files], old = await snapshot(b), beforeB = [...b.files]
  const plan = await prepareProjectCopy(b, input(old.ledger.revision))
  assert.deepEqual([...b.files], beforeB); assert.notEqual(plan.projectId, oldProjectId)
  const accepted = await applyProjectCopy(b, plan), next = await snapshot(b)
  assert.equal(accepted.projectId, plan.projectId); assert.equal(next.config.project.id, plan.projectId)
  assert.equal(next.document.text, old.document.text); assert.deepEqual(next.document, old.document)
  assert.deepEqual(next.ledger.sources, old.ledger.sources); assert.deepEqual(next.ledger.outline, old.ledger.outline)
  assert.deepEqual(next.config.paths, old.config.paths); assert.deepEqual(next.config.workflow, old.config.workflow)
  assert.ok(Object.values(next.ledger.proposalStates).every(state => state.state === 'stale'))
  assert.ok(Object.values(next.ledger.reviewIssues).every(issue => issue.stale))
  assert.equal((await b.read('raw.txt'))!.text, (await a.read('raw.txt'))!.text)
  assert.ok((await b.read(CONFIG_PATH))!.text.endsWith('# TEST_ONLY preserve YAML comments\n'))
  assert.deepEqual([...a.files], beforeA)
  const lineage = await verifiedIdentityLineage(b, plan.projectId)
  assert.deepEqual(lineage.projectIds, [plan.projectId, oldProjectId]); assert.equal(lineage.records[0].sourceSessionId, 'session_TEST_ONLY_copy')
  assert.equal(lineage.records[0].originals.find(row => row.path === LEDGER_PATH)!.text, beforeB.find(([path]) => path === LEDGER_PATH)![1].text)
})

test('old paid requests and pointer bytes are archived without refunds, cancellation or replay; a new goal needs a new explicit preview', async () => {
  const { a, b, workflowId } = await setup(), old = await snapshot(b)
  const oldInput = (await b.read(`.scholarflow/runs/${workflowId}/input.json`))!.text
  const oldCheckpoint = (await b.read(`.scholarflow/runs/${workflowId}/checkpoint.json`))!.text
  const oldRun = (await b.read('.scholarflow/runs/run_TEST_ONLY_old/run.json'))!.text
  const plan = await prepareProjectCopy(b, input(old.ledger.revision)); await applyProjectCopy(b, plan)
  for (const path of detachedPaths) assert.equal(await isDetachedProjectPointer(b, path, await b.read(path)), true)
  assert.deepEqual(await currentWorkflow(b), { workflow: undefined }); assert.deepEqual(await inspectDraftSequence(b), { sequence: undefined })
  assert.equal((await inspectReview(b)).report, undefined); assert.equal(await workflowBudgetInfo(b), undefined); assert.equal(await workflowAssociation(b), undefined)
  await assert.rejects(readWorkflowRecord(b, workflowId), { code: 'WORKFLOW_INVALID' })
  await assert.rejects(readRun(b, 'run_TEST_ONLY_old', plan.projectId), { code: 'PROJECT_ID_CONFLICT' })
  await assert.rejects(reserveWorkflowCall(b, workflowId, { callId: 'call_TEST_ONLY_replay', runId: 'run_TEST_ONLY_old', kind: 'model', stage: 'drafting' }), { code: 'WORKFLOW_BINDING_CHANGED' })
  assert.equal((await b.read(`.scholarflow/runs/${workflowId}/input.json`))!.text, oldInput)
  assert.equal((await b.read(`.scholarflow/runs/${workflowId}/checkpoint.json`))!.text, oldCheckpoint)
  assert.equal((await b.read('.scholarflow/runs/run_TEST_ONLY_old/run.json'))!.text, oldRun)
  const displayed = (await inspectRuns(b)).runs.find(row => row.runId === 'run_TEST_ONLY_old')!
  assert.equal(displayed.inheritedArchive, true); assert.equal(displayed.usedModelCalls, 1); assert.equal(displayed.sessionId, 'session_TEST_ONLY_original')
  assert.equal((await workflowBudgetInfo(a))!.used!.modelCalls, 1); assert.equal((await workflowBudgetInfo(a))!.pendingCalls.length, 1)
  const preview = await prepareWorkflow(b, goal, 'session_TEST_ONLY_copy')
  assert.equal(await workflowBudgetInfo(b), undefined)
  await startWorkflow(b, preview)
  assert.equal((await workflowBudgetInfo(b))!.used!.modelCalls, 0)
  assert.notEqual((await currentWorkflow(b)).workflow!.input.workflowId, workflowId)
  assert.equal((await b.read(`.scholarflow/runs/${workflowId}/checkpoint.json`))!.text, oldCheckpoint)
})

test('confirmed memory ancestry retains the original user operation and never rewrites old session attribution into a current binding', async () => {
  const { b, oldProjectId, memoryPath } = await setup(), old = await snapshot(b)
  const origin = old.ledger.memoryFiles![memoryPath as keyof NonNullable<typeof old.ledger.memoryFiles>]!.entries[0]
  const first = await prepareProjectCopy(b, input(old.ledger.revision)); await applyProjectCopy(b, first)
  const second = await prepareProjectCopy(b, input((await snapshot(b)).ledger.revision)); await applyProjectCopy(b, second)
  const current = await snapshot(b), text = (await b.read(memoryPath))!.text
  const projection = await verifiedMemoryProjection(b, current.ledger, memoryPath, text)
  assert.equal(projection.current, true); assert.deepEqual(current.ledger.memoryFiles, old.ledger.memoryFiles)
  assert.equal(projection.entries[0].sourceSessionId, 'session_TEST_ONLY_original'); assert.equal(projection.entries[0].sourceOperationId, origin.sourceOperationId)
  assert.equal((await memoryHistory(b, second.projectId, memoryPath)).operations[0].projectId, oldProjectId)
  assert.equal((await approvedMemory(b, second.projectId)).terminology, text)
  assert.deepEqual((await verifiedIdentityLineage(b, second.projectId)).projectIds, [second.projectId, first.projectId, oldProjectId])
})

test('changed originals, altered confirmation and oversized metadata fail before identity writes; damaged archives cannot masquerade as empty pointers', async () => {
  const { b } = await setup(), plan = await prepareProjectCopy(b, input((await snapshot(b)).ledger.revision))
  const writes = b.writes
  await assert.rejects(applyProjectCopy(b, { ...plan, reason: 'TEST_ONLY changed reason' }), { code: 'INVALID_APPROVAL' }); assert.equal(b.writes, writes)
  b.externalEdit(WORKFLOW_POINTER, (await b.read(WORKFLOW_POINTER))!.text + ' ')
  const before = [...b.files]
  await assert.rejects(applyProjectCopy(b, plan), { code: 'PROJECT_COPY_CHANGED' }); assert.deepEqual([...b.files], before)
  const currentPlan = await prepareProjectCopy(b, input((await snapshot(b)).ledger.revision)); await applyProjectCopy(b, currentPlan)
  const pointer = JSON.parse((await b.read(IDENTITY_CURRENT))!.text), archive = `.scholarflow/identity/history/${pointer.operationId}.json`
  b.externalEdit(archive, (await b.read(archive))!.text + ' ')
  await assert.rejects(currentWorkflow(b), { code: 'PROJECT_COPY_ARCHIVE_INVALID' })
  assert.equal((await verifiedMemoryProjection(b, (await snapshot(b)).ledger, '.scholarflow/context/terminology.md', (await b.read('.scholarflow/context/terminology.md'))!.text)).current, false)
  const other = await setup(); other.b.externalEdit(LEDGER_PATH, ' '.repeat(2 * 1024 * 1024 + 1) + (await other.b.read(LEDGER_PATH))!.text)
  const largeBefore = [...other.b.files]
  await assert.rejects(prepareProjectCopy(other.b, input((await snapshot(other.b)).ledger.revision)), { code: 'PROJECT_COPY_HISTORY_LIMIT' }); assert.deepEqual([...other.b.files], largeBefore)
})

test('each identity publication interruption recovers the frozen confirmed copy exactly once, retaining old charged state and all source bytes', async () => {
  for (let target = 1; target <= 13; target++) {
    const { b, oldProjectId, workflowId } = await setup(), plan = await prepareProjectCopy(b, input((await snapshot(b)).ledger.revision))
    const source = (await b.read('raw.txt'))!.text, checkpoint = (await b.read(`.scholarflow/runs/${workflowId}/checkpoint.json`))!.text
    const write = b.write.bind(b); let count = 0
    b.write = async (...args) => { const result = await write(...args); if (++count === target) throw new Error('TEST_ONLY interrupted identity publication'); return result }
    await assert.rejects(applyProjectCopy(b, plan), /TEST_ONLY interrupted/); b.write = write
    if ((await inspectRecovery(b)).pending.length) {
      assert.deepEqual(await pendingCopyTransition(b), copyPlanTransition(plan))
      await b.lock(() => recover(b))
    }
    assert.equal((await snapshot(b)).ledger.projectId, plan.projectId); assert.notEqual(plan.projectId, oldProjectId)
    assert.equal((await b.read('raw.txt'))!.text, source); assert.equal((await b.read(`.scholarflow/runs/${workflowId}/checkpoint.json`))!.text, checkpoint)
    assert.equal((await verifiedIdentityLineage(b, plan.projectId)).records.length, 1)
    assert.deepEqual(await b.lock(() => recover(b)), [])
    assert.equal(await pendingCopyTransition(b), undefined)
    const writes = b.writes; await assert.rejects(applyProjectCopy(b, plan), { code: 'STALE_LEDGER_REVISION' }); assert.equal(b.writes, writes)
  }
})

test('a recovery identity exemption requires every exact publication target; unrelated transactions and extra writes cannot acquire it', async () => {
  const { b } = await setup(), plan = await prepareProjectCopy(b, input((await snapshot(b)).ledger.revision)), write = b.write.bind(b)
  b.write = async (...args) => { const result = await write(...args); if (args[0].startsWith('.scholarflow/transactions/')) throw new Error('TEST_ONLY journal-only interruption'); return result }
  await assert.rejects(applyProjectCopy(b, plan), /TEST_ONLY journal-only/); b.write = write
  assert.deepEqual(await pendingCopyTransition(b), copyPlanTransition(plan))
  const pending = (await inspectRecovery(b)).pending[0], altered = JSON.parse(pending.journal.text)
  const memoryPath = '.scholarflow/context/terminology.md', old = (await b.read(memoryPath))!.text
  altered.changes.push({ path: memoryPath, before: { text: old, hash: digest(old) }, after: { text: 'TEST_ONLY injected write', hash: digest('TEST_ONLY injected write') } })
  b.externalEdit(pending.path, json(altered)); const before = [...b.files]
  await assert.rejects(pendingCopyTransition(b), { code: 'PROJECT_COPY_ARCHIVE_INVALID' }); assert.deepEqual([...b.files], before)
  const ordinary = new MemoryStore()
  await initialize(ordinary, await prepareInit(ordinary, { title: 'TEST_ONLY ordinary transaction', type: 'course-paper' }))
  assert.equal(await pendingCopyTransition(ordinary), undefined)
})
