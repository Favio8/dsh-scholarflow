import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { runReview } from '../../src/core/review/review.ts'

// A course paper now carries a 300-character abstract and a keyword line, and its target is
// still a body target. Before the body counting policy existed, that abstract pushed every
// short paper over the 1.1x ceiling and the review reported a length problem that was not
// there. This is the case that used to fail.

const ABSTRACT = '摘'.repeat(300)

async function setup(bodyCharacters: number) {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY unchanged source' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 课程论文', type: 'course-paper' }))
  const current = await snapshot(io)
  const body = '正'.repeat(bodyCharacters)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY 课程论文', researchQuestion: 'TEST_ONLY 问题', thesis: 'TEST_ONLY 观点', confirmation: 'confirmed',
    sections: [{ id: 'section_abstract', title: '摘要', purpose: 'TEST_ONLY 摘要', claimIds: [], missingEvidence: [], kind: 'front' },
      { id: 'section_body', title: '正文', purpose: 'TEST_ONLY 正文', claimIds: [], missingEvidence: [], kind: 'body' },
      { id: 'section_thanks', title: '致谢', purpose: 'TEST_ONLY 致谢', claimIds: [], missingEvidence: [], kind: 'back' }] }, 0, 0)
  await saveManual(io, `# TEST_ONLY 课程论文\n\n## 摘要\n\n${ABSTRACT}\n\n## 关键词\n\n课程论文；结构\n\n## 正文\n\n${body}\n\n## 致谢\n\n谢谢。\n`,
    current.document.contentHash, 1)
  // The constraint the writing task writes for a 2000-character target (v1.2 §4.2).
  const revision = (await snapshot(io)).ledger.revision
  await mutateLedger(io, revision, ledger => { ledger.requirements.writing_length = { id: 'writing_length', kind: 'length',
    description: '目标篇幅约 2000 汉字', origin: { type: 'user' }, confirmation: 'confirmed', verificationMethod: 'deterministic', confirmedAt: '2026-10-09T00:00:00.000Z',
    constraint: { operator: 'min', value: 1800, unit: 'zh-characters', countingPolicyId: 'sf-body-han-western-v1' } }
  ledger.requirements.writing_length_max = { ...ledger.requirements.writing_length, id: 'writing_length_max',
    constraint: { operator: 'max', value: 2200, unit: 'zh-characters', countingPolicyId: 'sf-body-han-western-v1' } } })
  return { io, review: await runReview(io, (await snapshot(io)).ledger.revision) }
}

const lengthChecks = (review: Awaited<ReturnType<typeof setup>>['review']) =>
  review.report.checks.filter(check => check.id.startsWith('requirement_writing_length'))

test('a 300-character abstract no longer pushes a 2000-character paper over its ceiling', async () => {
  const { review } = await setup(2000)
  assert.deepEqual(lengthChecks(review).map(check => [check.id, check.status]),
    [['requirement_writing_length', 'pass'], ['requirement_writing_length_max', 'pass']])
  // The reported count is the body count: title 4 + 正文 heading 2 + body 2000, with the
  // 300-character abstract, the keyword line and the acknowledgement left out.
  assert.equal(review.report.statistics.chineseCharacters, 2006)
  assert.match(lengthChecks(review)[0]!.detail, /排除摘要/)
})

test('a body that really is too short still fails, with the abstract excluded from the count', async () => {
  const { review } = await setup(1200)
  assert.deepEqual(lengthChecks(review).map(check => [check.id, check.status]),
    [['requirement_writing_length', 'fail'], ['requirement_writing_length_max', 'pass']])
})

test('a body that really is too long still fails', async () => {
  const { review } = await setup(2400)
  assert.deepEqual(lengthChecks(review).map(check => [check.id, check.status]),
    [['requirement_writing_length', 'pass'], ['requirement_writing_length_max', 'fail']])
})
