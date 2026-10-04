import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { readEditorBuffer, writeEditorBuffer } from '../../src/core/editing/buffer.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'

async function setup() { const io = new MemoryStore(); await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 未提交编辑', type: 'course-paper' })); return io }

test('SF-014/028: staged unsaved buffers persist per session without changing manuscript or ledger revision', async () => {
  const io = await setup(), original = await snapshot(io)
  const saved = await writeEditorBuffer(io, 'ses_TEST_ONLY_A', { text: 'TEST_ONLY 尚未提交的人工正文。\r\n', baseHash: original.document.contentHash, baseBufferHash: null, state: 'dirty' })
  const restored = await readEditorBuffer(io, 'ses_TEST_ONLY_A')
  assert.equal(restored.buffer!.text, saved.buffer.text); assert.equal(restored.bufferHash, saved.bufferHash)
  assert.equal((await readEditorBuffer(io, 'ses_TEST_ONLY_B')).buffer, undefined)
  assert.equal((await snapshot(io)).document.text, original.document.text); assert.equal((await snapshot(io)).ledger.revision, original.ledger.revision)
})

test('simultaneous pages cannot overwrite each other or auto-apply a stale staged buffer', async () => {
  const io = await setup(), original = await snapshot(io)
  const saved = await writeEditorBuffer(io, 'ses_TEST_ONLY', { text: 'TEST_ONLY 暂存一。', baseHash: original.document.contentHash, baseBufferHash: null, state: 'dirty' })
  await assert.rejects(writeEditorBuffer(io, 'ses_TEST_ONLY', { text: 'TEST_ONLY 另一个旧页面。', baseHash: original.document.contentHash, baseBufferHash: null, state: 'dirty' }), { code: 'EDITOR_BUFFER_CONFLICT' })
  await saveManual(io, 'TEST_ONLY 后来的人工正文。', original.document.contentHash, 0)
  const pending = await readEditorBuffer(io, 'ses_TEST_ONLY')
  await assert.rejects(saveManual(io, pending.buffer!.text, pending.buffer!.baseHash, 1), { code: 'STALE_DOCUMENT_VERSION' })
  assert.equal((await snapshot(io)).document.text, 'TEST_ONLY 后来的人工正文。')
  await writeEditorBuffer(io, 'ses_TEST_ONLY', { text: '', baseHash: (await snapshot(io)).document.contentHash, baseBufferHash: saved.bufferHash, state: 'cleared' })
  assert.equal((await readEditorBuffer(io, 'ses_TEST_ONLY')).buffer!.state, 'cleared')
})
