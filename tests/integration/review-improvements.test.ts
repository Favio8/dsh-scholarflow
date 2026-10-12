import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { saveManual, buildProposal, storeProposal, rejectProposal, applyReviewImprovements } from '../../src/core/editing/proposals.ts'
import { inspectImprovements, acceptImprovementsAndRecheck } from '../../src/core/review/improvements.ts'
import { prepareModelReview, publishModelReview } from '../../src/core/review/model.ts'
import { inspectReview } from '../../src/core/review/review.ts'
import { flowNodes } from '../../src/client/flow-status.ts'
import { issueFixSelection } from '../../src/core/review/issue-fixes.ts'
import { sourceSchema, materialSchema } from '../../src/shared/schema.ts'
import { json, digest } from '../../src/core/store/files.ts'
import { reviewRunFinished } from '../../src/client/review-run-ui.ts'
import { runStateSchema } from '../../src/shared/runs.ts'
import { firstParagraph, secondParagraph, improvementOutput, improvementText } from '../fixtures/review-improvement-output.ts'

async function setup() {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY original input bytes' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 一键检查', type: 'course-paper' }))
  let current = await snapshot(io)
  await mutateLedger(io, current.ledger.revision, ledger => { ledger.sources.src_TEST_ONLY = sourceSchema.parse({ id: 'src_TEST_ONLY', citeKey: 'sf_TEST_ONLY',
    kind: 'paper', title: 'TEST_ONLY 已登记来源', authors: [], year: 2025, identifiers: {}, identity: { status: 'unverified', method: 'none' }, textAccess: 'metadata', provenance: [] }) })
  current = await snapshot(io)
  await saveManual(io, `# TEST_ONLY 文稿\r\n\r\n${firstParagraph}\r\n\r\n${secondParagraph}\r\n`, current.document.contentHash, current.ledger.revision)
  current = await snapshot(io)
  const plan = await prepareModelReview(io, { context: { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'session_TEST_ONLY', projectId: current.ledger.projectId,
    expectedLedgerRevision: current.ledger.revision }, assessmentScope: 'cross-section' }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' })
  await publishModelReview(io, plan, improvementOutput(plan))
  return { io, initial: await snapshot(io) }
}
async function prepare(io: MemoryStore) {
  const groups = (await inspectImprovements(io)).groups, refs = []
  for (const group of groups) {
    const current = await snapshot(io), selection = issueFixSelection(current, group.issueId)
    const proposal = buildProposal(current, { runId: 'run_TEST_ONLY_' + refs.length, instruction: group.instruction, reviewIssueId: group.issueId,
      selection, replacementText: improvementText(selection.sourceText), dependentEvidenceIds: [] })
    const image = await storeProposal(io, proposal, current.ledger.revision)
    refs.push({ proposalId: proposal.id, proposalHash: image.proposalHash })
  }
  return refs
}

test('true run terminals distinguish completion from pending findings and reject the invented completed status', () => {
  for (const status of runStateSchema.shape.status.options) assert.equal(reviewRunFinished(status), ['succeeded', 'completed-with-issues'].includes(status))
  assert.throws(() => runStateSchema.shape.status.parse('completed'))
})

test('current paragraph findings group into one candidate per paragraph, and pending candidates restore without generation', async () => {
  const { io, initial } = await setup(), plan = await inspectImprovements(io)
  assert.equal(plan.groups.length, 2)
  assert.equal(plan.groups[0].issueIds.length, 2)
  assert.match(plan.groups[0].instruction, /补充边界/u); assert.match(plan.groups[0].instruction, /精简第一段/u)
  await prepare(io)
  const restored = await inspectImprovements(io)
  assert.equal(restored.proposals.length, 2)
  assert.equal((await snapshot(io)).document.text, initial.document.text)
  assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY original input bytes')
})

