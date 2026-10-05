// TEST_ONLY provenance fixtures, not real user decisions or academic results.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, updateProjectText } from '../../src/core/project/project.ts'
import { memoryEntryProjection, memoryHistory, verifiedMemoryProjection } from '../../src/core/project/memory-entries.ts'
import { approvedMemory } from '../../src/core/project/memory.ts'
import { digest, type FileImage } from '../../src/core/store/files.ts'
import { recover } from '../../src/core/store/transactions.ts'
const path = '.scholarflow/context/terminology.md'
async function setup(io = new MemoryStore({ 'raw.txt': 'TEST_ONLY 原始资料' })) {
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 记忆条目', type: 'course-paper' })); return io
}
async function save(io: MemoryStore, text: string, session = 'session_A_TEST_ONLY', reason = 'TEST_ONLY 用户明确确认术语和更正。') {
  const before = await io.read(path), current = await snapshot(io)
  return updateProjectText(io, path, text, digest(before!.text), current.ledger.revision, session, reason)
}
test('Markdown remains the sole text authority; each confirmed paragraph gets user operation, session, time, kind and exact source bytes', async () => {
  const io = await setup(), body = (await snapshot(io)).document.text, text = '# TEST_ONLY\r\n\r\n术语甲：定义甲 😀。\r\n\r\n术语乙：定义乙。\r\n'
  await save(io, text)
  const current = await snapshot(io), projection = memoryEntryProjection(current.ledger, path, text)
  assert.equal(projection.current, true); assert.equal(projection.entries.length, 2)
  for (const entry of projection.entries) {
    assert.equal(entry.kind, 'terminology'); assert.equal(entry.state, 'confirmed'); assert.equal(entry.sourceSessionId, 'session_A_TEST_ONLY')
    assert.equal(entry.source, 'user-operation'); assert.ok(entry.confirmedAt)
    assert.equal(digest(text.slice(entry.startUtf16, entry.endUtf16)), entry.textHash)
    assert.equal(entry.originContentHash, digest(text)); assert.match(entry.sourceOperationId, /^memory_change_/)
  }
  assert.equal((await io.read(path))!.text, text); assert.equal((await snapshot(io)).document.text, body)
  assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY 原始资料')
  const other = await setup(); assert.equal((await snapshot(other)).ledger.memoryFiles, undefined)
})
test('corrections preserve uniquely unchanged provenance and archive original text, replaced IDs and the new operator reason', async () => {
  const io = await setup(), first = '# TEST_ONLY\n\n术语甲：错误定义。\n\n术语乙：保持原样。\n'
  await save(io, first)
  const old = (await snapshot(io)).ledger.memoryFiles![path]!
  const corrected = '# TEST_ONLY\n\n术语甲：用户更正定义。\n\n术语乙：保持原样。\n'
  await save(io, corrected, 'session_B_TEST_ONLY', 'TEST_ONLY 用户核对后更正术语甲。')
  const next = (await snapshot(io)).ledger.memoryFiles![path]!
  assert.notEqual(next.entries[0].id, old.entries[0].id); assert.equal(next.entries[0].sourceSessionId, 'session_B_TEST_ONLY')
  assert.equal(next.entries[1].id, old.entries[1].id); assert.equal(next.entries[1].sourceSessionId, 'session_A_TEST_ONLY')
  const history = await memoryHistory(io, (await snapshot(io)).ledger.projectId, path)
  assert.equal(history.operations.length, 2)
  const operation = history.operations.find(row => row.metadata.operationId === next.operationId)!
  assert.equal(operation.previousText, first); assert.equal(operation.text, corrected)
  assert.deepEqual(operation.supersededEntryIds, [old.entries[0].id]); assert.equal(operation.reason, 'TEST_ONLY 用户核对后更正术语甲。')
})
test('identical repeated entries cannot be guessed back to one previous user operation when one is removed', async () => {
  const io = await setup(), duplicate = '# TEST_ONLY\n\n重复术语。\n\n重复术语。\n'
  await save(io, duplicate)
  const old = (await snapshot(io)).ledger.memoryFiles![path]!
  assert.notEqual(old.entries[0].id, old.entries[1].id)
  await save(io, '# TEST_ONLY\n\n重复术语。\n', 'session_B_TEST_ONLY')
  const next = (await snapshot(io)).ledger.memoryFiles![path]!
  assert.equal(next.entries[0].sourceSessionId, 'session_B_TEST_ONLY'); assert.ok(!old.entries.some(entry => entry.id === next.entries[0].id))
})
test('external edits remain ordinary text with unverified provenance and cannot enter model memory until explicit new confirmation', async () => {
  const io = await setup(); await save(io, '# TEST_ONLY\n\n原已确认术语。\n')
  const before = (await snapshot(io)).ledger.memoryFiles![path]!, text = '# TEST_ONLY\n\n外部未确认术语。\n'
  io.externalEdit(path, text)
  const observed = await snapshot(io), writes = io.writes, projection = memoryEntryProjection(observed.ledger, path, text)
  assert.equal(projection.current, false); assert.deepEqual(projection.entries, []); assert.equal(io.writes, writes)
  await assert.rejects(approvedMemory(io, observed.ledger.projectId), { code: 'MEMORY_CONFIRMATION_REQUIRED' })
  await save(io, text, 'session_B_TEST_ONLY')
  const next = (await snapshot(io)).ledger.memoryFiles![path]!
  assert.notEqual(next.operationId, before.operationId); assert.equal(next.entries[0].sourceSessionId, 'session_B_TEST_ONLY')
  assert.equal((await approvedMemory(io, observed.ledger.projectId)).terminology, text)
})
test('opaque tables and code retain exact bytes; cold history rejects corrupted old snapshots without overwriting them', async () => {
  const io = await setup(), text = '# TEST_ONLY\n\n| 原词 | 约定 |\n|---|---|\n| a | b |\n\n```txt\nTEST_ONLY 原始代码字节\n```\n'
  await save(io, text)
  const cold = new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text]))), current = await snapshot(cold)
  const projection = memoryEntryProjection(current.ledger, path, text)
  assert.equal(projection.current, true); assert.equal(projection.entries.length, 2); assert.ok(projection.entries.every(entry => entry.representation === 'opaque'))
  const history = await memoryHistory(cold, current.ledger.projectId, path), recordPath = `.scholarflow/context/history/${history.operations[0].id}.json`
  const corrupt = { ...history.operations[0], previousText: 'TEST_ONLY 篡改旧稿' }
  cold.externalEdit(recordPath, JSON.stringify(corrupt)); const writes = cold.writes
  await assert.rejects(memoryHistory(cold, current.ledger.projectId, path), { code: 'MEMORY_HISTORY_INVALID' }); assert.equal(cold.writes, writes)
})
test('an interrupted memory save recovers its original text, provenance, approval and history together exactly once', async () => {
  class FaultStore extends MemoryStore {
    armed = false
    override async write(target: string, text: string, expected: FileImage | undefined) {
      const result = await super.write(target, text, expected)
      if (this.armed && target === path) { this.armed = false; throw new Error('TEST_ONLY process loss after Markdown write') }
      return result
    }
  }
  const io = await setup(new FaultStore()), text = '# TEST_ONLY\n\n中断后保留确认术语。\n'
  ;(io as FaultStore).armed = true
  await assert.rejects(save(io, text))
  await recover(io)
  const current = await snapshot(io), history = await memoryHistory(io, current.ledger.projectId, path)
  assert.equal(memoryEntryProjection(current.ledger, path, text).current, true)
  assert.equal(history.operations.length, 1); assert.equal(history.operations[0].metadata.operationId, current.ledger.memoryFiles![path]!.operationId)
  assert.equal((await approvedMemory(io, current.ledger.projectId)).terminology, text)
  await recover(io); assert.equal((await memoryHistory(io, current.ledger.projectId, path)).operations.length, 1)
})
test('missing or altered origin records cannot be presented as verified provenance; reconfirmation records the new user without inventing the lost origin', async () => {
  const io = await setup(), text = '# TEST_ONLY\n\n保留的术语。\n'
  await save(io, text)
  const current = await snapshot(io), old = current.ledger.memoryFiles![path]!
  assert.equal((await verifiedMemoryProjection(io, current.ledger, path, text)).current, true)
  io.files.delete(`.scholarflow/context/history/${old.operationId}.json`)
  const writes = io.writes, unknown = await verifiedMemoryProjection(io, current.ledger, path, text)
  assert.equal(unknown.current, false); assert.equal(unknown.entries.length, 0); assert.equal(io.writes, writes)
  await save(io, text, 'session_B_TEST_ONLY', 'TEST_ONLY 明确确认当前文本，无法证明旧来源。')
  const next = await snapshot(io), projection = await verifiedMemoryProjection(io, next.ledger, path, text)
  assert.equal(projection.current, true); assert.notEqual(projection.entries[0].id, old.entries[0].id)
  assert.equal(projection.entries[0].sourceSessionId, 'session_B_TEST_ONLY')
})
