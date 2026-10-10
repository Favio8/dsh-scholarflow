import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OutlineJobs } from '../../src/host/bridge/outline-jobs.ts'
import { outlineCandidateKey, outlineInputKey, restoreOutlineInputKey } from '../../src/core/requirements/outline.ts'
import { requirementDraftSpec } from '../../src/shared/writing-task.ts'
const tick = () => new Promise(resolve => setImmediate(resolve))
const signal = () => new AbortController().signal

test('concurrent identical requests share one execution and result', async () => {
  const jobs = new OutlineJobs<number>(); let count = 0, release!: (n: number) => void
  const execute = async () => { count++; return new Promise<number>(done => { release = done }) }
  const requests = Array.from({ length: 15 }, (_, i) => jobs.run('session', 'same', `op${i}`, signal(), execute))
  await tick(); assert.equal(count, 1); release(7)
  assert.deepEqual(await Promise.all(requests), Array(15).fill(7))
})

test('replacement waits for an abort-ignoring provider and only the latest queued request executes', async () => {
  const jobs = new OutlineJobs<number>(); let release!: () => void, concurrent = 0, maximum = 0
  const first = jobs.run('s', 'a', 'a', signal(), async () => { maximum = Math.max(maximum, ++concurrent); await new Promise<void>(done => { release = done }); concurrent--; return 1 })
  const firstRejected = assert.rejects(first, { name: 'AbortError' }); await tick()
  const middle = jobs.run('s', 'b', 'b', signal(), async () => { throw new Error('superseded job must not dispatch') })
  const middleRejected = assert.rejects(middle, { name: 'AbortError' })
  const latest = jobs.run('s', 'c', 'c', signal(), async () => { maximum = Math.max(maximum, ++concurrent); concurrent--; return 3 })
  release(); await firstRejected; await middleRejected
  assert.equal(await latest, 3); assert.equal(maximum, 1)
})

test('explicit stop works before dispatch, and an old stop never cancels a newer operation', async () => {
  const jobs = new OutlineJobs<number>()
  jobs.stop('s', 'early')
  assert.throws(() => jobs.run('s', 'key', 'early', signal(), async () => 1), { name: 'AbortError' })
  let finish!: () => void
  const running = jobs.run('s', 'key', 'new', signal(), async () => { await new Promise<void>(done => { finish = done }); return 2 })
  await tick(); assert.equal(jobs.stop('s', 'old'), false); finish(); assert.equal(await running, 2)
  const other = jobs.run('other-session', 'key', 'next', signal(), async () => 3)
  assert.equal(await other, 3)
})

test('cover personal fields do not invalidate or restart an outline; requirements and cover presence do', () => {
  const spec = requirementDraftSpec.parse({ title: '报告', requirements: '分析结构', type: 'course-paper', language: 'zh-CN', format: 'docx',
    targetLength: 1500, materials: [], sections: [], cover: { enabled: true, title: '', date: '', fields: [{ label: '姓名', value: '' }] } })
  const edited = { ...spec, cover: { ...spec.cover!, title: '封面标题', date: '2026-10-10', fields: [{ label: '姓名', value: 'TEST_ONLY' }] } }
  assert.equal(outlineInputKey(spec), outlineInputKey(edited))
  assert.equal(outlineCandidateKey(spec), outlineCandidateKey(edited))
  const oldMarker = JSON.parse(outlineInputKey(spec)); oldMarker[11] = spec.cover
  assert.equal(restoreOutlineInputKey(JSON.stringify(oldMarker)), outlineInputKey(spec), 'upgrading must not replay an already attempted request')
  assert.notEqual(outlineInputKey(spec), outlineInputKey({ ...edited, requirements: '另一个任务' }))
  assert.notEqual(outlineInputKey(spec), outlineInputKey({ ...edited, cover: { ...edited.cover, enabled: false } }))
})
