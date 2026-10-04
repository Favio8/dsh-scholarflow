import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { commit, recover, inspectRecovery } from '../../src/core/store/transactions.ts'
import { prepareInit, snapshot } from '../../src/core/project/project.ts'

test('AT-23: each publication interruption resumes exactly once without loss', async () => {
  for (const point of ['journal-published', 'target-0-published', 'target-1-published', 'commit-marked']) {
    const io = new MemoryStore({ 'manuscript/paper.md': '原稿\r\n', '.scholarflow/data/ledger.json': '旧数据' })
    const paper = await io.read('manuscript/paper.md'), ledger = await io.read('.scholarflow/data/ledger.json')
    await assert.rejects(commit(io, [{ path: 'manuscript/paper.md', before: paper, after: '新稿\r\n' },
      { path: '.scholarflow/data/ledger.json', before: ledger, after: '新数据' }], next => { if (next === point) throw new Error('TEST_ONLY process crash') }))
    await io.lock(() => recover(io))
    assert.equal((await io.read('manuscript/paper.md'))!.text, '新稿\r\n')
    assert.equal((await io.read('.scholarflow/data/ledger.json'))!.text, '新数据')
    const writes = io.writes
    assert.deepEqual(await io.lock(() => recover(io)), [])
    assert.equal(io.writes, writes, 'recovery must not replay accepted changes')
    const manifest = [...io.files.values()].map(file => file.text).find(text => text.includes('"changes"'))!
    assert.ok(manifest.includes('原稿'), 'preimage remains available')
  }
})

test('AT-23: third-party file hash blocks all recovery writes', async () => {
  const io = new MemoryStore({ 'manuscript/paper.md': '原稿', '.scholarflow/data/ledger.json': '旧 ledger' })
  await assert.rejects(commit(io, [{ path: 'manuscript/paper.md', before: await io.read('manuscript/paper.md'), after: 'AI 新稿' },
    { path: '.scholarflow/data/ledger.json', before: await io.read('.scholarflow/data/ledger.json'), after: '新 ledger' }], point => { if (point === 'target-0-published') throw new Error('TEST_ONLY crash') }))
  io.externalEdit('manuscript/paper.md', '恢复前用户人工编辑')
  const before = [...io.files.entries()], writes = io.writes
  await assert.rejects(io.lock(() => recover(io)), { code: 'RECOVERY_CONFLICT' })
  assert.deepEqual([...io.files.entries()], before)
  assert.equal(io.writes, writes)
})

test('corrupt transaction snapshots cannot be used to overwrite documents', async () => {
  const io = new MemoryStore({ '.scholarflow/transactions/bad/manifest.json': JSON.stringify({ schemaVersion: 99 }), 'manuscript/paper.md': '人工稿' })
  await assert.rejects(recover(io), { code: 'RECOVERY_CONFLICT' })
  assert.equal((await io.read('manuscript/paper.md'))!.text, '人工稿')
})

test('initialization recovery supports a custom Chinese output even before config publication', async () => {
  const io = new MemoryStore({ '资料.txt': '用户原始资料' })
  const plan = await prepareInit(io, { title: 'TEST_ONLY 中断初始化', type: 'course-paper', manuscriptDir: '写作成果' })
  await assert.rejects(commit(io, plan.files.map(file => ({ path: file.path, before: undefined, after: file.text })), point => { if (point === 'journal-published') throw new Error('TEST_ONLY crash') }))
  const preview = await inspectRecovery(io, '写作成果')
  const writes = io.writes
  assert.equal(preview.pending.length, 1)
  assert.equal(io.writes, writes)
  await io.lock(() => recover(io, '写作成果', preview.contentHash))
  assert.equal((await snapshot(io)).config.project.id, plan.config.project.id)
  assert.equal((await io.read('资料.txt'))?.text, '用户原始资料')
})

test('recovery confirmation rejects changes after preview and validates all journals first', async () => {
  const io = new MemoryStore({ 'manuscript/paper.md': '原稿' })
  await assert.rejects(commit(io, [{ path: 'manuscript/paper.md', before: await io.read('manuscript/paper.md'), after: '新稿' }], () => { throw new Error('TEST_ONLY crash') }))
  const plan = await inspectRecovery(io)
  io.externalEdit('manuscript/paper.md', '新稿')
  const writes = io.writes
  await assert.rejects(recover(io, 'manuscript', plan.contentHash), { code: 'RECOVERY_CONFLICT' })
  assert.equal(io.writes, writes)
  io.externalEdit('.scholarflow/transactions/invalid/manifest.json', '{}')
  const writesAfterExternalEdit = io.writes
  await assert.rejects(recover(io), { code: 'RECOVERY_CONFLICT' })
  assert.equal(io.writes, writesAfterExternalEdit)
})
