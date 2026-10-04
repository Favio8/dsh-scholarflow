import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { scanMaterials, registerMaterial, readParsed } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { registerSource, confirmEvidence, upsertClaim, confirmOutline } from '../../src/core/evidence/evidence.ts'

async function setup() {
  const io = new MemoryStore({ '资料/原始笔记.txt': 'TEST_ONLY 提示支持课堂样本中的有限结论。\r\n不支持泛化到全部人群。\r\n', '.env': 'TEST_ONLY_SECRET', 'credentials/key.txt': 'TEST_ONLY_SECRET' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 证据链', type: 'course-paper' }))
  return io
}
async function materialAndSource(io: MemoryStore) {
  const registered = await registerMaterial(io, { relativePath: '资料/原始笔记.txt', role: 'notes', confirmExcludedFile: false }, 0)
  const parsed = await parseRegisteredMaterial(io, registered.material.id, registered.revision, new AbortController().signal,
    (bytes, mediaType) => parseMaterialBytes(bytes, mediaType, new AbortController().signal))
  const source = await registerSource(io, { title: 'TEST_ONLY 课堂笔记', kind: 'other', authors: [], identifiers: {}, materialId: registered.material.id }, parsed.revision)
  return { registered, parsed, source }
}

test('scan/register are metadata-only and sensitive material cannot be selected', async () => {
  const io = await setup(), reads: string[] = []
  const original = io.readBytes.bind(io); io.readBytes = async (path, limit) => { reads.push(path); return original(path, limit) }
  const scan = await scanMaterials(io)
  assert.ok(scan.files.some(file => file.relativePath === '资料'))
  assert.ok(!scan.files.some(file => file.relativePath === '.env' || file.relativePath === 'credentials'))
  assert.equal(scan.contentRead, false)
  await registerMaterial(io, { relativePath: '资料/原始笔记.txt', role: 'notes', confirmExcludedFile: false }, 0)
  assert.deepEqual(reads, [])
  await assert.rejects(registerMaterial(io, { relativePath: '.env', role: 'notes', confirmExcludedFile: true }, 1), { code: 'MATERIAL_ACCESS_DENIED' })
})

test('SF-011/012: a real local quotation, scoped claim and confirmed outline survive reopen', async () => {
  const io = await setup(), original = (await io.read('资料/原始笔记.txt'))!.text
  const { parsed, source } = await materialAndSource(io)
  assert.equal(source.source.identity.status, 'unverified', 'a parsed quotation does not prove publication identity')
  const block = parsed.parsed.blocks[0]
  const evidence = await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash, locator: block.locator, excerpt: block.text, kind: 'quotation' }, source.revision)
  const claim = await upsertClaim(io, { text: 'TEST_ONLY 课堂样本支持有限结论', kind: 'external-fact', scope: '只限这份课堂样本', evidenceLinks: [{ evidenceId: evidence.evidence.id, relation: 'partial', rationale: '原文明确限制样本，不能推出普遍效果。' }], limitations: ['样本外推未经验证'] }, evidence.revision)
  assert.equal(claim.claim.status, 'partially-supported')
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: '样本支持什么？', thesis: '有限结论', confirmation: 'draft', sections: [{ id: 'sec_TEST_ONLY', title: '证据与局限', purpose: '区分事实和推论', claimIds: [claim.claim.id], missingEvidence: [] }] }, claim.revision, 0)
  const reopened = await snapshot(new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text]))))
  assert.equal(reopened.ledger.evidence[evidence.evidence.id].validation, 'located')
  assert.equal(reopened.ledger.outline.confirmation, 'confirmed')
  assert.equal((await io.read('资料/原始笔记.txt'))!.text, original)
})

test('metadata-only sources and invented quotations cannot become located evidence', async () => {
  const io = await setup()
  const metadata = await registerSource(io, { title: 'TEST_ONLY 未取得全文', authors: [], kind: 'paper', identifiers: { doi: '10.1234/TEST_ONLY' } }, 0)
  await assert.rejects(confirmEvidence(io, { sourceId: metadata.source.id, sourceContentHash: 'sha256:' + '0'.repeat(64), locator: { kind: 'text', lineStart: 1, lineEnd: 1 }, excerpt: 'TEST_ONLY 编造原文', kind: 'quotation' }, metadata.revision), { code: 'EVIDENCE_NEEDS_FULLTEXT' })
  const second = await setup(), { parsed, source } = await materialAndSource(second)
  await assert.rejects(confirmEvidence(second, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash, locator: parsed.parsed.blocks[0].locator, excerpt: '原文没有说过的结论', kind: 'quotation' }, source.revision), { code: 'EVIDENCE_NOT_LOCATED' })
})

test('changing source bytes makes old evidence unusable and preserves all historical excerpts', async () => {
  const io = await setup(), { registered, parsed, source } = await materialAndSource(io)
  const block = parsed.parsed.blocks[0]
  const evidence = await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash, locator: block.locator, excerpt: block.text, kind: 'quotation' }, source.revision)
  io.externalEdit('资料/原始笔记.txt', 'TEST_ONLY 外部更正后的资料\r\n')
  await assert.rejects(readParsed(io, registered.material.id), { code: 'STALE_MATERIAL_VERSION' })
  await parseRegisteredMaterial(io, registered.material.id, evidence.revision, new AbortController().signal, (bytes, mediaType) => parseMaterialBytes(bytes, mediaType, new AbortController().signal))
  const current = await snapshot(io)
  assert.equal(current.ledger.evidence[evidence.evidence.id].validation, 'stale')
  assert.equal(current.ledger.evidence[evidence.evidence.id].excerpt, block.text)
})

test('false support scope and a cyclic outline cannot be persisted', async () => {
  const io = await setup(), { parsed, source } = await materialAndSource(io)
  const evidence = await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash, locator: parsed.parsed.blocks[0].locator, excerpt: parsed.parsed.blocks[0].text, kind: 'quotation' }, source.revision)
  await assert.rejects(upsertClaim(io, { text: '泛化结论', kind: 'external-fact', scope: '全部人群', evidenceLinks: [{ evidenceId: evidence.evidence.id, relation: 'supports' }], limitations: [] }, evidence.revision), { code: 'CLAIM_SCOPE_REQUIRED' })
  await assert.rejects(confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: '', thesis: '', confirmation: 'draft', sections: [
    { id: 's1', parentId: 's2', title: 'a', purpose: '', claimIds: [], missingEvidence: [] }, { id: 's2', parentId: 's1', title: 'b', purpose: '', claimIds: [], missingEvidence: [] },
  ] }, evidence.revision, 0), { code: 'OUTLINE_INVALID' })
})
