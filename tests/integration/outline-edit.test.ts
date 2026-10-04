import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { saveOutline, confirmOutline, outlineProjection } from '../../src/core/evidence/evidence.ts'
import { buildProposal, storeProposal } from '../../src/core/editing/proposals.ts'

async function setup() {
  const io = new MemoryStore(); await initialize(io, await prepareInit(io, { title: 'TEST_ONLY outline', type: 'course-paper' }))
  const outline = { ...(await snapshot(io)).ledger.outline, researchQuestion: 'TEST_ONLY question', thesis: 'TEST_ONLY thesis', sections: [
    { id: 'sec_TEST_ONLY_a', title: 'TEST_ONLY a', purpose: 'TEST_ONLY', claimIds: [], missingEvidence: ['TEST_ONLY no evidence'] },
    { id: 'sec_TEST_ONLY_b', title: 'TEST_ONLY b', purpose: 'TEST_ONLY', claimIds: [], missingEvidence: ['TEST_ONLY no evidence'] },
  ] }
  return { io, outline }
}

test('editable outline versions preserve history, draft/confirm gates, trees, order and manuscript bytes', async () => {
  const { io, outline } = await setup(), before = (await snapshot(io)).document.text
  const first = await confirmOutline(io, outline, 0, 0)
  const second = await saveOutline(io, { ...first.outline, sections: [{ ...first.outline.sections[1], targetLength: { value: 120, unit: 'zh-characters' } },
    first.outline.sections[0], { ...first.outline.sections[0], id: 'sec_TEST_ONLY_child', parentId: 'sec_TEST_ONLY_a', title: 'TEST_ONLY child' }] }, first.revision, 1, 'draft')
  assert.equal(second.outline.confirmation, 'draft'); assert.equal(second.outline.version, 2)
  assert.equal((await io.read('.scholarflow/planning/outline.md'))!.text, outlineProjection(second.outline))
  const third = await confirmOutline(io, { ...second.outline, sections: second.outline.sections.filter(row => row.id === 'sec_TEST_ONLY_b') }, second.revision, 2)
  assert.equal(third.outline.version, 3); assert.equal(third.outline.confirmation, 'confirmed')
  const history = await io.list('.scholarflow/planning/outline-history')
  assert.equal(history.length, 3)
  const secondHistory = (await Promise.all(history.map(async row => JSON.parse((await io.read(row.path))!.text)))).find(row => row.outline.version === 2)
  assert.deepEqual(secondHistory.previous, first.outline); assert.deepEqual(secondHistory.outline, second.outline)
  assert.equal((await snapshot(io)).document.text, before)
})

test('a changed outline expires whole/section candidates without deleting prior versions or changing body', async () => {
  const { io, outline } = await setup(), first = await confirmOutline(io, outline, 0, 0), current = await snapshot(io)
  const proposal = buildProposal(current, { runId: 'run_TEST_ONLY', instruction: 'TEST_ONLY', replacementText: 'TEST_ONLY pending whole candidate', dependentEvidenceIds: [] })
  const stored = await storeProposal(io, proposal, first.revision), original = (await io.read(`.scholarflow/proposals/${proposal.id}.json`))!.text
  await saveOutline(io, { ...first.outline, sections: first.outline.sections.slice(1) }, stored.revision, 1, 'draft')
  assert.equal((await snapshot(io)).ledger.proposalStates[proposal.id].state, 'stale')
  assert.equal((await io.read(`.scholarflow/proposals/${proposal.id}.json`))!.text, original)
  assert.equal((await snapshot(io)).document.text, current.document.text)
})

test('stale edits, orphan parents and external outline projections cannot overwrite saved history', async () => {
  const { io, outline } = await setup(), first = await confirmOutline(io, outline, 0, 0), before = (await snapshot(io)).ledgerHash
  await assert.rejects(saveOutline(io, outline, first.revision, 0, 'draft'), { code: 'STALE_OUTLINE_VERSION' })
  await assert.rejects(saveOutline(io, { ...first.outline, sections: [{ ...first.outline.sections[0], parentId: 'sec_TEST_ONLY_missing' }] }, first.revision, 1, 'draft'), { code: 'OUTLINE_INVALID' })
  io.externalEdit('.scholarflow/planning/outline.md', 'TEST_ONLY user external outline notes')
  await assert.rejects(confirmOutline(io, first.outline, first.revision, 1), { code: 'OUTLINE_PROJECTION_CHANGED' })
  assert.equal((await snapshot(io)).ledgerHash, before)
  assert.equal((await io.read('.scholarflow/planning/outline.md'))!.text, 'TEST_ONLY user external outline notes')
})

test('automatic confirmation invalidation does not make an untouched readable projection a false conflict', async () => {
  const { io, outline } = await setup(), first = await confirmOutline(io, outline, 0, 0)
  const invalidated = await mutateLedger(io, first.revision, ledger => { ledger.outline.confirmation = 'draft' })
  const current = await snapshot(io)
  const result = await confirmOutline(io, current.ledger.outline, invalidated.revision, 1)
  assert.equal(result.outline.confirmation, 'confirmed'); assert.equal(result.outline.version, 2)
})
