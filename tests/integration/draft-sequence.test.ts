// TEST_ONLY: guarded real persistence and parser with an explicitly synthetic model adapter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { proposalOf, proposalHashOf } from '../fixtures/generation-result.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { prepareDraftSequence, startDraftSequence, prepareDraftSequenceAction, applyDraftSequenceAction,
  inspectDraftSequence, readDraftSequence } from '../../src/core/pipeline/draft-sequence.ts'
import { startWorkflow, prepareWorkflow } from '../../src/core/pipeline/workflow.ts'
import { workflowBudgetInfo } from '../../src/core/pipeline/workflow-budget.ts'
import { executeGeneration, STRUCTURAL_GAP } from '../../src/core/pipeline/generation.ts'
import { applyProposal, rejectProposal, saveManual } from '../../src/core/editing/proposals.ts'
import { prepareProposalRevision, publishProposalRevision } from '../../src/core/editing/proposal-revision.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { registerSource, confirmEvidence, upsertClaim, confirmOutline } from '../../src/core/evidence/evidence.ts'
import { recover } from '../../src/core/store/transactions.ts'
import { type FileImage, digest, json } from '../../src/core/store/files.ts'
import { closeRun, prepareRunAction } from '../../src/core/pipeline/run-control.ts'
const model = { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY', maxOutputTokens: 16384 }
const owner = { pid: 1, bootInstance: 'TEST_ONLY' }, signal = () => new AbortController().signal
test('a closed interrupted chapter remains cancellable when identical state keys have a different serialization order', async () => {
  const { io } = await setup(), sequenceId = await begin(io), plan = await dispatch(io, sequenceId)
  await executeGeneration(io, plan, owner, signal(), async () => { throw new Error('TEST_ONLY paused before dispatch') }, () => false, { pauseRequested: () => true })
  const close = await prepareRunAction(io, plan.snapshot.runId, 'close', () => false)
  const result = await closeRun(io, close, () => false)
  const { errorCode, ...body } = result.run, alternate = json({ ...body, errorCode })
  io.externalEdit(`.scholarflow/runs/${plan.snapshot.runId}/run.json`, alternate)
  io.externalEdit('.scholarflow/runs/active.json', alternate)
  await applyDraftSequenceAction(io, await action(io, sequenceId, 'cancel', 'TEST_ONLY 明确结束中断章节，保留原登记。'))
  assert.equal((await readDraftSequence(io, sequenceId)).checkpoint.status, 'cancelled')
})
async function context(io: MemoryStore, sessionId = 'session_TEST_ONLY') {
  const current = await snapshot(io)
  return { requestId: 'req_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY', sessionId, projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision }
}
async function setup(options: { evidence?: boolean; guide?: boolean; modelCalls?: number; io?: MemoryStore } = {}) {
  const io = options.io ?? new MemoryStore({ 'raw.txt': 'TEST_ONLY 原始资料：结果尚未取得；只限给定资料。\n' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 按节初稿', type: 'research-paper',
    ...(options.modelCalls && { maxModelCalls: options.modelCalls }) }))
  let claimIds: string[] = [], citeKey = ''
  if (options.evidence) {
    let current = await snapshot(io)
    const material = await registerMaterial(io, { relativePath: 'raw.txt', role: 'notes', confirmExcludedFile: false }, current.ledger.revision)
    const parsed = await parseRegisteredMaterial(io, material.material.id, material.revision, signal(), (bytes, format) => parseMaterialBytes(bytes, format, signal()))
    const source = await registerSource(io, { title: 'TEST_ONLY 来源', authors: [], kind: 'other', identifiers: {}, materialId: material.material.id }, parsed.revision)
    const evidence = await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash,
      locator: parsed.parsed.blocks[0].locator, excerpt: parsed.parsed.blocks[0].text, kind: 'quotation' }, source.revision)
    const claim = await upsertClaim(io, { text: 'TEST_ONLY 尚未取得结果', kind: 'planned-experiment', scope: '仅本项目',
      evidenceLinks: [{ evidenceId: evidence.evidence.id, relation: 'background' }], limitations: ['没有实验结果'] }, evidence.revision)
    claimIds = [claim.claim.id]; citeKey = source.source.citeKey
  }
  let current = await snapshot(io)
  await saveManual(io, '# TEST_ONLY\n\n## 人工说明\n\nTEST_ONLY 人工内容 😀 保持原样。\n', current.document.contentHash, current.ledger.revision)
  current = await snapshot(io)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: 'TEST_ONLY 缺失真实结果如何保留？', thesis: '不编造结果', confirmation: 'draft', sections: [
    { id: 'sec_summary', title: '摘要', purpose: '只总结实际保存正文', claimIds, missingEvidence: ['真实结果'] },
    { id: 'sec_body', title: '证据讨论', purpose: '依据来源保留缺口', claimIds, missingEvidence: ['真实结果'] },
    { id: 'sec_human', title: '人工说明', purpose: '保留人工内容', claimIds: [], missingEvidence: [] },
  ] }, current.ledger.revision, 0)
  if (options.guide !== false) await startWorkflow(io, await prepareWorkflow(io, { researchQuestion: 'TEST_ONLY 缺失真实结果如何保留？',
    minimumSources: 1, minimumLocatedEvidence: 1, noFormalRequirementsReason: 'TEST_ONLY 没有正式课程要求，证据与结果缺口保留。' }, 'session_TEST_ONLY'))
  return { io, citeKey, claimIds }
}
async function begin(io: MemoryStore) {
  return (await startDraftSequence(io, await prepareDraftSequence(io, { context: await context(io), instruction: 'TEST_ONLY 按节写作，不编造结果。', summarySectionIds: ['sec_summary'] }, model))).sequenceId
}
async function action(io: MemoryStore, sequenceId: string, kind: 'next' | 'pause' | 'resume' | 'cancel', reason = '') {
  return prepareDraftSequenceAction(io, { context: await context(io), sequenceId, action: kind, reason })
}
async function dispatch(io: MemoryStore, sequenceId: string) {
  const plan = await action(io, sequenceId, 'next'); assert.ok(plan.generation)
  await applyDraftSequenceAction(io, plan); return plan.generation
}
async function execute(io: MemoryStore, plan: Awaited<ReturnType<typeof dispatch>>, modelCall: any = async () => { throw new Error('TEST_ONLY gap must not call a model') }) {
  return executeGeneration(io, plan, owner, signal(), modelCall, () => true)
}
async function accept(io: MemoryStore, result: any) {
  const current = await snapshot(io); return applyProposal(io, result.proposal.id, current.ledger.revision, result.proposalHash)
}

