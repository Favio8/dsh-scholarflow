import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, stringify } from 'yaml'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, CONFIG_PATH, LEDGER_PATH } from '../../src/core/project/project.ts'
import { inspectCompatibility } from '../../src/core/project/compatibility.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
const lockPath = '.scholarflow/resources.lock.json'
async function setup() {
  const io = new MemoryStore({ 'secrets/hidden.md': 'TEST_ONLY never read', 'raw.txt': 'TEST_ONLY original' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY future project', type: 'course-paper' }))
  return io
}
test('future config, ledger and resource-lock versions open as original bytes with no writes or downward interpretation', async () => {
  for (const path of [CONFIG_PATH, LEDGER_PATH, lockPath]) {
    const io = await setup(), current = await snapshot(io), old = (await io.read(path))!.text
    const data = path === CONFIG_PATH ? parse(old) : JSON.parse(old)
    data.schemaVersion = 99; data.futureRecord = { unknown: 'TEST_ONLY retain this original field' }
    io.externalEdit(path, path === CONFIG_PATH ? stringify(data) : JSON.stringify(data, null, 2) + '\n')
    const writes = io.writes, files = [...io.files], readonly = await inspectCompatibility(io)
    assert.ok(readonly); assert.ok(Object.values(readonly.versions).includes(99))
    assert.equal(readonly.originals.find(file => file.relativePath === path)!.text, (await io.read(path))!.text)
    assert.equal(readonly.originals.find(file => file.relativePath === 'manuscript/paper.md')!.text, current.document.text)
    assert.deepEqual([...io.files], files); assert.equal(io.writes, writes)
    await assert.rejects(saveManual(io, 'TEST_ONLY forbidden replacement', current.document.contentHash, current.ledger.revision), { code: 'PROJECT_SCHEMA_TOO_NEW' })
    assert.equal((await io.read('manuscript/paper.md'))!.text, current.document.text)
  }
})
test('future unsupported path shapes remain opaque and do not permit raw, sensitive or escaping reads', async () => {
  for (const paths of [{ manuscriptDir: 'manuscript', mainDocument: 'secrets/hidden.md', references: 'raw.txt' },
    { manuscriptDir: '../outside', mainDocument: '../outside/secret.md' }, { futureMount: 'TEST_ONLY unknown' }]) {
    const io = await setup(), raw = parse((await io.read(CONFIG_PATH))!.text)
    raw.schemaVersion = 2; raw.paths = paths; io.externalEdit(CONFIG_PATH, stringify(raw))
    const reads: string[] = [], read = io.read.bind(io); io.read = path => { reads.push(path); return read(path) }
    const readonly = await inspectCompatibility(io)
    assert.ok(readonly); assert.ok(readonly.warnings.length > 1)
    assert.deepEqual(readonly.originals.map(file => file.relativePath), [CONFIG_PATH, LEDGER_PATH, lockPath])
    assert.ok(reads.every(path => [CONFIG_PATH, LEDGER_PATH, lockPath].includes(path)))
  }
})
test('supported projects keep the normal inspect path and missing or over-limit originals are reported without rebuilding them', async () => {
  const io = await setup(); assert.equal(await inspectCompatibility(io), undefined)
  const raw = parse((await io.read(CONFIG_PATH))!.text); raw.schemaVersion = 3; io.externalEdit(CONFIG_PATH, stringify(raw))
  io.files.delete('manuscript/references.bib'); io.externalEdit('manuscript/paper.md', 'X'.repeat(2 * 1024 * 1024 + 1))
  const writes = io.writes, readonly = await inspectCompatibility(io)
  assert.ok(readonly); assert.equal(readonly.originals.length, 3); assert.ok(readonly.warnings.some(row => row.includes('限额')))
  assert.equal(io.writes, writes); assert.equal(await io.read('manuscript/references.bib'), undefined)
})
