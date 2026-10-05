// TEST_ONLY: synthetic local source versions, not claims about real arXiv works.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { registerSource, confirmEvidence } from '../../src/core/evidence/evidence.ts'
import { normalizeArxiv, sourceMatches } from '../../src/core/research/source-matching.ts'
import { prepareSourceRegistration, confirmSourceRegistration } from '../../src/core/research/source-registration.ts'
import { json } from '../../src/core/store/files.ts'
import { bibliography } from '../../src/core/export/bibliography.ts'
function context(current: Awaited<ReturnType<typeof snapshot>>) { return { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'ses_TEST_ONLY', projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision } }
async function setup() {
  const io = new MemoryStore({ 'v1.txt': 'TEST_ONLY first text version\r\n', 'v2.txt': 'TEST_ONLY second text version\r\n' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY source versions', type: 'literature-review' }))
  const materials = []
  for (const relativePath of ['v1.txt', 'v2.txt']) {
    const registered = await registerMaterial(io, { relativePath, role: 'paper', confirmExcludedFile: false }, (await snapshot(io)).ledger.revision)
    const parsed = await parseRegisteredMaterial(io, registered.material.id, registered.revision, new AbortController().signal,
      (bytes, type) => parseMaterialBytes(bytes, type, new AbortController().signal))
    materials.push({ registered, parsed })
  }
  const first = await registerSource(io, { title: 'TEST_ONLY 具体文本版本', authors: [], kind: 'paper', identifiers: { arxiv: 'arXiv:1501.00001v1' }, materialId: materials[0].registered.material.id }, (await snapshot(io)).ledger.revision)
  const parsed = materials[0].parsed.parsed
  const evidence = await confirmEvidence(io, { sourceId: first.source.id, sourceContentHash: parsed.sourceContentHash, locator: parsed.blocks[0].locator, excerpt: parsed.blocks[0].text, kind: 'quotation' }, first.revision)
  const input = { context: context(await snapshot(io)), source: { title: 'TEST_ONLY 具体文本版本', authors: [], kind: 'paper' as const,
    identifiers: { arxiv: 'https://arxiv.org/abs/1501.00001v2' }, materialId: materials[1].registered.material.id } }
  return { io, first, evidence, input }
}
test('arXiv normalization retains concrete versions and validates modern and legacy date/number forms without asserting existence', () => {
  assert.equal(normalizeArxiv(' arXiv:1501.00001v2 '), '1501.00001v2')
  assert.equal(normalizeArxiv('https://arxiv.org/pdf/0706.0001v1.pdf'), '0706.0001v1')
  assert.equal(normalizeArxiv('arXiv:math.gt/0301001v2'), 'math.GT/0301001v2')
  assert.notEqual(normalizeArxiv('1501.00001'), normalizeArxiv('1501.00001v1'))
  for (const invalid of ['1501.00001v' + '9'.repeat(1000), '1501.0001', '1412.00001', '1500.00001', '1513.00001', '1501.00000', '1501.00001v0', '0601.0001', 'hep-th/0704001', 'hep-th/9101001', '../1501.00001', 'https://example.com/abs/1501.00001'])
    assert.throws(() => normalizeArxiv(invalid), { code: 'SOURCE_IDENTIFIER_INVALID' })
})
test('SF-010: distinct arXiv versions require reasoned preview and never migrate original evidence, source bytes or citation identity', async () => {
  const { io, first, evidence, input } = await setup(), before = await snapshot(io), writes = io.writes
  const plan = await prepareSourceRegistration(io, input)
  assert.equal(io.writes, writes); assert.equal(plan.matches[0].kind, 'same-arxiv-work')
  await assert.rejects(registerSource(io, input.source, before.ledger.revision), { code: 'SOURCE_DUPLICATE_REVIEW_REQUIRED' })
  await assert.rejects(confirmSourceRegistration(io, plan, '', 'ses_TEST_ONLY'), { code: 'SOURCE_DUPLICATE_REVIEW_REQUIRED' })
  const second = await confirmSourceRegistration(io, plan, 'TEST_ONLY 不同的具体文本版本，证据不能迁移。', 'ses_TEST_ONLY'), after = await snapshot(io)
  assert.notEqual(second.source.id, first.source.id); assert.notEqual(second.source.citeKey, first.source.citeKey)
  assert.equal(second.source.identifiers.arxiv, '1501.00001v2'); assert.equal(second.source.identity.status, 'unverified')
  assert.deepEqual(after.ledger.evidence[evidence.evidence.id], before.ledger.evidence[evidence.evidence.id])
  assert.deepEqual(after.ledger.sources[first.source.id], before.ledger.sources[first.source.id]); assert.equal(after.document.text, before.document.text)
  const decisions = await io.list('.scholarflow/research/source-decisions')
  const decision = JSON.parse((await io.read(decisions[0].path))!.text)
  assert.equal(decision.sourceSessionId, 'ses_TEST_ONLY'); assert.equal(decision.matches[0].sourceId, first.source.id)
  assert.equal((await io.read('v1.txt'))!.text, 'TEST_ONLY first text version\r\n'); assert.equal((await io.read('v2.txt'))!.text, 'TEST_ONLY second text version\r\n')
  const bib = bibliography(`TEST_ONLY [@${first.source.citeKey}; @${second.source.citeKey}]`, after.ledger)
  assert.ok(bib.includes('https://arxiv.org/abs/1501.00001v1')); assert.ok(bib.includes('https://arxiv.org/abs/1501.00001v2'))
})
test('an exact normalized arXiv metadata duplicate keeps its stable existing record while an unversioned reference remains a separate decision', async () => {
  const { io, first } = await setup(), current = await snapshot(io)
  await assert.rejects(registerSource(io, { title: 'TEST_ONLY duplicate metadata', authors: [], kind: 'paper', identifiers: { arxiv: 'https://arxiv.org/abs/1501.00001v1' } }, current.ledger.revision), { code: 'SOURCE_ALREADY_REGISTERED' })
  assert.deepEqual((await snapshot(io)).ledger.sources[first.source.id], first.source)
  const input = { context: context(current), source: { title: 'TEST_ONLY latest metadata', authors: [], kind: 'paper' as const, identifiers: { arxiv: '1501.00001' } } }
  const plan = await prepareSourceRegistration(io, input)
  assert.equal(plan.matches[0].kind, 'same-arxiv-work')
  const record = await confirmSourceRegistration(io, plan, 'TEST_ONLY 仅记录最新版本引用，尚不能绑定具体文本。', 'ses_TEST_ONLY')
  assert.equal(record.source.identifiers.arxiv, '1501.00001'); assert.equal(record.source.textAccess, 'metadata')
})
test('similar titles are suggestions, and stale observations, different sessions or altered plans cannot approve registration', async () => {
  const { io, first, input } = await setup(), current = await snapshot(io)
  assert.equal(sourceMatches({ title: 'TEST_ONLY 具体文本版本！', identifiers: {} }, current.ledger.sources)[0].kind, 'similar-title')
  const plan = await prepareSourceRegistration(io, input), files = [...io.files], writes = io.writes
  await assert.rejects(confirmSourceRegistration(io, plan, 'TEST_ONLY reason', 'ses_OTHER'), { code: 'INVALID_APPROVAL' })
  const altered = structuredClone(plan); altered.matches[0].sourceId = 'src_TEST_ONLY_other'
  await assert.rejects(confirmSourceRegistration(io, altered, 'TEST_ONLY reason', 'ses_TEST_ONLY'), { code: 'INVALID_APPROVAL' })
  assert.deepEqual([...io.files], files); assert.equal(io.writes, writes)
  await mutateLedger(io, current.ledger.revision, ledger => { ledger.sources[first.source.id].title += ' TEST_ONLY corrected metadata' })
  const newFiles = [...io.files]
  await assert.rejects(confirmSourceRegistration(io, plan, 'TEST_ONLY reason', 'ses_TEST_ONLY'), { code: 'STALE_LEDGER_REVISION' })
  assert.equal(json([...io.files]), json(newFiles))
})
