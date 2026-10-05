import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readScratch, writeScratch, scratchKey, ScratchQueue } from '../../src/client/scratch-backup.ts'

const hash = `sha256:${'1'.repeat(64)}`
function storage() {
  const rows = new Map<string, string>()
  return { rows, getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
}
test('the last explicit Unicode edit survives a new page object and remains isolated by actual root, project, session and document', () => {
  const store = storage(), binding = { rootFingerprint: hash, projectId: 'prj_TEST_ONLY_A', sessionId: 'ses_TEST_ONLY_A' }, key = scratchKey(binding, 'paper')
  const edit = { text: '\uFEFFTEST_ONLY 中文最后按键𐐀。\r\n', baseHash: hash }
  writeScratch(store, key, edit, 65536)
  assert.deepEqual(readScratch({ ...store }, key, 65536), edit)
  for (const foreign of [scratchKey({ ...binding, rootFingerprint: `sha256:${'2'.repeat(64)}` }, 'paper'),
    scratchKey({ ...binding, projectId: 'prj_TEST_ONLY_B' }, 'paper'), scratchKey({ ...binding, sessionId: 'ses_TEST_ONLY_B' }, 'paper'), scratchKey(binding, 'another-file')])
    assert.equal(readScratch(store, foreign, 65536), undefined)
  store.rows.set('forged-scope', store.rows.get(key)!)
  assert.equal(readScratch(store, 'forged-scope', 65536), undefined)
  assert.throws(() => writeScratch(store, key, { text: '\ud800', baseHash: hash }, 65536))
  assert.throws(() => writeScratch(store, key, { text: '中'.repeat(22000), baseHash: hash }, 65536))
  assert.deepEqual(readScratch(store, key, 65536), edit)
  writeScratch(store, key, undefined, 65536); assert.equal(readScratch(store, key, 65536), undefined)
})
test('storage denial is surfaced before removing an existing uncommitted copy', () => {
  const store = storage(), key = 'TEST_ONLY-scratch', edit = { text: 'TEST_ONLY old', baseHash: hash }
  writeScratch(store, key, edit, 65536)
  assert.throws(() => writeScratch({ ...store, setItem: () => { throw new Error('TEST_ONLY quota exceeded') } }, key, { ...edit, text: 'TEST_ONLY new' }, 65536))
  assert.deepEqual(readScratch(store, key, 65536), edit)
})
test('a slow Host receives the first and latest edits in order without dispatching an obsolete middle edit', async () => {
  const writes: string[] = [], releases: (() => void)[] = []
  const queue = new ScratchQueue<string>(async text => { writes.push(text); await new Promise<void>(resolve => releases.push(resolve)) }, error => { throw error })
  queue.enqueue('TEST_ONLY first'); queue.enqueue('TEST_ONLY middle'); queue.enqueue('TEST_ONLY last')
  assert.deepEqual(writes, ['TEST_ONLY first']); assert.equal(queue.busy, true)
  releases.shift()!(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(writes, ['TEST_ONLY first', 'TEST_ONLY last'])
  releases.shift()!(); await queue.flush(); assert.equal(queue.busy, false)
})
test('a lost acknowledgement stops all dispatch; explicit reread never replays the old pending request', async () => {
  const writes: string[] = [], errors: unknown[] = []
  let reject!: (error: Error) => void
  const queue = new ScratchQueue<string>(async text => { writes.push(text); if (writes.length === 1) await new Promise<void>((_resolve, fail) => { reject = fail }) }, error => errors.push(error))
  queue.enqueue('TEST_ONLY ambiguous'); queue.enqueue('TEST_ONLY newer')
  assert.throws(() => queue.reset())
  reject(new Error('TEST_ONLY response lost')); await assert.rejects(queue.flush())
  queue.enqueue('TEST_ONLY latest while offline'); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(writes, ['TEST_ONLY ambiguous']); assert.equal(errors.length, 1)
  queue.reset(); await queue.flush(); assert.equal(writes.length, 1)
  queue.enqueue('TEST_ONLY explicitly reconciled'); await queue.flush()
  assert.deepEqual(writes, ['TEST_ONLY ambiguous', 'TEST_ONLY explicitly reconciled'])
})
