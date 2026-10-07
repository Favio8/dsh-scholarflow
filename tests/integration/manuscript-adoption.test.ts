// TEST_ONLY source text and metadata; no assertion of publication authenticity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { contentOf, deliveredText } from '../fixtures/delivery-artifacts.ts'
import { prepareInit, initialize, snapshot } from '../../src/core/project/project.ts'
import { inspectManuscriptSource, prepareManuscriptAdoption, applyManuscriptAdoption } from '../../src/core/editing/manuscript-adoption.ts'
import { saveManual, buildProposal, undoRevision } from '../../src/core/editing/proposals.ts'
import { runReview } from '../../src/core/review/review.ts'
import { prepareDelivery, createDelivery, readDelivery } from '../../src/core/export/delivery.ts'
import { registerSource } from '../../src/core/evidence/evidence.ts'
import { projectMarkdown, validateRange } from '../../src/core/editing/markdown.ts'
import { digest } from '../../src/core/store/files.ts'
import { recover } from '../../src/core/store/transactions.ts'

const path = 'old/原稿.md'
const text = '\uFEFF# TEST_ONLY 已有原稿\r\n\r\nTEST_ONLY 手写段落 😀。\r\n\r\nTEST_ONLY 手写段落 😀。\r\n'
async function fixture(source = text) {
  const io = new MemoryStore({ [path]: source })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY import', type: 'course-paper' }))
  return io
}
async function plan(io: MemoryStore, mappings: Record<string, string> = {}) {
  const source = await inspectManuscriptSource(io, path)
  return prepareManuscriptAdoption(io, { sourcePath: path, sourceHash: source.sourceHash, mappings, reason: 'TEST_ONLY explicit import with backup', sessionId: 'ses_TEST_ONLY' })
}
test('read/preview have no writes; explicit adoption preserves exact source bytes, records provenance and keeps the previous revision backup', async () => {
  const io = await fixture(), before = await snapshot(io), writes = io.writes, prepared = await plan(io)
  assert.equal(io.writes, writes); assert.equal((await snapshot(io)).document.text, before.document.text)
  const accepted = await applyManuscriptAdoption(io, prepared), after = await snapshot(io)
  assert.equal(after.document.text, text); assert.equal(after.document.lineEnding, 'crlf'); assert.equal(after.document.initialPlaceholder, false)
  assert.equal((await io.read(path))!.text, text)
  assert.equal((await io.read(`.scholarflow/drafts/${before.document.revisionId}/paper.md`))!.text, before.document.text)
  assert.equal((await io.read(`.scholarflow/imports/${prepared.id}/source.md`))!.text, text)
  const provenance = JSON.parse((await io.read(`.scholarflow/imports/${prepared.id}/manifest.json`))!.text)
  assert.equal(provenance.sourceHash, digest(text)); assert.equal(provenance.sourceSessionId, 'ses_TEST_ONLY'); assert.equal(provenance.originalModified, false)
  assert.equal(provenance.previousRevisionId, before.document.revisionId)
  assert.equal(projectMarkdown(text).blocks.length, 2)
  await undoRevision(io, accepted.revisionId, accepted.documentHash, accepted.revision)
  assert.equal((await snapshot(io)).document.text, before.document.text); assert.equal((await io.read(path))!.text, text)
})
test('explicit keyed citation mappings use existing Sources and never fabricate foreign IDs or silently infer legacy references', async () => {
  const original = '# TEST_ONLY\n\nTEST_ONLY [@sf_FOREIGN; @smith] and [1].\n\n`[@sf_CODE]`\n', io = await fixture(original)
  const inspected = await inspectManuscriptSource(io, path)
  assert.deepEqual(inspected.requiredMappings, ['sf_FOREIGN']); assert.ok(!inspected.keys.includes('sf_CODE'))
  await assert.rejects(plan(io), { code: 'CITATION_MAPPING_REQUIRED' })
  const source = await registerSource(io, { kind: 'paper', title: 'TEST_ONLY explicit metadata', authors: [], identifiers: {} }, 0)
  const prepared = await plan(io, { sf_FOREIGN: source.source.citeKey, smith: source.source.citeKey })
  await applyManuscriptAdoption(io, prepared)
  assert.ok((await snapshot(io)).document.text.includes(`[@${source.source.citeKey}; @${source.source.citeKey}]`))
  assert.equal(Object.keys((await snapshot(io)).ledger.sources).length, 1); assert.equal((await io.read(path))!.text, original)
  const reviewed = await runReview(io, (await snapshot(io)).ledger.revision)
  assert.equal(reviewed.report.checks.find(row => row.id === 'unmanaged_citation_markers')!.status, 'unknown')
  const deliveryPlan = await prepareDelivery(io)
  assert.equal(deliveryPlan.reviewedAllowed, false)
  const delivery = await createDelivery(io, deliveryPlan, 'working-draft', reviewed.revision)
  const files = (await readDelivery(io, delivery.manifest.id)).files
  assert.ok(deliveredText(files, 'references.bib').includes(source.source.citeKey))
  assert.ok(deliveredText(files, 'quality-report.md').includes('未映射引用／数字标记'))
})
test('legacy markers survive import and local AI edits must preserve their multiplicity while prototype-like keys remain ordinary data', async () => {
  const original = '# TEST_ONLY\n\nTEST_ONLY [@constructor] [@__proto__] [@smith] [1] [1].\n', io = await fixture(original), prepared = await plan(io)
  assert.equal(prepared.text, original)
  await applyManuscriptAdoption(io, prepared)
  const current = await snapshot(io), block = projectMarkdown(current.document.text).blocks[0]
  await assert.rejects(saveManual(io, current.document.text + '\nTEST_ONLY [@sf_MISSING; @legacy].\n', current.document.contentHash, current.ledger.revision), { code: 'CITATION_KEY_UNKNOWN' })
  assert.equal((await snapshot(io)).document.contentHash, current.document.contentHash)
  const selection = { projectId: current.config.project.id, documentId: 'paper', documentHash: current.document.contentHash, revisionId: current.document.revisionId,
    blockIds: [block.id], sourceRange: { startUtf16: block.start, endUtf16: block.end }, sourceText: current.document.text.slice(block.start, block.end),
    renderedText: validateRange(projectMarkdown(current.document.text), block.start, block.end, 'paragraph').renderedText, prefixContext: '', suffixContext: '', citationKeys: [], claimIds: [], scope: 'paragraph' as const, capturedAt: new Date().toISOString() }
  assert.throws(() => buildProposal(current, { runId: 'run_TEST_ONLY', instruction: 'TEST_ONLY retain legacy citations', selection, dependentEvidenceIds: [],
    replacementText: selection.sourceText.replace('[1] [1]', '[1]') }), { code: 'CITATION_CHANGE_REQUIRES_CONFIRMATION' })
  const source = await registerSource(io, { kind: 'paper', title: 'TEST_ONLY prototype key mapping', authors: [], identifiers: {} }, current.ledger.revision)
  const mapped = await plan(io, Object.fromEntries([['constructor', source.source.citeKey]]))
  assert.ok(mapped.text.includes(`[@${source.source.citeKey}]`)); assert.ok(mapped.text.includes('[@__proto__]'))
})
test('relative resources preserve original project targets; no resource or remote address is read implicitly', async () => {
  const io = await fixture('# TEST_ONLY\n\nTEST_ONLY [note](./notes.md) ![fig](fig/a.png)\n'), reads: string[] = [], read = io.readBytes.bind(io)
  io.readBytes = async (path, cap) => { reads.push(path); return read(path, cap) }
  const prepared = await plan(io)
  assert.ok(prepared.text.includes('[note](../old/notes.md) ![fig](../old/fig/a.png)'))
  assert.ok(reads.every(row => row === path))
  await applyManuscriptAdoption(io, prepared)
  assert.equal(await io.read('old/notes.md'), undefined); assert.equal(await io.read('old/fig/a.png'), undefined)
  await assert.rejects(prepareDelivery(io), { code: 'IMAGE_EXPORT_UNAVAILABLE' })
})
test('changed original, current body, references, plan bytes and denied source paths do not overwrite either manuscript', async () => {
  const io = await fixture(), prepared = await plan(io), before = await snapshot(io)
  await assert.rejects(applyManuscriptAdoption(io, { ...prepared, text: 'TEST_ONLY tampered' }), { code: 'INVALID_APPROVAL' })
  io.externalEdit(path, text + 'TEST_ONLY external original change')
  await assert.rejects(applyManuscriptAdoption(io, prepared), { code: 'STALE_MATERIAL_VERSION' })
  assert.equal((await snapshot(io)).document.contentHash, before.document.contentHash)
  io.externalEdit(path, text)
  io.externalEdit('manuscript/paper.md', 'TEST_ONLY external master change')
  await assert.rejects(applyManuscriptAdoption(io, prepared), { code: 'STALE_DOCUMENT_VERSION' })
  assert.equal((await io.read('manuscript/paper.md'))!.text, 'TEST_ONLY external master change')
  for (const sourcePath of ['manuscript/paper.md', 'MANUSCRIPT/paper.md', '.SCHOLARFLOW/data/source.md', '.scholarflow/project.yaml', '.credentials.md', '../outside.md']) await assert.rejects(inspectManuscriptSource(io, sourcePath))
  const empty = await fixture('')
  await assert.rejects(inspectManuscriptSource(empty, path), { code: 'DOCUMENT_INVALID' })
  assert.equal((await snapshot(empty)).document.initialPlaceholder, true)
})
test('transaction interruption restores adopted source provenance and master exactly once without modifying the raw original', async () => {
  class FaultStore extends MemoryStore { failAt = Infinity; async write(...args: Parameters<MemoryStore['write']>) {
    if (this.writes + 1 === this.failAt) throw new Error('TEST_ONLY adoption transaction interrupted')
    return super.write(...args)
  } }
  const io = new FaultStore({ [path]: text })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY adoption crash', type: 'course-paper' }))
  const prepared = await plan(io); io.failAt = io.writes + 5
  await assert.rejects(applyManuscriptAdoption(io, prepared), /TEST_ONLY adoption transaction interrupted/)
  io.failAt = Infinity
  await recover(io, 'manuscript')
  const restored = await snapshot(io)
  assert.equal(restored.document.text, text); assert.equal((await io.read(path))!.text, text)
  assert.equal((await io.list('.scholarflow/imports')).length, 1)
  assert.equal(JSON.parse((await io.read(`.scholarflow/imports/${prepared.id}/manifest.json`))!.text).sourceHash, digest(text))
  await assert.rejects(applyManuscriptAdoption(io, prepared), { code: 'STALE_LEDGER_REVISION' })
  assert.equal((await snapshot(io)).document.revisionId, restored.document.revisionId)
})
