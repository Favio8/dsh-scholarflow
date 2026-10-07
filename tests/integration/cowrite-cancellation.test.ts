import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { proposeCowrite } from '../../src/core/editing/cowrite.ts'

test('cancellation while waiting for persistence never publishes a late proposal', async () => {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY cancelled rewrite', type: 'course-paper' }))
  const before = await snapshot(io), controller = new AbortController(), lock = io.lock.bind(io)
  io.lock = async operation => { controller.abort(new Error('TEST_ONLY stopped while queued')); return lock(operation) }
  await assert.rejects(proposeCowrite(io, 'session_TEST_ONLY', { text: 'TEST_ONLY 原文', baseDocumentHash: before.document.contentHash,
    start: 0, end: 12, replacementText: 'TEST_ONLY 候选', instruction: 'TEST_ONLY', action: 'polish' }, controller.signal), /stopped while queued/)
  assert.equal([...io.files.keys()].filter(path => path.includes('/suggestions/')).length, 0)
  assert.equal((await snapshot(io)).document.contentHash, before.document.contentHash)
})
