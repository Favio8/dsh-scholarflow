import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { saveManual, buildProposal, storeProposal, applyProposal, rejectProposal, undoRevision, protectedChanges } from '../../src/core/editing/proposals.ts'
import { projectMarkdown } from '../../src/core/editing/markdown.ts'
import { registerSource } from '../../src/core/evidence/evidence.ts'
import { digest } from '../../src/core/store/files.ts'

async function setup(text = 'TEST_ONLY 重复原文 😀。\r\n\r\nTEST_ONLY 重复原文 😀。\r\n') {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 选区改写', type: 'course-paper' }))
  const current = await snapshot(io)
  await saveManual(io, text, current.document.contentHash, 0)
  return io
}
async function proposeSecond(io: MemoryStore, replacement = 'TEST_ONLY 只改第二段 😀。') {
  const current = await snapshot(io), block = projectMarkdown(current.document.text).blocks[1]
  const proposal = buildProposal(current, { runId: 'run_TEST_ONLY', instruction: 'TEST_ONLY 缩写第二段', replacementText: replacement, dependentEvidenceIds: [],
    selection: { projectId: current.config.project.id, documentId: 'paper', documentHash: current.document.contentHash, revisionId: current.document.revisionId, blockIds: [block.id], sourceRange: { startUtf16: block.start, endUtf16: block.end },
      sourceText: current.document.text.slice(block.start, block.end), renderedText: current.document.text.slice(block.start, block.end), prefixContext: '', suffixContext: '', citationKeys: [], claimIds: [], scope: 'paragraph', capturedAt: new Date().toISOString() } })
  return storeProposal(io, proposal, current.ledger.revision)
}

test('AT-11/13: proposals change no body until accepted, then affect only the second identical paragraph', async () => {
  const io = await setup(), original = (await snapshot(io)).document.text
  const stored = await proposeSecond(io)
  assert.equal((await snapshot(io)).document.text, original)
  const accepted = await applyProposal(io, stored.proposal.id, stored.revision, stored.proposalHash)
  assert.equal((await snapshot(io)).document.text, 'TEST_ONLY 重复原文 😀。\r\n\r\nTEST_ONLY 只改第二段 😀。\r\n')
  assert.ok(accepted.revisionId)
  assert.equal((await io.read(`.scholarflow/drafts/${accepted.revisionId}/preimage.md`))?.text, original)
  const before = [...io.files], writes = io.writes
  const repeated = await applyProposal(io, stored.proposal.id, stored.revision, stored.proposalHash)
  assert.equal(repeated.alreadyApplied, true)
  assert.equal(io.writes, writes); assert.deepEqual([...io.files], before)
})

test('AT-14: rejecting a proposal changes no manuscript bytes', async () => {
  const io = await setup(), original = (await snapshot(io)).document.text
  const stored = await proposeSecond(io)
  await rejectProposal(io, stored.proposal.id, stored.revision)
  assert.equal((await snapshot(io)).document.text, original)
  await assert.rejects(applyProposal(io, stored.proposal.id, stored.revision + 1, stored.proposalHash), { code: 'PROPOSAL_NOT_PENDING' })
})

test('AT-13: external edits, stale manual buffers and altered immutable suggestions are preserved', async () => {
  const io = await setup(), stored = await proposeSecond(io)
  io.externalEdit('manuscript/paper.md', 'TEST_ONLY 后续人工稿\r\n')
  await assert.rejects(applyProposal(io, stored.proposal.id, stored.revision, stored.proposalHash), { code: 'STALE_DOCUMENT_VERSION' })
  await assert.rejects(saveManual(io, '旧缓冲', stored.proposal.baseDocumentHash, stored.revision), { code: 'STALE_DOCUMENT_VERSION' })
  assert.equal((await snapshot(io)).document.text, 'TEST_ONLY 后续人工稿\r\n')
  const second = await setup(), proposal = await proposeSecond(second)
  const path = `.scholarflow/proposals/${proposal.proposal.id}.json`
  const changed = JSON.parse((await second.read(path))!.text); changed.edits[0].replacementText = '外部替换的未审阅建议'
  second.externalEdit(path, JSON.stringify(changed))
  await assert.rejects(applyProposal(second, proposal.proposal.id, proposal.revision, proposal.proposalHash), { code: 'PROPOSAL_CHANGED' })
})

test('undo is a new revision and refuses to erase later work', async () => {
  const io = await setup(), stored = await proposeSecond(io), original = (await snapshot(io)).document.text
  const accepted = await applyProposal(io, stored.proposal.id, stored.revision, stored.proposalHash)
  const reversed = await undoRevision(io, accepted.revisionId!, accepted.documentHash, stored.revision + 1)
  assert.notEqual(reversed.revisionId, accepted.revisionId)
  assert.equal((await snapshot(io)).document.text, original)
  await assert.rejects(undoRevision(io, accepted.revisionId!, accepted.documentHash, reversed.revision), { code: 'STALE_DOCUMENT_VERSION' })
})

test('citation keys remain stable in actual BibTeX and selection proposals cannot silently remove them', async () => {
  const io = await setup('TEST_ONLY 正文。')
  const source = await registerSource(io, { title: 'TEST_ONLY 用户元数据 {brace}', authors: [{ literal: '作者 TEST_ONLY' }], kind: 'paper', identifiers: {} }, 1)
  const current = await snapshot(io)
  const text = `TEST_ONLY 引用 [@${source.source.citeKey}]。`
  await saveManual(io, text, current.document.contentHash, source.revision)
  const bib = (await io.read('manuscript/references.bib'))!.text
  assert.ok(bib.includes(source.source.citeKey), bib)
  const cited = await snapshot(io), block = projectMarkdown(text).blocks[0]
  assert.throws(() => buildProposal(cited, { runId: 'run_TEST_ONLY', instruction: '去掉引用', replacementText: 'TEST_ONLY 无引用。', dependentEvidenceIds: [],
    selection: { projectId: cited.config.project.id, documentId: 'paper', documentHash: cited.document.contentHash, revisionId: cited.document.revisionId, blockIds: [block.id], sourceRange: { startUtf16: 0, endUtf16: text.length }, sourceText: text,
      renderedText: 'TEST_ONLY 引用 [1]。', prefixContext: '', suffixContext: '', citationKeys: [source.source.citeKey], claimIds: [], scope: 'paragraph', capturedAt: new Date().toISOString() } }), { code: 'CITATION_CHANGE_REQUIRES_CONFIRMATION' })
})

test('external ledger edits during a mutation are never overwritten by a refreshed CAS preimage', async () => {
  const io = await setup(), current = await snapshot(io)
  await assert.rejects(mutateLedger(io, current.ledger.revision, ledger => {
    ledger.outline.title = '旧视图的修改'
    const file = io.files.get('.scholarflow/data/ledger.json')!
    const external = JSON.parse(file.text); external.outline.title = 'TEST_ONLY 外部编辑的 ledger'
    io.externalEdit('.scholarflow/data/ledger.json', JSON.stringify(external))
  }), { code: 'STALE_LEDGER_REVISION' })
  assert.equal((await snapshot(io)).ledger.outline.title, 'TEST_ONLY 外部编辑的 ledger')
})

test('protected numbers exclude digits inside parsed citation identities', () => {
  assert.deepEqual(protectedChanges('TEST_ONLY 12 人 [@sf_123abc]。', 'TEST_ONLY 12 人 [@sf_456def]。'), [])
  assert.ok(protectedChanges('TEST_ONLY 12 人 [@sf_123abc]。', 'TEST_ONLY 20 人 [@sf_123abc]。').some(change => change.includes('12 人 → 20 人')))
})