test('sequence previews do not write; explicit summaries run last, existing human sections are preserved, and a frozen overall goal is required', async () => {
  const { io } = await setup(), before = io.writes
  const preview = await prepareDraftSequence(io, { context: await context(io), instruction: 'TEST_ONLY', summarySectionIds: ['sec_summary'] }, model)
  assert.equal(io.writes, before); assert.deepEqual(preview.input.sections.map(row => row.sectionId), ['sec_body', 'sec_human', 'sec_summary'])
  assert.equal(preview.input.sections[1].preserve, true)
  await assert.rejects(prepareDraftSequence(io, { context: await context(io), instruction: 'TEST_ONLY', summarySectionIds: ['sec_summary', 'sec_body', 'sec_human'] }, model), { code: 'DRAFT_SEQUENCE_ORDER_INVALID' })
  const unbound = (await setup({ guide: false })).io
  await assert.rejects(begin(unbound), { code: 'DRAFT_SEQUENCE_WORKFLOW_REQUIRED' })
})
test('unlocated sections publish fixed gaps with zero model calls; only accepted revision bytes count, then the sequence ends with issues', async () => {
  const { io } = await setup(), sequenceId = await begin(io), original = (await snapshot(io)).document.text
  const first = await dispatch(io, sequenceId), result = await execute(io, first)
  assert.equal(result.run.usedModelCalls, 0); assert.equal((await snapshot(io)).document.text, original)
  assert.equal(first.context.structuralGap, true); assert.equal(first.input.sectionId, 'sec_body')
  await assert.rejects(action(io, sequenceId, 'next'), { code: 'DRAFT_SEQUENCE_AWAITING_ACCEPTANCE' })
  await accept(io, result)
  const next = await action(io, sequenceId, 'next'); assert.equal(next.generation?.input.sectionId, 'sec_summary')
  assert.ok(JSON.stringify(next.generation?.context.manuscript).includes(STRUCTURAL_GAP))
  await applyDraftSequenceAction(io, next); await accept(io, await execute(io, next.generation!))
  const finish = await action(io, sequenceId, 'next'); assert.equal(finish.generation, undefined)
  await applyDraftSequenceAction(io, finish)
  const completed = await readDraftSequence(io, sequenceId)
  assert.equal(completed.checkpoint.status, 'completed-with-issues'); assert.equal(completed.checkpoint.steps.filter(row => row.state === 'accepted').length, 2)
  assert.ok((await snapshot(io)).document.text.includes('TEST_ONLY 人工内容 😀 保持原样。'))
  assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 0)
  assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY 原始资料：结果尚未取得；只限给定资料。\n')
})
test('each evidenced section receives the actual accepted body; both paid dispatches share the original cumulative budget', async () => {
  const { io, citeKey, claimIds } = await setup({ evidence: true }), sequenceId = await begin(io)
  let calls = 0
  const first = await dispatch(io, sequenceId), result = await execute(io, first, async (request: any) => {
    calls++; return JSON.stringify({ replacementText: `TEST_ONLY 仅限来源范围 [@${citeKey}]。\n\n[待补：真实结果尚未取得]`,
      sectionId: 'sec_body', paragraphClaims: [{ paragraphIndex: 0, claimIds }, { paragraphIndex: 1, claimIds: [] }], limitations: ['真实结果尚未取得'] })
  })
  await accept(io, result)
  const second = await dispatch(io, sequenceId)
  await accept(io, await execute(io, second, async (request: any) => {
    calls++; assert.ok(request.context.manuscript.actualSavedManuscriptForConsistency.includes('TEST_ONLY 仅限来源范围'))
    assert.ok(request.context.manuscript.actualSavedManuscriptForConsistency.includes('[待补：真实结果尚未取得]'))
    assert.ok(request.instruction.includes('仅依据')); return JSON.stringify({ replacementText: `TEST_ONLY 本文讨论给定资料范围 [@${citeKey}]，真实结果尚未取得。`,
      sectionId: 'sec_summary', paragraphClaims: [{ paragraphIndex: 0, claimIds }], limitations: ['没有真实结果'] })
  }))
  await applyDraftSequenceAction(io, await action(io, sequenceId, 'next'))
  assert.equal(calls, 2); assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 2)
})

