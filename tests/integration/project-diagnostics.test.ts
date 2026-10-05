import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, CONFIG_PATH, LEDGER_PATH } from '../../src/core/project/project.ts'
import { inspectDamagedProject } from '../../src/core/project/diagnostics.ts'
import { HostFileStore } from '../../src/host/gateway/file-store.ts'
import { parse, stringify } from 'yaml'
import { saveManual } from '../../src/core/editing/proposals.ts'
async function setup() { const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY raw material', 'secrets/private.md': 'TEST_ONLY forbidden' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 诊断', type: 'course-paper', manuscriptDir: '写作成果' })); return io }
test('SF-030: malformed ledger and transaction originals stay readable without defaults, recovery, or writes', async () => {
  const io = await setup(), current = await snapshot(io), bad = '\ufeff{"TEST_ONLY":\r\n'
  io.externalEdit(LEDGER_PATH, bad)
  const txn = `.scholarflow/transactions/txn_${'a'.repeat(32)}/manifest.json`; io.externalEdit(txn, 'TEST_ONLY invalid transaction\r\n')
  const writes = io.writes, files = [...io.files]
  const result = await inspectDamagedProject(io, { code: 'PROJECT_LEDGER_INVALID', message: 'TEST_ONLY invalid JSON' })
  assert.equal(result.originals.find(row => row.relativePath === LEDGER_PATH)!.text, bad)
  assert.equal(result.originals.find(row => row.relativePath === txn)!.text, 'TEST_ONLY invalid transaction\r\n')
  assert.equal(result.originals.find(row => row.relativePath === '写作成果/paper.md')!.text, current.document.text)
  assert.equal(result.versions.ledger, undefined); assert.deepEqual([...io.files], files); assert.equal(io.writes, writes)
  assert.ok(!result.originals.some(row => row.relativePath === 'raw.txt'))
})
test('invalid configuration cannot guess manuscript or sensitive paths; missing metadata and unsupported UTF-8 are retained as explicit limitations', async () => {
  for (const broken of ['schemaVersion: [\r\nTEST_ONLY', stringify({ schemaVersion: 1, project: { id: 'prj_TEST_ONLY' }, paths: { manuscriptDir: '写作成果', mainDocument: 'secrets/private.md' } })]) {
    const io = await setup(); io.externalEdit(CONFIG_PATH, broken); io.files.delete(LEDGER_PATH)
    const reads: string[] = [], read = io.read.bind(io); io.read = async path => { reads.push(path); if (path === '.scholarflow/resources.lock.json') throw new Error('TEST_ONLY invalid UTF-8'); return read(path) }
    const writes = io.writes, result = await inspectDamagedProject(io, { code: 'PROJECT_CONFIG_INVALID', message: 'TEST_ONLY' })
    assert.ok(!reads.includes('写作成果/paper.md')); assert.ok(!reads.includes('secrets/private.md'))
    assert.ok(result.warnings.some(row => row.includes('缺失'))); assert.ok(result.warnings.some(row => row.includes('UTF-8')))
    assert.equal(io.writes, writes); assert.equal(await io.stat(LEDGER_PATH), undefined)
  }
})
test('a config envelope may locate only bounded explicit owned outputs, and a concurrent original edit rejects the diagnostic snapshot', async () => {
  const io = await setup(), config = parse((await io.read(CONFIG_PATH))!.text)
  config.project.type = 'TEST_ONLY unsupported'; io.externalEdit(CONFIG_PATH, stringify(config))
  io.externalEdit('写作成果/references.bib', 'X'.repeat(2 * 1024 * 1024 + 1))
  const result = await inspectDamagedProject(io, { code: 'PROJECT_CONFIG_INVALID', message: 'TEST_ONLY' })
  assert.ok(result.originals.some(row => row.relativePath === '写作成果/paper.md')); assert.ok(result.warnings.some(row => row.includes('限额')))
  let n = 0; const read = io.read.bind(io)
  io.read = async path => { if (path === CONFIG_PATH && ++n === 2) io.externalEdit(path, stringify(config) + '# TEST_ONLY concurrent\n'); return read(path) }
  await assert.rejects(inspectDamagedProject(io, { code: 'PROJECT_CONFIG_INVALID', message: 'TEST_ONLY' }), { code: 'STALE_LEDGER_REVISION' })
})
test('the Host diagnostic gateway rejects writes and even write-lock creation before invoking filesystem or permission APIs', async () => {
  const io = new HostFileStore({}, { canonicalRoot: 'D:/TEST_ONLY', manuscriptDir: '写作成果', sessionId: 'ses_TEST_ONLY', readOnly: true,
    revalidate: async () => { throw new Error('TEST_ONLY must not be reached') } }, new AbortController().signal)
  await assert.rejects(io.write('.scholarflow/data/ledger.json', '{}', undefined), { code: 'PROJECT_READONLY' })
  await assert.rejects(io.lock(async () => assert.fail('TEST_ONLY lock body must not run')), { code: 'PROJECT_READONLY' })
})
test('missing or malformed resource locks block manuscript writes without fabricating a default lock', async () => {
  for (const broken of [undefined, '{TEST_ONLY broken JSON', JSON.stringify({ schemaVersion: 1, projectId: 'prj_TEST_ONLY', bindings: 'TEST_ONLY invalid' })]) {
    const io = await setup(), current = await snapshot(io), path = '.scholarflow/resources.lock.json'
    if (broken === undefined) io.files.delete(path); else io.externalEdit(path, broken)
    const writes = io.writes
    await assert.rejects(saveManual(io, 'TEST_ONLY must not save', current.document.contentHash, current.ledger.revision),
      { code: broken === undefined ? 'SKILL_RESOURCE_LOCK_MISSING' : 'SKILL_RESOURCE_LOCK_INVALID' })
    assert.equal(io.writes, writes); assert.equal((await io.read('写作成果/paper.md'))!.text, current.document.text)
    assert.equal((await io.read(path))?.text, broken)
  }
})
