// TEST_ONLY adapters: real domain persistence; no paid provider or publication.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { registerSource, confirmEvidence, upsertClaim, confirmOutline } from '../../src/core/evidence/evidence.ts'
import { prepareWorkflow, startWorkflow } from '../../src/core/pipeline/workflow.ts'
import { prepareAutomatic, startAutomatic, driveAutomatic, readAutomatic, readAutomaticWork } from '../../src/core/pipeline/workflow-automatic.ts'
import { prepareGeneration, executeGeneration } from '../../src/core/pipeline/generation.ts'
import { prepareDraftSequence, startDraftSequence, prepareDraftSequenceAction, readDraftSequence } from '../../src/core/pipeline/draft-sequence.ts'
import { prepareResearchBatch, executeResearchBatch, readResearchBatch } from '../../src/core/research/batch.ts'
import { workflowBudgetInfo } from '../../src/core/pipeline/workflow-budget.ts'
import { applyProposal, saveManual } from '../../src/core/editing/proposals.ts'
import { automaticPolicySchema, automaticPrepareRequest } from '../../src/shared/workflow-automatic.ts'
import { ScholarError } from '../../src/shared/errors.ts'
import { json } from '../../src/core/store/files.ts'

const owner = { pid: 1, bootInstance: 'TEST_ONLY_stages' }, signal = () => new AbortController().signal
const model = { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY', maxOutputTokens: 16384 }
const policy = automaticPolicySchema.parse({ insufficientResearchReason: 'TEST_ONLY 仅核对教学说明，保留所有实测与出版限制。' })
async function context(io: MemoryStore) {
  const saved = await snapshot(io)
  return { requestId: 'request_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY', sessionId: 'session_TEST_ONLY', projectId: saved.ledger.projectId, expectedLedgerRevision: saved.ledger.revision }
}
async function setup() {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY 只记录教学说明，不能冒充实验结果。', 'unselected.txt': 'TEST_ONLY_UNSELECTED_STAGES' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 阶段', type: 'course-paper', maxModelCalls: 8 }))
  const mat = await registerMaterial(io, { relativePath: 'raw.txt', role: 'notes', confirmExcludedFile: false }, (await snapshot(io)).ledger.revision)
  const parsed = await parseRegisteredMaterial(io, mat.material.id, mat.revision, signal(), (bytes, format) => parseMaterialBytes(bytes, format, signal()))
  const source = await registerSource(io, { title: 'TEST_ONLY 原文', kind: 'other', identifiers: {}, authors: [], materialId: mat.material.id }, parsed.revision)
  const ev = await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash, kind: 'quotation',
    locator: parsed.parsed.blocks[0].locator, excerpt: parsed.parsed.blocks[0].text }, source.revision)
  const claim = await upsertClaim(io, { text: 'TEST_ONLY 仅是教学说明', kind: 'author-inference', scope: 'TEST_ONLY 原文', evidenceLinks: [{ evidenceId: ev.evidence.id, relation: 'supports', rationale: 'TEST_ONLY 原文明确限定为教学说明，没有实验结果。' }], limitations: ['没有实验结果'] }, ev.revision)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: 'TEST_ONLY 教学说明有什么限制？', thesis: '保留原文范围', confirmation: 'draft', sections: [
    { id: 'sec_TEST_ONLY_summary', title: '摘要', purpose: '总结实际正文', claimIds: [claim.claim.id], missingEvidence: [] },
    { id: 'sec_TEST_ONLY_body', title: '讨论', purpose: '仅教学材料', claimIds: [claim.claim.id], missingEvidence: [] },
  ] }, claim.revision, 0)
  const root = await startWorkflow(io, await prepareWorkflow(io, { researchQuestion: 'TEST_ONLY 教学说明有什么限制？', minimumSources: 1, minimumLocatedEvidence: 1,
    noFormalRequirementsReason: 'TEST_ONLY 非正式教学测试，没有额外课程要求。' }, 'session_TEST_ONLY'))
  const response = (sectionId: string) => json({ sectionId, replacementText: `TEST_ONLY 教学说明不代表实验结果。[@${source.source.citeKey}]`, limitations: ['仅限教学材料'], paragraphClaims: [{ paragraphIndex: 0, claimIds: [claim.claim.id] }] })
  return { io, workflowId: root.workflowId, response }
}
const drive = (io: MemoryStore, workflowId: string, automaticId: string, workers: Parameters<typeof driveAutomatic>[6]) =>
  driveAutomatic(io, workflowId, automaticId, signal(), { pauseRequested: () => false }, workers)

