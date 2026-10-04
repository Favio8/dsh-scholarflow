import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, updateProjectText } from '../../src/core/project/project.ts'
import { approvedMemory, MEMORY_APPROVALS } from '../../src/core/project/memory.ts'
import { digest } from '../../src/core/store/files.ts'
import { runReview, inspectReview } from '../../src/core/review/review.ts'

test('SF-018: external memory stays visible on disk but is not automatically injected until explicitly confirmed', async () => {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 记忆来源', type: 'course-paper' }))
  const current = await snapshot(io)
  const path = '.scholarflow/context/terminology.md', text = '# TEST_ONLY 外部编辑\nTEST_ONLY 未经确认的术语。\n'
  io.externalEdit(path, text)
  await assert.rejects(approvedMemory(io, current.ledger.projectId), { code: 'MEMORY_CONFIRMATION_REQUIRED' })
  assert.equal((await io.read(path))!.text, text)
  await updateProjectText(io, path, text, digest(text), 0, 'ses_TEST_ONLY')
  assert.equal((await approvedMemory(io, current.ledger.projectId)).terminology, text)
  const metadata = JSON.parse((await io.read(MEMORY_APPROVALS))!.text).entries[path]
  assert.equal(metadata.source, 'user'); assert.equal(metadata.sourceSessionId, 'ses_TEST_ONLY'); assert.ok(metadata.confirmedAt)
  assert.equal(metadata.contentHash, digest(text))
})

test('writing changes expire review and core decisions require outline reconfirmation', async () => {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 影响范围', type: 'course-paper' }))
  const review = await runReview(io, 0), profile = (await io.read('.scholarflow/profiles/writing.md'))!
  await updateProjectText(io, '.scholarflow/profiles/writing.md', profile.text + '\nTEST_ONLY 更简洁。\n', digest(profile.text), review.revision)
  assert.equal((await inspectReview(io)).stale, true)
  const decisions = (await io.read('.scholarflow/context/decisions.md'))!
  await updateProjectText(io, '.scholarflow/context/decisions.md', decisions.text + '\nTEST_ONLY 研究方向已改变。\n', digest(decisions.text), review.revision + 1, 'ses_TEST_ONLY')
  assert.equal((await snapshot(io)).ledger.outline.confirmation, 'draft')
})