test('one batch accepts two edits in one revision, preserves citations/CRLF and replay performs no writes', async () => {
  const { io, initial } = await setup(), refs = await prepare(io), current = await snapshot(io)
  const result = await acceptImprovementsAndRecheck(io, refs, current.ledger.revision), accepted = await snapshot(io)
  assert.equal(accepted.document.text, `# TEST_ONLY 文稿\r\n\r\n${improvementText(firstParagraph)}\r\n\r\n${improvementText(secondParagraph)}\r\n`)
  assert(accepted.document.text.includes('[@sf_TEST_ONLY]'))
  assert.equal(new Set(refs.map(ref => accepted.ledger.proposalStates[ref.proposalId].acceptedRevisionId)).size, 1)
  const manifest = JSON.parse((await io.read(`.scholarflow/drafts/${result.revisionId}/manifest.json`))!.text)
  assert.equal(manifest.parentRevisionId, initial.document.revisionId)
  assert.equal((await io.read(`.scholarflow/drafts/${result.revisionId}/preimage.md`))!.text, initial.document.text)
  assert((await inspectImprovements(io)).proposals.length === 0)
  assert.equal(flowNodes(accepted, { review: await inspectReview(io) }).find(node => node.id === 'review')!.label, '已采用')
  const writes = io.writes
  assert.equal((await acceptImprovementsAndRecheck(io, refs, accepted.ledger.revision)).alreadyApplied, true)
  assert.equal(io.writes, writes)
  assert(Object.values(accepted.ledger.reviewIssues).some(issue => issue.checkMethod === 'model-assisted' && issue.state !== 'resolved'), 'Adoption does not claim semantic verification')
})

test('keeping the manuscript rejects both candidates and restores issue state without editing text', async () => {
  const { io, initial } = await setup(), refs = await prepare(io)
  for (const ref of refs) await rejectProposal(io, ref.proposalId, (await snapshot(io)).ledger.revision)
  const current = await snapshot(io)
  assert.equal(current.document.text, initial.document.text)
  assert(refs.every(ref => current.ledger.proposalStates[ref.proposalId].state === 'rejected'))
  assert.equal((await inspectImprovements(io)).proposals.length, 0)
})

test('stale, changed-hash, rejected and overlapping batches cannot partially write a manuscript', async () => {
  for (const failure of ['stale', 'hash', 'rejected', 'overlap'] as const) {
    const { io } = await setup(), refs = await prepare(io)
    if (failure === 'stale') { const current = await snapshot(io); await saveManual(io, current.document.text + '\r\nTEST_ONLY 人工新增。', current.document.contentHash, current.ledger.revision) }
    if (failure === 'hash') refs[1].proposalHash = 'sha256:' + '0'.repeat(64)
    if (failure === 'rejected') await rejectProposal(io, refs[1].proposalId, (await snapshot(io)).ledger.revision)
    if (failure === 'overlap') {
      const current = await snapshot(io), image = (await inspectImprovements(io)).proposals[0], issueId = image.proposal.reviewIssue!.issueId
      const proposal = buildProposal(current, { runId: 'run_TEST_ONLY_overlap', instruction: 'TEST_ONLY overlapping preview', reviewIssueId: issueId,
        selection: issueFixSelection(current, issueId), replacementText: image.proposal.edits[0].replacementText, dependentEvidenceIds: [] })
      const stored = await storeProposal(io, proposal, current.ledger.revision)
      refs.push({ proposalId: proposal.id, proposalHash: stored.proposalHash })
    }
    const before = await snapshot(io), bytes = json(before.ledger)
    await assert.rejects(applyReviewImprovements(io, refs, before.ledger.revision))
    const after = await snapshot(io)
    assert.equal(after.document.text, before.document.text, failure); assert.equal(json(after.ledger), bytes, failure)
  }
})

