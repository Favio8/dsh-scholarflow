import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, updateProjectText } from '../../src/core/project/project.ts'
import { readProjectTextBuffer, writeProjectTextBuffer } from '../../src/core/editing/project-text-buffer.ts'
import { approvedMemory } from '../../src/core/project/memory.ts'
import { projectTextPaths } from '../../src/shared/requirements.ts'
import { digest } from '../../src/core/store/files.ts'

async function setup() {
  const io = new MemoryStore(); await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 未提交指令', type: 'course-paper' })); return io
}
test('SF-018/028: all five instruction drafts survive cold reads without changing confirmed memory, Profiles, body, approvals or ledger', async () => {
  const io = await setup(), original = await snapshot(io), before = new Map(io.files), memory = await approvedMemory(io, original.ledger.projectId)
  for (const path of projectTextPaths) {
    const text = `\uFEFFTEST_ONLY 未提交指令 ${path}\r\n`, baseHash = digest((await io.read(path))!.text)
    const written = await writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', path, { text, baseHash, baseBufferHash: null, state: 'dirty' })
    const restored = await readProjectTextBuffer(io, 'ses_TEST_ONLY_A', path)
    assert.equal(restored.buffer!.text, text); assert.equal(restored.bufferHash, written.bufferHash)
    assert.equal((await readProjectTextBuffer(io, 'ses_TEST_ONLY_B', path)).buffer, undefined)
  }
  for (const [path, bytes] of before) assert.equal(io.files.get(path), bytes, `original fact preserved: ${path}`)
  assert.deepEqual(await approvedMemory(io, original.ledger.projectId), memory)
  assert.equal((await snapshot(io)).ledger.revision, original.ledger.revision)
})
test('stale pages and external instruction changes preserve both versions; scratch recovery does not approve or overwrite the newer fact', async () => {
  const io = await setup(), original = await snapshot(io), path = projectTextPaths[2], baseHash = digest((await io.read(path))!.text)
  const staged = await writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', path, { text: 'TEST_ONLY pending decision', baseHash, baseBufferHash: null, state: 'dirty' })
  await assert.rejects(writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', path, { text: 'TEST_ONLY stale page', baseHash, baseBufferHash: null, state: 'dirty' }), { code: 'EDITOR_BUFFER_CONFLICT' })
  await updateProjectText(io, path, 'TEST_ONLY later confirmed decision', baseHash, original.ledger.revision, 'ses_TEST_ONLY_B')
  const recovered = (await readProjectTextBuffer(io, 'ses_TEST_ONLY_A', path)).buffer!
  await assert.rejects(updateProjectText(io, path, recovered.text, recovered.baseHash, original.ledger.revision + 1, 'ses_TEST_ONLY_A'), { code: 'STALE_DOCUMENT_VERSION' })
  assert.equal((await io.read(path))!.text, 'TEST_ONLY later confirmed decision')
  await writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', path, { text: '', baseHash: digest((await io.read(path))!.text), baseBufferHash: staged.bufferHash, state: 'cleared' })
  assert.equal((await readProjectTextBuffer(io, 'ses_TEST_ONLY_A', path)).buffer!.state, 'cleared')
})
test('instruction scratch cannot target raw materials, impersonate another project or exceed bounded Unicode bytes', async () => {
  const io = await setup(), path = projectTextPaths[0], baseHash = digest((await io.read(path))!.text)
  const input = { text: 'TEST_ONLY retained draft', baseHash, baseBufferHash: null, state: 'dirty' as const }
  await assert.rejects(writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', 'raw/requirements.md' as any, input), { code: 'PATH_OUTSIDE_ALLOWED_ROOT' })
  await assert.rejects(writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', path, { ...input, text: '中'.repeat(22000) }), { code: 'INVALID_EDITOR_TEXT' })
  await assert.rejects(writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', path, { ...input, text: '\ud800' }), { code: 'INVALID_EDITOR_TEXT' })
  await writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', path, input)
  const target = [...io.files.keys()].find(value => value.includes('/project-text-buffers/'))!
  const tampered = JSON.parse(io.files.get(target)!.text); tampered.projectId = 'prj_TEST_ONLY_FOREIGN'; io.externalEdit(target, JSON.stringify(tampered))
  const before = io.files.get(target)
  await assert.rejects(readProjectTextBuffer(io, 'ses_TEST_ONLY_A', path), { code: 'EDITOR_BUFFER_IDENTITY_CHANGED' })
  await assert.rejects(writeProjectTextBuffer(io, 'ses_TEST_ONLY_A', path, input), { code: 'EDITOR_BUFFER_IDENTITY_CHANGED' })
  assert.equal(io.files.get(target), before)
  io.externalEdit(target, ' '.repeat(512 * 1024 + 1))
  await assert.rejects(readProjectTextBuffer(io, 'ses_TEST_ONLY_A', path), { code: 'PROJECT_TEXT_BUFFER_INVALID' })
})
