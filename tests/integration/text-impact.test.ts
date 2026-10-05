import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, updateProjectText } from '../../src/core/project/project.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { projectTextImpact } from '../../src/core/project/text-impact.ts'
import { digest } from '../../src/core/store/files.ts'

test('terminology changes identify literal affected chapters without modifying the manuscript or silently confirming the outline', async () => {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 影响', type: 'course-paper' }))
  const initial = await snapshot(io)
  await confirmOutline(io, { ...initial.ledger.outline, researchQuestion: 'TEST_ONLY 术语在哪里？', thesis: '核对当前正文', sections: [
    { id: 'sec_TEST_ONLY_A', title: '范围甲', purpose: '包含术语', claimIds: [], missingEvidence: [] },
    { id: 'sec_TEST_ONLY_B', title: '范围乙', purpose: '无术语', claimIds: [], missingEvidence: [] },
  ] }, initial.ledger.revision, 0)
  let saved = await snapshot(io)
  await saveManual(io, '# TEST_ONLY\n\n## 范围甲\n\n使用 NE 术语。\n\n## 范围乙\n\n保留其他人工内容。\n', saved.document.contentHash, saved.ledger.revision)
  saved = await snapshot(io)
  const path = '.scholarflow/context/terminology.md', before = (await io.read(path))!.text
  const result = await updateProjectText(io, path, '# 已确认术语\n\nNE → 新名称\n', digest(before), saved.ledger.revision, 'session_TEST_ONLY')
  assert.deepEqual(result.impact!.sections.map(section => section.sectionId), ['sec_TEST_ONLY_A'])
  assert.equal((await snapshot(io)).document.text, saved.document.text)
  assert.equal(result.impact!.outlineNeedsConfirmation, false)
  const current = await snapshot(io), decisions = '.scholarflow/context/decisions.md'
  const changed = await updateProjectText(io, decisions, '# 已确认决定\n\nTEST_ONLY 改用按应用分类。\n', digest((await io.read(decisions))!.text), current.ledger.revision, 'session_TEST_ONLY')
  assert.equal(changed.impact!.outlineNeedsConfirmation, true)
  assert.equal((await snapshot(io)).ledger.outline.confirmation, 'draft')
  assert.equal((await snapshot(io)).document.text, saved.document.text)
  assert.equal(projectTextImpact(current.ledger, current.document.text, path, before, before).changed, false)
})
