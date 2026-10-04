import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { runReview, inspectReview } from '../../src/core/review/review.ts'
import { prepareManualReview, submitManualReview } from '../../src/core/review/manual.ts'
import { prepareDelivery, createDelivery, readDelivery } from '../../src/core/export/delivery.ts'
import { digest } from '../../src/core/store/files.ts'

async function setup(type = 'course-paper') {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY unchanged source' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY manual review', type }))
  const current = await snapshot(io)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY manual text', researchQuestion: 'TEST_ONLY 本文表达什么？', thesis: 'TEST_ONLY 人工表达', confirmation: 'confirmed',
    sections: [{ id: 'section_TEST_ONLY', title: 'TEST_ONLY 陈述', purpose: 'TEST_ONLY 自己的文字', claimIds: [], missingEvidence: [] }] }, 0, 0)
  await saveManual(io, '# TEST_ONLY 人工稿\n\n## TEST_ONLY 陈述\n\nTEST_ONLY 这是不包含外部事实或实验的人工表达。\n', current.document.contentHash, 1)
  const review = await runReview(io, 2)
  return { io, review }
}
async function request(io: MemoryStore, reviewId: string, checkId = 'argument_assessment', status: 'pass' | 'fail' | 'unknown' = 'pass') {
  const current = await snapshot(io)
  return { context: { requestId: 'req_TEST_ONLY', projectId: current.ledger.projectId, workspaceId: 'workspace_TEST_ONLY', sessionId: 'session_TEST_ONLY', expectedLedgerRevision: current.ledger.revision }, reviewId,
    assessments: [{ checkId, status, reason: 'TEST_ONLY 已逐段核对这份人工文字，当前没有外部事实或实验结论。', evidenceIds: [], claimIds: [], requirementIds: [] }] }
}

test('SF-023/024: explicit manual review retains unknowns, archives original report, resolves only its checked issue, and does not edit the manuscript', async () => {
  const { io, review } = await setup(), before = [...io.files.entries()], body = (await snapshot(io)).document.text
  const plan = await prepareManualReview(io, await request(io, review.report.id))
  assert.deepEqual([...io.files.entries()], before)
  const result = await submitManualReview(io, plan, 'session_TEST_ONLY')
  assert.equal(result.report.checks.find(row => row.id === 'argument_assessment')!.method, 'manual')
  assert.equal(result.report.checks.find(row => row.id === 'style_assessment')!.status, 'unknown')
  assert.equal(result.ledger.reviewIssues[`issue_${digest('argument_assessment').slice(7, 31)}`].state, 'resolved')
  assert.equal(result.ledger.reviewIssues[`issue_${digest('style_assessment').slice(7, 31)}`].state, 'open')
  assert.equal(JSON.parse((await io.read(`.scholarflow/reviews/${review.report.id}/report.json`))!.text).checks.find((row: any) => row.id === 'argument_assessment').status, 'unknown')
  const artifact = JSON.parse((await io.read(`.scholarflow/reviews/manual/${plan.id}.json`))!.text)
  assert.equal(artifact.sourceSessionId, 'session_TEST_ONLY'); assert.equal(artifact.approvedPlanHash, plan.contentHash)
  assert.equal((await snapshot(io)).document.text, body); assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY unchanged source')
  assert.equal((await inspectReview(io)).stale, false)
})

test('manual review cannot certify missing experiments, deterministic failures, unselected evidence, or an expired manuscript', async () => {
  const { io, review } = await setup('research-paper')
  await assert.rejects(prepareManualReview(io, await request(io, review.report.id, 'own_research_results')), { code: 'MANUAL_REVIEW_UNAVAILABLE' })
  await assert.rejects(prepareManualReview(io, await request(io, review.report.id, 'body_nonempty')), { code: 'MANUAL_REVIEW_UNAVAILABLE' })
  const forged = await request(io, review.report.id); forged.assessments[0].evidenceIds = ['evidence_TEST_ONLY_missing'] as never[]
  await assert.rejects(prepareManualReview(io, forged), { code: 'MANUAL_REVIEW_INVALID' })
  const plan = await prepareManualReview(io, await request(io, review.report.id)), current = await snapshot(io)
  await saveManual(io, current.document.text + 'TEST_ONLY later edit\n', current.document.contentHash, current.ledger.revision)
  const before = [...io.files.entries()]
  await assert.rejects(submitManualReview(io, plan, 'session_TEST_ONLY'), { code: 'REVIEW_INPUT_CHANGED' })
  assert.deepEqual([...io.files.entries()], before)
})

test('AT-20/21/22: same-version completed checks permit an honest reviewed draft and a later adverse manual assessment reopens its issue', async () => {
  const { io, review } = await setup()
  const input = await request(io, review.report.id)
  input.assessments.push({ ...input.assessments[0], checkId: 'style_assessment' })
  const assessed = await submitManualReview(io, await prepareManualReview(io, input), 'session_TEST_ONLY')
  const plan = await prepareDelivery(io)
  assert.equal(plan.reviewedAllowed, true); assert.equal(plan.reviewState, 'draft-reviewed')
  const exported = await createDelivery(io, plan, 'reviewed-draft', assessed.revision)
  assert.equal(exported.manifest.reviewState, 'draft-reviewed')
  assert.match((await readDelivery(io, exported.manifest.id)).files.find(row => row.relativePath === 'quality-report.md')!.text, /pass · manual/u)
  const negative = await submitManualReview(io, await prepareManualReview(io, await request(io, assessed.report.id, 'style_assessment', 'fail')), 'session_TEST_ONLY')
  const issue = negative.ledger.reviewIssues[`issue_${digest('style_assessment').slice(7, 31)}`]
  assert.equal(issue.state, 'open'); assert.equal(issue.checkMethod, 'manual')
  assert.equal((await prepareDelivery(io)).reviewedAllowed, false)
})