test('old sequences without an output-token field use the known generation default after cold acceptance without rewriting immutable input or renewing calls', async () => {
  const { io, citeKey, claimIds } = await setup({ evidence: true }), sequenceId = await begin(io)
  const prefix = `.scholarflow/runs/${sequenceId}`, stored = await readDraftSequence(io, sequenceId)
  // TEST_ONLY earlier optional-field representation, with all original hashes
  // made coherent before execution. It does not alter a live user project.
  const oldInput = structuredClone(stored.input); delete oldInput.model.maxOutputTokens
  const oldText = json(oldInput), { contentHash: _hash, ...planBody } = JSON.parse((await io.read(`${prefix}/plan.json`))!.text)
  planBody.inputHash = digest(oldText); const oldPlanHash = digest(json(planBody))
  const checkpoint = { ...stored.checkpoint, inputHash: digest(oldText), planHash: oldPlanHash }, checkpointText = json(checkpoint)
  const run = { ...JSON.parse(stored.record.text), inputHash: digest(oldText), planHash: oldPlanHash, checkpointHash: digest(checkpointText) }
  for (const [path, text] of [[`${prefix}/input.json`, oldText], [`${prefix}/plan.json`, json({ ...planBody, contentHash: oldPlanHash })],
    [`${prefix}/checkpoint.json`, checkpointText], [`${prefix}/run.json`, json(run)]]) io.externalEdit(path, text)
  const first = await dispatch(io, sequenceId)
  assert.equal(first.snapshot.modelDescriptor.maxOutputTokens, 16384)
  await accept(io, await execute(io, first, async (request: any) => {
    assert.equal(request.maxTokens, 16384)
    return json({ replacementText: `TEST_ONLY 缺失结果仍保留 [@${citeKey}]。`, sectionId: 'sec_body', paragraphClaims: [{ paragraphIndex: 0, claimIds }], limitations: ['真实结果待补'] })
  }))
  const cold = new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text])))
  const second = await action(cold, sequenceId, 'next')
  assert.equal(second.generation!.input.sectionId, 'sec_summary'); assert.equal(second.generation!.snapshot.modelDescriptor.maxOutputTokens, 16384)
  await applyDraftSequenceAction(cold, second)
  assert.equal((await cold.read(`${prefix}/input.json`))!.text, oldText)
  assert.equal((await workflowBudgetInfo(cold))!.used!.modelCalls, 1)
})
test('rejecting a chapter never advances or automatically retries it, and cancellation preserves both the proposal and body', async () => {
  const { io } = await setup(), sequenceId = await begin(io), result = await execute(io, await dispatch(io, sequenceId)), before = (await snapshot(io)).document.text
  await rejectProposal(io, proposalOf(result).id, (await snapshot(io)).ledger.revision)
  await assert.rejects(action(io, sequenceId, 'next'), { code: 'DRAFT_SEQUENCE_AWAITING_ACCEPTANCE' })
  await applyDraftSequenceAction(io, await action(io, sequenceId, 'cancel', 'TEST_ONLY 用户拒绝该节，明确取消顺序保留所有产物。'))
  assert.equal((await snapshot(io)).document.text, before); assert.equal((await snapshot(io)).ledger.proposalStates[proposalOf(result).id].state, 'rejected')
})
test('a later section exceeds legacy model quotas while preserving earlier accepted body', async () => {
  const { io, citeKey, claimIds } = await setup({ evidence: true, modelCalls: 1 }), sequenceId = await begin(io)
  let calls = 0
  const result = await execute(io, await dispatch(io, sequenceId), async () => {
    calls++; return JSON.stringify({ replacementText: `TEST_ONLY 正文保存 [@${citeKey}]，真实结果待补。`,
      sectionId: 'sec_body', paragraphClaims: [{ paragraphIndex: 0, claimIds }], limitations: ['真实结果待补'] })
  })
  await accept(io, result)
  const body = (await snapshot(io)).document.text, second = await dispatch(io, sequenceId)
  const next = await execute(io, second, async () => { calls++; return JSON.stringify({ replacementText: `TEST_ONLY 总结 [@${citeKey}]。`, sectionId: second.input.sectionId, paragraphClaims: [{ paragraphIndex: 0, claimIds }], limitations: [] }) })
  assert.ok(proposalOf(next)); assert.equal(calls, 2); assert.equal((await snapshot(io)).document.text, body)
  assert.equal((await workflowBudgetInfo(io))!.used!.modelCalls, 2)
})
test('concurrent sequence starts and stale confirmations cannot replace the current sequence or overwrite human edits', async () => {
  const { io } = await setup()
  const preview = await prepareDraftSequence(io, { context: await context(io), instruction: 'TEST_ONLY', summarySectionIds: ['sec_summary'] }, model)
  const attempts = await Promise.allSettled([startDraftSequence(io, preview), startDraftSequence(io, preview)])
  assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1)
  const next = await action(io, preview.input.sequenceId, 'next'), current = await snapshot(io)
  await saveManual(io, current.document.text + '\nTEST_ONLY 人工修改保留\n', current.document.contentHash, current.ledger.revision)
  const before = io.writes
  await assert.rejects(applyDraftSequenceAction(io, next), { code: 'DRAFT_SEQUENCE_INPUT_CHANGED' })
  assert.equal(io.writes, before); assert.ok((await snapshot(io)).document.text.includes('TEST_ONLY 人工修改保留'))
})
test('an operator-edited descendant can count only after its immutable lineage and accepted manifest are proven', async () => {
  const { io } = await setup(), sequenceId = await begin(io), result = await execute(io, await dispatch(io, sequenceId))
  const edit = await prepareProposalRevision(io, { context: await context(io), proposalId: proposalOf(result).id, proposalHash: proposalHashOf(result),
    replacementText: '[待补：TEST_ONLY 用户编辑的明确缺口，尚无真实结果。]', paragraphClaims: [{ paragraphIndex: 0, claimIds: [] }], reason: 'TEST_ONLY 用户改写待补说明。' })
  const revised = await publishProposalRevision(io, edit, 'session_TEST_ONLY'); await accept(io, revised)
  const next = await action(io, sequenceId, 'next')
  assert.equal(next.next.steps[0].proposalId, revised.proposal.id); assert.equal(next.generation?.input.sectionId, 'sec_summary')
})
test('cold observation adopts the accepted chapter only through a new confirmation; pause and another session do not replay it', async () => {
  const { io } = await setup(), sequenceId = await begin(io)
  await accept(io, await execute(io, await dispatch(io, sequenceId)))
  await applyDraftSequenceAction(io, await action(io, sequenceId, 'pause'))
  const cold = new MemoryStore(Object.fromEntries([...io.files].map(([path, image]) => [path, image.text])))
  const before = cold.writes, observed = await inspectDraftSequence(cold)
  assert.equal(observed.sequence!.checkpoint.steps[0].state, 'accepted'); assert.equal(cold.writes, before)
  const resume = await prepareDraftSequenceAction(cold, { context: await context(cold, 'session_other_TEST_ONLY'), sequenceId, action: 'resume', reason: '' })
  await applyDraftSequenceAction(cold, resume)
  assert.equal((await readDraftSequence(cold, sequenceId)).checkpoint.steps[0].state, 'accepted')
  assert.equal((await action(cold, sequenceId, 'next')).generation?.input.sectionId, 'sec_summary')
})
test('changing real materials, writing resources, or the saved manuscript stops old sequence scope without losing human bytes', async () => {
  for (const change of ['raw', 'profile', 'body']) {
    const { io } = await setup({ evidence: true }), sequenceId = await begin(io)
    if (change === 'raw') io.externalEdit('raw.txt', 'TEST_ONLY 原始资料外部变更')
    if (change === 'profile') io.externalEdit('.scholarflow/profiles/writing.md', (await io.read('.scholarflow/profiles/writing.md'))!.text + '\nTEST_ONLY 改文风')
    if (change === 'body') { const current = await snapshot(io); await saveManual(io, current.document.text + '\nTEST_ONLY 新人工段落\n', current.document.contentHash, current.ledger.revision) }
    const before = io.writes, saved = (await snapshot(io)).document.text
    await assert.rejects(action(io, sequenceId, 'next'), { code: change === 'body' ? 'DRAFT_SEQUENCE_DOCUMENT_CHANGED' : 'DRAFT_SEQUENCE_INPUT_CHANGED' })
    assert.equal(io.writes, before); assert.equal((await snapshot(io)).document.text, saved)
  }
})
test('a sequence pause between registering a child and dispatch prevents model execution; corrupt accepted snapshots cannot advance progress', async () => {
  const { io } = await setup(), sequenceId = await begin(io), child = await dispatch(io, sequenceId)
  await applyDraftSequenceAction(io, await action(io, sequenceId, 'pause'))
  let calls = 0
  await assert.rejects(execute(io, child, async () => { calls++; return '{}' }), { code: 'DRAFT_SEQUENCE_INPUT_CHANGED' })
  assert.equal(calls, 0)
  await applyDraftSequenceAction(io, await action(io, sequenceId, 'resume'))
  const result = await execute(io, child), accepted = await accept(io, result)
  io.externalEdit(`.scholarflow/drafts/${accepted.revisionId}/preimage.md`, 'TEST_ONLY 外部损坏')
  const before = io.writes
  await assert.rejects(action(io, sequenceId, 'next'), { code: 'DRAFT_SEQUENCE_INVALID' }); assert.equal(io.writes, before)
  assert.ok((await inspectDraftSequence(io)).sequence!.diagnostics.length)
})
test('registration interruption recovers the original approved child identity without dispatching or rebuilding another call', async () => {
  class FaultStore extends MemoryStore {
    armed = false
    override async write(path: string, text: string, expected: FileImage | undefined) {
      const result = await super.write(path, text, expected)
      if (this.armed && /^\.scholarflow\/runs\/draft_.*\/checkpoint\.json$/.test(path)) { this.armed = false; throw new Error('TEST_ONLY crash after checkpoint write') }
      return result
    }
  }
  const { io } = await setup({ io: new FaultStore() }), sequenceId = await begin(io), plan = await action(io, sequenceId, 'next')
  ;(io as FaultStore).armed = true
  await assert.rejects(applyDraftSequenceAction(io, plan))
  await recover(io)
  const restored = await readDraftSequence(io, sequenceId)
  assert.equal(restored.checkpoint.steps[0].childRunId, plan.generation!.snapshot.runId)
  assert.equal(await io.read(`.scholarflow/runs/${plan.generation!.snapshot.runId}/run.json`), undefined)
  await assert.rejects(action(io, sequenceId, 'next'), { code: 'DRAFT_SEQUENCE_AWAITING_ACCEPTANCE' })
})