test('fixed automatic generation uses only its registered child, saves a verifiable candidate and stops before acceptance', async () => {
  const { io, workflowId, response } = await setup()
  const frozen = await prepareGeneration(io, { context: await context(io), instruction: 'TEST_ONLY 保留事实', sectionId: 'sec_TEST_ONLY_body' }, model)
  const preview = await prepareAutomatic(io, workflowId, 'session_TEST_ONLY', policy, undefined, { kind: 'generation', plan: frozen })
  const before = (await snapshot(io)).document.text, inputPath = `.scholarflow/runs/${workflowId}/automatic/${preview.input.automaticId}/input.json`
  await startAutomatic(io, preview, owner)
  const input = (await io.read(inputPath))!.text
  let calls = 0
  const result = await drive(io, workflowId, preview.input.automaticId, { generation: async (plan, grant, childSignal) => {
    const writes = io.writes
    await assert.rejects(executeGeneration(io, plan, owner, childSignal, async () => { calls++; return response(plan.input.sectionId!) }, () => true,
      { pauseRequested: () => false, automaticChild: { ...grant, stepId: 'automatic_step_TEST_ONLY_wrong' } }), { code: 'AUTOMATIC_CHILD_INVALID' })
    assert.equal(io.writes, writes)
    return executeGeneration(io, plan, owner, childSignal, async () => { calls++; return response(plan.input.sectionId!) }, () => true,
      { pauseRequested: () => false, automaticChild: grant })
  } })
  assert.equal(calls, 1); assert.equal(result.code, 'AUTOMATIC_STAGE_REVIEW_REQUIRED'); assert.equal(result.steps.at(-1)!.state, 'settled')
  assert.equal((await snapshot(io)).document.text, before); assert.equal((await io.read(inputPath))!.text, input)
  assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 1)
  assert.equal((await readAutomaticWork(io, workflowId, result.automaticId)).plan.contentHash, frozen.contentHash)
  assert.equal(Object.values((await snapshot(io)).ledger.proposalStates).at(-1)!.state, 'pending')
  assert.equal((await io.read('unselected.txt'))!.text, 'TEST_ONLY_UNSELECTED_STAGES')
})

test('two automatic sequence candidates advance only after real accepted bytes while the original goal and input remain frozen', async () => {
  const { io, workflowId, response } = await setup()
  const sequence = await startDraftSequence(io, await prepareDraftSequence(io, { context: await context(io), instruction: 'TEST_ONLY 原文', summarySectionIds: ['sec_TEST_ONLY_summary'] }, model))
  const original = (await readDraftSequence(io, sequence.sequenceId)).inputFile.text
  let acceptedBody = ''
  for (const sectionId of ['sec_TEST_ONLY_body', 'sec_TEST_ONLY_summary']) {
    const action = await prepareDraftSequenceAction(io, { context: await context(io), sequenceId: sequence.sequenceId, action: 'next', reason: '' })
    assert.equal(action.generation!.input.sectionId, sectionId)
    if (acceptedBody) assert.equal((action.generation!.context.manuscript as any).actualSavedManuscriptForConsistency, acceptedBody)
    const preview = await prepareAutomatic(io, workflowId, 'session_TEST_ONLY', policy, undefined, { kind: 'generation', plan: action.generation!, sequenceAction: action })
    await startAutomatic(io, preview, owner)
    await drive(io, workflowId, preview.input.automaticId, { generation: (plan, grant, childSignal) => executeGeneration(io, plan, owner, childSignal,
      async () => response(sectionId), () => true, { pauseRequested: () => false, automaticChild: grant }) })
    const saved = await snapshot(io), proposalId = Object.values(saved.ledger.proposalStates).find(state => state.state === 'pending')!.proposalId
    const image = JSON.parse((await io.read(`.scholarflow/proposals/${proposalId}.json`))!.text)
    const { proposalImage } = await import('../../src/core/editing/proposals.ts')
    assert.equal(image.id, proposalId)
    const proposal = await proposalImage(io, proposalId)
    await applyProposal(io, proposalId, saved.ledger.revision, proposal.contentHash)
    acceptedBody = (await snapshot(io)).document.text
  }
  assert.equal((await readDraftSequence(io, sequence.sequenceId)).inputFile.text, original)
  assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 2)
  assert.equal((await workflowBudgetInfo(io))!.limits!.maxModelCalls, 8)
})

