// TEST_ONLY: saved facts and explicit gaps, no claims about real research.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { workflowGates } from '../../src/core/pipeline/workflow-gates.ts'
import { confirmOutline, registerSource, confirmEvidence } from '../../src/core/evidence/evidence.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { runReview } from '../../src/core/review/review.ts'
import { prepareDelivery, createDelivery } from '../../src/core/export/delivery.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
const goal = { researchQuestion: 'TEST_ONLY 如何保留已知缺口？', minimumSources: 1, minimumLocatedEvidence: 1,
  noFormalRequirementsReason: 'TEST_ONLY 该功能测试没有外部课程要求，保留研究真实性约束。' }
async function setup() {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY untouched raw' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY seven gates', type: 'research-paper' }))
  return io
}
test('seven workflow gates use actual saved facts; no requirements declaration, empty evidence, placeholder body or elapsed model calls can claim completion', async () => {
  const io = await setup(), writes = io.writes
  const first = await workflowGates(io, { ...goal, noFormalRequirementsReason: undefined })
  assert.equal(first.gates.length, 7); assert.equal(first.gates[0].canComplete, false)
  const declared = await workflowGates(io, goal)
  assert.equal(declared.gates[0].canComplete, true); assert.equal(declared.gates[1].outcome, 'insufficient')
  assert.equal(declared.gates[2].canComplete, false); assert.equal(declared.gates[3].canComplete, false)
  assert.equal(declared.gates[4].canComplete, false); assert.equal(declared.gates[5].canSkip, false); assert.equal(declared.gates[6].canComplete, false)
  assert.equal(io.writes, writes)
})
test('confirmed outline and saved structural chapters preserve evidence gaps and never imply research-paper results or reviewed delivery', async () => {
  const io = await setup(), current = await snapshot(io)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: goal.researchQuestion, thesis: 'TEST_ONLY 不编造结果', confirmation: 'draft',
    sections: [{ id: 'sec_TEST_ONLY', title: '真实结果待补', purpose: '限定范围', claimIds: [], missingEvidence: ['TEST_ONLY 没有真实实验结果'] }] }, current.ledger.revision, 0)
  let observed = await workflowGates(io, goal)
  assert.equal(observed.gates[2].canComplete, true); assert.equal(observed.gates[3].canComplete, false)
  assert.equal((await workflowGates(io, { ...goal, researchQuestion: 'TEST_ONLY 另一项不同研究问题' })).gates[2].canComplete, false)
  const before = await snapshot(io)
  await saveManual(io, '# TEST_ONLY\n\n## 真实结果待补\n\n[待补：真实实验与记录；TEST_ONLY 尚未完成。]\n', before.document.contentHash, before.ledger.revision)
  observed = await workflowGates(io, goal)
  assert.equal(observed.gates[3].canComplete, true); assert.equal(observed.gates[3].outcome, 'with-issues'); assert.equal(observed.sections[0].hasCurrentEvidence, false)
  await runReview(io, observed.current.ledger.revision)
  observed = await workflowGates(io, goal)
  assert.equal(observed.gates[4].canComplete, true); assert.equal(observed.gates[4].outcome, 'with-issues'); assert.equal(observed.gates[5].canSkip, false)
  const delivery = await prepareDelivery(io)
  assert.equal(delivery.reviewedAllowed, false)
  await createDelivery(io, delivery, 'working-draft', observed.current.ledger.revision)
  observed = await workflowGates(io, goal)
  assert.equal(observed.gates[6].canComplete, true); assert.equal(observed.gates[6].outcome, 'with-issues')
  assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY untouched raw')
})
test('Profile and body changes alter the affected gates without invalidating confirmed requirements or outline fingerprints', async () => {
  const io = await setup(), current = await snapshot(io)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: goal.researchQuestion, thesis: 'TEST_ONLY', confirmation: 'draft',
    sections: [{ id: 'sec_TEST_ONLY', title: '正文', purpose: '', claimIds: [], missingEvidence: [] }] }, current.ledger.revision, 0)
  const first = await workflowGates(io, goal)
  const profile = '.scholarflow/profiles/writing.md'; io.externalEdit(profile, (await io.read(profile))!.text + '\nTEST_ONLY 文风更正。\n')
  const changed = await workflowGates(io, goal)
  assert.equal(changed.gates[0].fingerprint, first.gates[0].fingerprint); assert.equal(changed.gates[1].fingerprint, first.gates[1].fingerprint)
  assert.equal(changed.gates[2].fingerprint, first.gates[2].fingerprint); assert.notEqual(changed.gates[3].fingerprint, first.gates[3].fingerprint)
  io.externalEdit('.scholarflow/context/decisions.md', '# TEST_ONLY 改变方案\n')
  const decision = await workflowGates(io, goal)
  assert.notEqual(decision.gates[2].fingerprint, changed.gates[2].fingerprint)
})
test('research coverage requires actual selected text versions and located evidence; metadata or externally changed raw files never satisfy the goal', async () => {
  const io = await setup(), material = await registerMaterial(io, { relativePath: 'raw.txt', role: 'notes', confirmExcludedFile: false }, (await snapshot(io)).ledger.revision)
  const parsed = await parseRegisteredMaterial(io, material.material.id, material.revision, new AbortController().signal,
    (bytes, mediaType) => parseMaterialBytes(bytes, mediaType, new AbortController().signal))
  const source = await registerSource(io, { title: 'TEST_ONLY 本地资料', authors: [], kind: 'other', identifiers: {}, materialId: material.material.id }, parsed.revision)
  assert.equal((await workflowGates(io, goal)).gates[1].outcome, 'insufficient')
  await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash, locator: parsed.parsed.blocks[0].locator,
    excerpt: parsed.parsed.blocks[0].text, kind: 'quotation' }, source.revision)
  const covered = await workflowGates(io, goal)
  assert.equal(covered.gates[1].outcome, 'ready')
  io.externalEdit('raw.txt', 'TEST_ONLY external replacement version')
  const stale = await workflowGates(io, goal)
  assert.equal(stale.gates[1].outcome, 'insufficient'); assert.notEqual(stale.gates[1].fingerprint, covered.gates[1].fingerprint)
  assert.equal(stale.gates[3].canComplete, false)
})
