import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { deliveredText, textOf } from '../fixtures/delivery-artifacts.ts'
import { initialize, prepareInit, snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { runReview, inspectReview, decideIssue } from '../../src/core/review/review.ts'
import { prepareDelivery, createDelivery, readDelivery } from '../../src/core/export/delivery.ts'
import { registerSource } from '../../src/core/evidence/evidence.ts'
import { digest } from '../../src/core/store/files.ts'

async function setup(type = 'course-paper') {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 版本化审查导出', type }))
  const current = await snapshot(io)
  await saveManual(io, '# TEST_ONLY 正文\n\nTEST_ONLY 未完成 [待补：真实内容]。\n', current.document.contentHash, 0)
  return io
}

test('AT-20: issues resolve only after matching deterministic recheck and immutable history remains', async () => {
  const io = await setup(), first = await runReview(io, 1)
  const issue = first.report.issues.find(issue => issue.category === 'integrity')!
  assert.equal(issue.state, 'open')
  const current = await snapshot(io)
  await saveManual(io, '# TEST_ONLY 正文\n\nTEST_ONLY 已人工补充内容。\n', current.document.contentHash, first.revision)
  assert.equal((await snapshot(io)).ledger.reviewIssues[issue.id].state, 'open')
  assert.equal((await inspectReview(io)).stale, true)
  const second = await runReview(io, first.revision + 1)
  assert.equal(second.ledger.reviewIssues[issue.id].state, 'resolved')
  const historical = JSON.parse((await io.read(`.scholarflow/reviews/${first.report.id}/report.json`))!.text)
  assert.equal(historical.issues.find((item: any) => item.id === issue.id).state, 'open')
  assert.equal((await inspectReview(io)).stale, false)
})

test('AT-21: absent own research results stays B0 even when dismissed, with reason retained in working draft', async () => {
  const io = await setup('research-paper'), review = await runReview(io, 1)
  const issue = review.report.issues.find(issue => issue.severity === 'B0' && issue.checkMethod === 'manual')!
  await assert.rejects(decideIssue(io, issue.id, 'dismissed', '', review.revision), { code: 'RESOLUTION_REASON_REQUIRED' })
  await decideIssue(io, issue.id, 'dismissed', 'TEST_ONLY 只提交工作草稿，等待实验。', review.revision)
  const plan = await prepareDelivery(io)
  assert.equal(plan.reviewedAllowed, false)
  await assert.rejects(createDelivery(io, plan, 'reviewed-draft', review.revision + 1), { code: 'REVIEW_NOT_READY' })
  const exported = await createDelivery(io, plan, 'working-draft', review.revision + 1)
  assert.equal(exported.manifest.reviewState, 'draft-incomplete')
  const read = await readDelivery(io, exported.manifest.id), report = deliveredText(read.files, 'quality-report.md')
  assert.ok(report.includes(issue.id)); assert.ok(report.includes('B0 · dismissed')); assert.ok(report.includes('等待实验'))
  assert.ok(report.includes('unknown · model-assisted'))
})

test('AT-22: all immutable exported files match one revision without changing the manuscript', async () => {
  const io = await setup(), source = await registerSource(io, { kind: 'paper', title: 'TEST_ONLY 来源', authors: [{ literal: 'TEST_ONLY 作者' }], identifiers: {} }, 1)
  const before = await snapshot(io), text = `# TEST_ONLY 正文\n\nTEST_ONLY 来源 [@${source.source.citeKey}]。\n`
  await saveManual(io, text, before.document.contentHash, source.revision)
  const review = await runReview(io, source.revision + 1), plan = await prepareDelivery(io)
  const result = await createDelivery(io, plan, 'working-draft', review.revision)
  const delivery = await readDelivery(io, result.manifest.id)
  assert.equal(deliveredText(delivery.files, 'paper.md'), text)
  assert.equal(result.manifest.documentHash, digest(text)); assert.equal(result.manifest.revisionId, plan.revisionId)
  assert.equal(result.manifest.ledgerRevision, plan.ledgerRevision)
  for (const file of delivery.files) { const content = textOf(file); assert.equal(file.hash, digest(content)); assert.equal(file.sizeBytes, Buffer.byteLength(content)) }
  assert.ok(deliveredText(delivery.files, 'references.bib').includes(source.source.citeKey))
  assert.ok(deliveredText(delivery.files, 'quality-report.md').includes(plan.revisionId))
  assert.equal((await snapshot(io)).document.text, text)
  assert.equal((await inspectReview(io)).stale, false, 'delivery persistence must not expire the review')
  const secondPlan = await prepareDelivery(io), second = await createDelivery(io, secondPlan, 'working-draft', result.revision)
  assert.notEqual(second.manifest.id, result.manifest.id)
  assert.deepEqual((await readDelivery(io, result.manifest.id)).files, delivery.files)
})

test('preflight refuses unresolved citation keys and stale confirmation never publishes a delivery', async () => {
  const io = await setup(), plan = await prepareDelivery(io), current = await snapshot(io)
  await saveManual(io, 'TEST_ONLY later manual text', current.document.contentHash, current.ledger.revision)
  await assert.rejects(createDelivery(io, plan, 'working-draft', current.ledger.revision + 1), { code: 'EXPORT_PLAN_STALE' })
  assert.equal(Object.keys((await snapshot(io)).ledger.deliveries).length, 0)
  const source = await registerSource(io, { kind: 'paper', title: 'TEST_ONLY temporary source', authors: [], identifiers: {} }, current.ledger.revision + 1)
  const now = await snapshot(io)
  await saveManual(io, `TEST_ONLY [@${source.source.citeKey}]`, now.document.contentHash, source.revision)
  await mutateLedger(io, source.revision + 1, ledger => { delete ledger.sources[source.source.id] })
  const broken = await runReview(io, source.revision + 2)
  assert.ok(broken.report.issues.some(issue => issue.category === 'citation' && issue.severity === 'B0'))
  await assert.rejects(prepareDelivery(io), { code: 'CITATION_KEY_UNKNOWN' })
})

test('review detects raw file changes at unchanged ledger revision and rejects tampered delivery files', async () => {
  const io = await setup()
  io.externalEdit('TEST_ONLY.txt', 'TEST_ONLY source bytes')
  const { registerMaterial } = await import('../../src/core/materials/materials.ts')
  await registerMaterial(io, { relativePath: 'TEST_ONLY.txt', role: 'notes', confirmExcludedFile: false }, 1)
  const review = await runReview(io, 2), plan = await prepareDelivery(io)
  io.externalEdit('TEST_ONLY.txt', 'TEST_ONLY changed source bytes')
  assert.equal((await inspectReview(io)).stale, true)
  await assert.rejects(createDelivery(io, plan, 'working-draft', review.revision), { code: 'EXPORT_PLAN_STALE' })
  const fresh = await prepareDelivery(io), delivered = await createDelivery(io, fresh, 'working-draft', review.revision)
  io.externalEdit(`manuscript/exports/${delivered.manifest.id}/paper.md`, 'TEST_ONLY changed export')
  await assert.rejects(readDelivery(io, delivered.manifest.id), { code: 'DELIVERY_CHANGED' })
})