test('fixed automatic research preserves partial provider failures and charges both queries without turning metadata into evidence', async () => {
  const { io, workflowId } = await setup(), original = await snapshot(io)
  const frozen = await prepareResearchBatch(io, { context: await context(io), searches: [
    { query: 'TEST_ONLY success', purpose: 'TEST_ONLY 查询', limit: 1 }, { query: 'TEST_ONLY failure', purpose: 'TEST_ONLY 失败', limit: 1 },
  ] })
  const preview = await prepareAutomatic(io, workflowId, 'session_TEST_ONLY', policy, undefined, { kind: 'research', plan: frozen })
  await startAutomatic(io, preview, owner)
  let queries = 0
  const provider = { id: 'crossref' as const, capabilities: { search: true, lookupIdentifier: false, fullText: false }, lookup: async () => null,
    search: async () => { queries++; if (queries === 2) throw new ScholarError('PROVIDER_AUTH', 'TEST_ONLY permanent failure'); return { records: [], warnings: ['TEST_ONLY no candidates'] } } }
  const result = await drive(io, workflowId, preview.input.automaticId, { research: (plan, grant, childSignal) => executeResearchBatch(io, plan, provider, childSignal, owner, () => true,
    { pauseRequested: () => false, automaticChild: grant }) })
  assert.equal(queries, 2); assert.equal(result.status, 'completed-with-issues')
  const actual = await readResearchBatch(io, frozen.snapshot.runId)
  assert.deepEqual(actual.checkpoint.queries.map(query => query.state), ['completed', 'failed'])
  assert.equal((await workflowBudgetInfo(io))!.used!.searchQueries, 2)
  const saved = await snapshot(io)
  assert.deepEqual(saved.ledger.sources, original.ledger.sources); assert.deepEqual(saved.ledger.evidence, original.ledger.evidence); assert.equal(saved.document.text, original.document.text)
})

test('an altered plan or draft cannot inherit an automatic paid authorization; simultaneous fixed review and new draft are rejected', async () => {
  const { io, workflowId } = await setup()
  const frozen = await prepareGeneration(io, { context: await context(io), instruction: 'TEST_ONLY', sectionId: 'sec_TEST_ONLY_body' }, model)
  const preview = await prepareAutomatic(io, workflowId, 'session_TEST_ONLY', policy, undefined, { kind: 'generation', plan: frozen })
  const saved = await snapshot(io)
  await saveManual(io, saved.document.text + '\nTEST_ONLY 人工新稿\n', saved.document.contentHash, saved.ledger.revision)
  const writes = io.writes
  await assert.rejects(startAutomatic(io, preview, owner), { code: 'WORKFLOW_INPUT_CHANGED' }); assert.equal(io.writes, writes)
  assert.equal(automaticPrepareRequest.safeParse({ context: await context(io), workflowId, policy, modelReview: true, generation: { instruction: 'TEST_ONLY' } }).success, false)
})

test('a worker cannot claim success without a saved candidate; its original pending registration is retained', async () => {
  const { io, workflowId } = await setup(), frozen = await prepareGeneration(io, { context: await context(io), instruction: 'TEST_ONLY', sectionId: 'sec_TEST_ONLY_body' }, model)
  const preview = await prepareAutomatic(io, workflowId, 'session_TEST_ONLY', policy, undefined, { kind: 'generation', plan: frozen })
  await startAutomatic(io, preview, owner)
  await assert.rejects(drive(io, workflowId, preview.input.automaticId, { generation: async () => ({ succeeded: true }) }))
  const observed = await readAutomatic(io, workflowId, preview.input.automaticId)
  assert.equal(observed.state.status, 'failed'); assert.equal(observed.state.steps.at(-1)!.state, 'pending')
  const writes = io.writes
  await assert.rejects(drive(io, workflowId, preview.input.automaticId, {}), { code: 'AUTOMATIC_RESUME_REQUIRED' }); assert.equal(io.writes, writes)
})