test('foreign project and changed issue provenance leave the entire batch untouched', async () => {
  for (const failure of ['foreign', 'issue'] as const) {
    const { io } = await setup(), refs = await prepare(io)
    if (failure === 'foreign') {
      const other = await setup(), foreign = await prepare(other.io)
      const ref = foreign[1]
      io.externalEdit(`.scholarflow/proposals/${ref.proposalId}.json`, (await other.io.read(`.scholarflow/proposals/${ref.proposalId}.json`))!.text)
      const current = await snapshot(io)
      await mutateLedger(io, current.ledger.revision, ledger => { ledger.proposalStates[ref.proposalId] = { proposalId: ref.proposalId, state: 'pending', updatedAt: 'TEST_ONLY' } })
      refs[1] = ref
    } else {
      const current = await snapshot(io), proposal = (await inspectImprovements(io)).proposals[1].proposal
      await mutateLedger(io, current.ledger.revision, ledger => { ledger.reviewIssues[proposal.reviewIssue!.issueId].suggestedFix = 'TEST_ONLY changed finding' })
      assert.equal((await inspectImprovements(io)).proposals.length, 1, 'A changed cause is not presented as a reusable preview')
    }
    const before = await snapshot(io)
    await assert.rejects(applyReviewImprovements(io, refs, before.ledger.revision))
    assert.equal((await snapshot(io)).document.text, before.document.text)
    assert.equal((await snapshot(io)).document.revisionId, before.document.revisionId)
  }
})

test('unmodified paragraph formatting moves with batch edits instead of being dropped', async () => {
  const { io } = await setup(), current = await snapshot(io)
  const tail = '\r\nTEST_ONLY 未改段落。\r\n'
  await saveManual(io, current.document.text + tail, current.document.contentHash, current.ledger.revision)
  let next = await snapshot(io)
  const start = next.document.text.indexOf('TEST_ONLY 未改段落。')
  await mutateLedger(io, next.ledger.revision, ledger => { ledger.documents.paper.formatting = { characters: [{ start, end: start + 'TEST_ONLY 未改段落。'.length, fontEn: 'Arial' }], paragraphs: [] } })
  next = await snapshot(io)
  const plan = await prepareModelReview(io, { context: { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'session_TEST_ONLY', projectId: next.ledger.projectId, expectedLedgerRevision: next.ledger.revision }, assessmentScope: 'cross-section' }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' })
  await publishModelReview(io, plan, improvementOutput(plan))
  const refs = await prepare(io)
  await applyReviewImprovements(io, refs, (await snapshot(io)).ledger.revision)
  const saved = await snapshot(io), range = saved.document.formatting!.characters[0]
  assert.equal(range.fontEn, 'Arial'); assert.equal(saved.document.text.slice(range.start, range.end), 'TEST_ONLY 未改段落。')
})

test('complete selected source text is not presented as missing material solely for a pending evidence check', async () => {
  const { io } = await setup(), current = await snapshot(io), contentHash = digest((await io.read('raw.txt'))!.text)
  await mutateLedger(io, current.ledger.revision, ledger => {
    ledger.materials.mat_TEST_ONLY = materialSchema.parse({ id: 'mat_TEST_ONLY', projectRelativePath: 'raw.txt', role: 'paper', mediaType: 'text/plain', sizeBytes: 30, contentHash, parseStatus: 'ready', parsedRanges: [] })
    ledger.sources.src_TEST_ONLY = { ...ledger.sources.src_TEST_ONLY, textAccess: 'fulltext', materialId: 'mat_TEST_ONLY', contentHash }
  })
  const image = await snapshot(io)
  io.externalEdit('.scholarflow/project.yaml', (await io.read('.scholarflow/project.yaml'))!.text.replace('include: []', 'include:\n    - raw.txt'))
  const selected = await snapshot(io), plan = await prepareModelReview(io, { context: { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'session_TEST_ONLY', projectId: image.ledger.projectId, expectedLedgerRevision: selected.ledger.revision }, assessmentScope: 'cross-section' }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' })
  await publishModelReview(io, plan, improvementOutput(plan))
  assert.equal((await inspectImprovements(io)).needsMaterials, false)
})
