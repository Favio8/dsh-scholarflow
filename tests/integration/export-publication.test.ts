import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { prepareDelivery, createDelivery, readDelivery } from '../../src/core/export/delivery.ts'
import { registerSource } from '../../src/core/evidence/evidence.ts'

async function setup(text: string) {
  const io = new MemoryStore({ 'unselected-secret.txt': 'TEST_ONLY private material must never enter a delivery' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY publication boundary', type: 'course-paper' }))
  const current = await snapshot(io)
  await saveManual(io, text, current.document.contentHash, current.ledger.revision)
  return io
}

test('AT-22/SF-025: unbundled relative links, definitions, referenced images and raw HTML fail preflight without changing facts or reading their targets', async () => {
  for (const [text, code] of [
    ['TEST_ONLY [local](../unselected-secret.txt)', 'LOCAL_RESOURCE_NOT_EXPORTABLE'],
    ['TEST_ONLY [resource][r]\n\n[r]: figures/data.csv "TEST_ONLY title"', 'LOCAL_RESOURCE_NOT_EXPORTABLE'],
    ['TEST_ONLY [unsafe](javascript:alert%281%29)', 'LOCAL_RESOURCE_NOT_EXPORTABLE'],
    ['TEST_ONLY ![image][r]\n\n[r]: https://example.org/figure.png', 'IMAGE_EXPORT_UNAVAILABLE'],
    ['TEST_ONLY <a href="../unselected-secret.txt">private</a>', 'HTML_EXPORT_UNAVAILABLE'],
  ]) {
    const io = await setup(text), before = [...io.files.entries()], reads: string[] = [], read = io.read.bind(io)
    io.read = async path => { reads.push(path); return read(path) }
    await assert.rejects(prepareDelivery(io), { code })
    assert.deepEqual([...io.files.entries()], before); assert.equal(reads.includes('unselected-secret.txt'), false)
  }
})

test('SF-032: private paths and obvious credentials in manuscript or cited bibliography cannot publish, while unrelated uncited records stay excluded', async () => {
  for (const text of ['TEST_ONLY C:\\Users\\example\\private.txt', 'TEST_ONLY /home/example/private.txt',
    'TEST_ONLY \\\\host\\private\\file.txt', 'TEST_ONLY api_key=TEST_ONLY_PRIVATE_VALUE',
    'TEST_ONLY [signed](https://example.org/file?X-Amz-Signature=TEST_ONLY_VALUE)',
    'TEST_ONLY [userinfo](https://TEST_ONLY_USER:TEST_ONLY_PASSWORD@example.org/file)']) {
    const io = await setup(text), before = [...io.files.entries()]
    await assert.rejects(prepareDelivery(io), error => ['PRIVATE_PATH_NOT_EXPORTABLE', 'PRIVATE_CREDENTIAL_NOT_EXPORTABLE'].includes((error as any).code))
    assert.deepEqual([...io.files.entries()], before)
  }
  const io = await setup('TEST_ONLY safe manuscript'), current = await snapshot(io)
  const source = await registerSource(io, { kind: 'paper', title: 'TEST_ONLY C:\\Users\\example\\private.bib', authors: [], identifiers: {} }, current.ledger.revision)
  const uncited = await prepareDelivery(io); assert.deepEqual(uncited.sourceIds, [])
  const now = await snapshot(io)
  await saveManual(io, `TEST_ONLY [@${source.source.citeKey}]`, now.document.contentHash, now.ledger.revision)
  const before = [...io.files.entries()]
  await assert.rejects(prepareDelivery(io), { code: 'PRIVATE_PATH_NOT_EXPORTABLE' }); assert.deepEqual([...io.files.entries()], before)
})

test('public Markdown links, reference definitions and local anchors preserve exact saved bytes in independently readable mandatory artifacts', async () => {
  const text = '\uFEFF# TEST_ONLY public\r\n\r\nTEST_ONLY [public][r] and [chapter](#test_only-public).\r\n\r\n[r]: https://example.org/a%20b?year=2025#part "TEST_ONLY title"\r\n\r\n`[literal](../not-a-resource)`\r\n'
  const io = await setup(text), plan = await prepareDelivery(io), current = await snapshot(io)
  const delivered = await createDelivery(io, plan, 'working-draft', current.ledger.revision)
  const artifacts = await readDelivery(io, delivered.manifest.id)
  assert.equal(artifacts.files.find(row => row.relativePath === 'paper.md')!.text, text)
  assert.deepEqual(artifacts.files.map(row => row.relativePath), ['paper.md', 'references.bib', 'quality-report.md'])
  assert.equal((await snapshot(io)).document.text, text)
  for (const artifact of artifacts.files) assert.doesNotMatch(artifact.text, /private material must never enter/u)
})
