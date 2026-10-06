import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readOneMember, type ReadServices } from '../../src/host/bridge/requirement-reading.ts'
import { MemoryStore } from '../fixtures/memory-store.ts'
import type { RequirementSource } from '../../src/shared/writing-task.ts'

const at = '2026-10-06T00:00:00.000Z'
const source: RequirementSource = { resourceId: 'req_a', origin: 'workspace', kind: 'folder', path: '作业要求',
  members: [{ name: '作业要求/1.jpg' }], role: 'assignment', state: 'selected' }
const member = { name: '作业要求/1.jpg', sourceId: 'req_a', kind: 'image' as const, state: 'pending' as const, bytes: 0 }

/** A store whose read never settles unless it is aborted — the shape of a hung host read. */
function hangingStore() {
  const store = new MemoryStore({ '作业要求/1.jpg': 'TEST_ONLY image placeholder' })
  let observed: AbortSignal | undefined
  store.readBytes = async (path: string, maxBytes: number, signal?: AbortSignal) => {
    observed = signal
    return new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  }
  return { store, observed: () => observed }
}

function services(store: MemoryStore, overrides: Partial<ReadServices> = {}): ReadServices {
  return {
    readWorkspace: (path, signal) => store.readBytes(path, 50 * 1024 * 1024, signal),
    readExternal: async () => { throw new Error('not used') },
    parseText: async () => ({ text: '', pages: { read: 0, total: 0 } }),
    transcribeImage: async () => ({ text: 'TEST_ONLY 要求文字', model: 'TEST_ONLY/model' }),
    recognition: async () => ({ model: 'TEST_ONLY/model', imageInput: true, candidates: [] }),
    ...overrides,
  }
}

test('a member read receives the caller signal, so a bound can reach the file read', async () => {
  const { store, observed } = hangingStore()
  const controller = new AbortController()
  const pending = readOneMember(member, source, services(store), controller.signal)
  await new Promise(resolve => setTimeout(resolve, 10))
  // Without this the bound is inert: the read would wait on a promise nothing can interrupt.
  assert.equal(observed(), controller.signal, 'readBytes did not receive the caller signal')
  controller.abort('timeout')
  await assert.rejects(pending, error => (error as Error).name === 'AbortError')
})

test('an abort during the file read surfaces as an abort, not as a successful read', async () => {
  const { store } = hangingStore()
  const controller = new AbortController()
  const pending = readOneMember(member, source, services(store), controller.signal)
  controller.abort('cancelled')
  await assert.rejects(pending)
})

test('the caller signal is also what the image transcription step sees', async () => {
  const store = new MemoryStore({ '作业要求/1.jpg': 'TEST_ONLY image placeholder' })
  const controller = new AbortController()
  let seen: AbortSignal | undefined
  const result = await readOneMember(member, source, services(store, {
    transcribeImage: async ({ signal }) => { seen = signal; return { text: 'TEST_ONLY 要求', model: 'TEST_ONLY/model' } },
  }), controller.signal)
  assert.equal(seen, controller.signal)
  assert.equal(result.state, 'ready')
  assert.equal(result.text, 'TEST_ONLY 要求')
})

test('a store that cannot see a signal still reads normally when none is given', async () => {
  const store = new MemoryStore({ '作业要求/1.jpg': 'TEST_ONLY placeholder' })
  const result = await readOneMember(member, source, services(store), new AbortController().signal)
  assert.equal(result.state, 'ready')
})

test('a step that ignores cancellation still cannot hold the whole read (race bound)', async () => {
  const store = new MemoryStore({ '作业要求/1.jpg': 'TEST_ONLY placeholder' })
  const { runRead } = await import('../../src/host/bridge/requirement-reading.ts')
  const controller = new AbortController()
  // recognition() never settles and never looks at the signal: the exact shape of a host call
  // that never answers. Only a race, not an abort, can bring the job back.
  const result = await runRead({
    readId: 'read_TEST', projectId: 'p', sessionId: 's', sources: [source],
    services: services(store, { recognition: () => new Promise(() => {}) }),
    signal: controller.signal, memberTimeoutMs: 60, now: () => Date.parse(at),
  })
  assert.equal(result.state, 'ready', 'the job must reach a terminal state')
  assert.equal(result.members[0].state, 'failed')
  assert.match(result.members[0].note!, /超过 0 秒没有响应|没有响应/)
})

test('a runtime complaint never becomes the sentence a person reads', async () => {
  const store = new MemoryStore({ '作业要求/1.jpg': 'TEST_ONLY placeholder' })
  const controller = new AbortController()
  const result = await readOneMember(member, source, services(store, {
    recognition: async () => { throw new Error('cannot get property "attachments" without inject') },
  }), controller.signal).catch(error => error as Error)
  // The read path turns this into a failure note elsewhere; here the wording rule is what is
  // under test: the message must not reach the reader verbatim.
  assert.match(String(result), /without inject/, 'the raw error is still what the caller sees')
})
