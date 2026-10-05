// TEST_ONLY: no paid model adapter; operator edits remain independent proposals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { saveManual, buildProposal, storeProposal, applyProposal, proposalImage } from '../../src/core/editing/proposals.ts'
import { prepareProposalRevision, publishProposalRevision } from '../../src/core/editing/proposal-revision.ts'
import { projectMarkdown } from '../../src/core/editing/markdown.ts'
import { registerSource, confirmOutline, confirmEvidence } from '../../src/core/evidence/evidence.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { digest } from '../../src/core/store/files.ts'
const original = 'TEST_ONLY 重复原文 12 人 😀。\r\n\r\nTEST_ONLY 重复原文 12 人 😀。\r\n'
const edited = 'TEST_ONLY 仅修改第二段 13 人 😀。'
function context(current: Awaited<ReturnType<typeof snapshot>>) {
  return { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'ses_TEST_ONLY', projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision }
}
async function setup() {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY untouched\r\n' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY candidate revision', type: 'course-paper' }))
  let current = await snapshot(io)
  await saveManual(io, original, current.document.contentHash, current.ledger.revision)
  current = await snapshot(io)
  const block = projectMarkdown(original).blocks[1], proposal = buildProposal(current, { runId: 'run_TEST_ONLY', instruction: 'TEST_ONLY 保留事实并审阅差异', dependentEvidenceIds: [], replacementText: 'TEST_ONLY 第二段 12 人 😀。',
    selection: { projectId: current.ledger.projectId, documentId: 'paper', documentHash: current.document.contentHash, revisionId: current.document.revisionId,
      blockIds: [block.id], sourceRange: { startUtf16: block.start, endUtf16: block.end }, sourceText: original.slice(block.start, block.end), renderedText: original.slice(block.start, block.end),
      prefixContext: '', suffixContext: '', citationKeys: [], claimIds: [], scope: 'paragraph', capturedAt: new Date().toISOString() } })
  const saved = await storeProposal(io, proposal, current.ledger.revision)
  const input = { context: context(await snapshot(io)), proposalId: proposal.id, proposalHash: saved.proposalHash, replacementText: edited }
  return { io, saved, input }
}
test('SF-016: preview is read-only; publication preserves parent and rechecks facts; accepting edits only the selected repeated paragraph', async () => {
  const { io, saved, input } = await setup(), writes = io.writes, files = [...io.files]
  const plan = await prepareProposalRevision(io, input)
  assert.equal(io.writes, writes); assert.deepEqual([...io.files], files)
  assert.ok(plan.proposal.protectedFactChanges.some(row => row.includes('12') && row.includes('13')))
  const published = await publishProposalRevision(io, plan, input.context.sessionId), current = await snapshot(io)
  assert.equal(current.document.text, original); assert.equal((await proposalImage(io, saved.proposal.id)).contentHash, saved.proposalHash)
  assert.deepEqual(plan.proposal.derivedFrom, { proposalId: saved.proposal.id, proposalHash: saved.proposalHash, origin: 'operator-edit' })
  assert.equal(current.ledger.proposalStates[saved.proposal.id].state, 'pending'); assert.equal(current.ledger.proposalStates[plan.proposal.id].state, 'pending')
  const record = JSON.parse((await io.read(`.scholarflow/proposals/edits/${plan.proposal.id}.json`))!.text)
  assert.equal(record.operatorSessionId, input.context.sessionId); assert.equal(record.proposalHash, published.proposalHash)
  await applyProposal(io, plan.proposal.id, current.ledger.revision, published.proposalHash)
  assert.equal((await snapshot(io)).document.text, original.slice(0, original.lastIndexOf('TEST_ONLY')) + edited + '\r\n')
  assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY untouched\r\n')
  await assert.rejects(applyProposal(io, saved.proposal.id, (await snapshot(io)).ledger.revision, saved.proposalHash), { code: 'STALE_DOCUMENT_VERSION' })
})
test('edited candidate rejects forged approval, changed parent, changed Profiles and external body without publishing', async () => {
  for (const change of ['forged', 'parent', 'profile', 'body', 'session']) {
    const { io, saved, input } = await setup(), plan = await prepareProposalRevision(io, input)
    if (change === 'forged') plan.proposal.edits[0].replacementText += 'TEST_ONLY forged'
    if (change === 'parent') io.externalEdit(`.scholarflow/proposals/${saved.proposal.id}.json`, (await io.read(`.scholarflow/proposals/${saved.proposal.id}.json`))!.text + ' ')
    if (change === 'profile') io.externalEdit('.scholarflow/profiles/writing.md', 'TEST_ONLY modified profile')
    if (change === 'body') io.externalEdit('manuscript/paper.md', original + 'TEST_ONLY later human')
    const files = [...io.files], writes = io.writes
    await assert.rejects(publishProposalRevision(io, plan, change === 'session' ? 'ses_OTHER' : input.context.sessionId))
    assert.deepEqual([...io.files], files); assert.equal(io.writes, writes)
  }
})
test('local selection citations remain intact even when the same key occurs elsewhere in the manuscript', async () => {
  const { io } = await setup(), source = await registerSource(io, { title: 'TEST_ONLY citation', authors: [], kind: 'other', identifiers: {} }, (await snapshot(io)).ledger.revision)
  let current = await snapshot(io)
  const text = `TEST_ONLY 第一段 [@${source.source.citeKey}]。\n\nTEST_ONLY 第二段 [@${source.source.citeKey}]。\n`
  await saveManual(io, text, current.document.contentHash, current.ledger.revision); current = await snapshot(io)
  const block = projectMarkdown(text).blocks[1]
  assert.throws(() => buildProposal(current, { runId: 'run_TEST_ONLY', instruction: 'TEST_ONLY 不得丢引用', dependentEvidenceIds: [], replacementText: 'TEST_ONLY 第二段。',
    selection: { projectId: current.ledger.projectId, documentId: 'paper', documentHash: current.document.contentHash, revisionId: current.document.revisionId, blockIds: [block.id],
      sourceRange: { startUtf16: block.start, endUtf16: block.end }, sourceText: text.slice(block.start, block.end), renderedText: 'TEST_ONLY 第二段 [1]。', prefixContext: '', suffixContext: '',
      citationKeys: [source.source.citeKey], claimIds: [], scope: 'paragraph', capturedAt: new Date().toISOString() } }), { code: 'CITATION_CHANGE_REQUIRES_CONFIRMATION' })
})
test('candidate editing cannot expand source scope, discard all evidence citations or publish after original material changes', async () => {
  const { io } = await setup()
  const material = await registerMaterial(io, { relativePath: 'raw.txt', role: 'notes', confirmExcludedFile: false }, (await snapshot(io)).ledger.revision)
  const parsed = await parseRegisteredMaterial(io, material.material.id, material.revision, new AbortController().signal,
    (bytes, mediaType) => parseMaterialBytes(bytes, mediaType, new AbortController().signal))
  const source = await registerSource(io, { title: 'TEST_ONLY local evidence', authors: [], kind: 'other', identifiers: {}, materialId: material.material.id }, parsed.revision)
  const evidence = await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash, locator: parsed.parsed.blocks[0].locator,
    excerpt: parsed.parsed.blocks[0].text, kind: 'quotation' }, source.revision)
  const other = await registerSource(io, { title: 'TEST_ONLY unrelated', authors: [], kind: 'other', identifiers: {} }, evidence.revision)
  const current = await snapshot(io), text = `TEST_ONLY 未验证范围 [@${source.source.citeKey}]。`
  const proposal = buildProposal(current, { runId: 'run_TEST_ONLY_evidence', instruction: 'TEST_ONLY', replacementText: text, dependentEvidenceIds: [evidence.evidence.id] })
  const saved = await storeProposal(io, proposal, current.ledger.revision), input = { context: context(await snapshot(io)), proposalId: proposal.id, proposalHash: saved.proposalHash, replacementText: text }
  await assert.rejects(prepareProposalRevision(io, { ...input, replacementText: text + ` [@${other.source.citeKey}]` }), { code: 'CITATION_SCOPE_INVALID' })
  await assert.rejects(prepareProposalRevision(io, { ...input, replacementText: 'TEST_ONLY no citation' }), { code: 'CITATION_SCOPE_INVALID' })
  const plan = await prepareProposalRevision(io, input)
  io.externalEdit('raw.txt', 'TEST_ONLY changed original material\r\n')
  const writes = io.writes, files = [...io.files]
  await assert.rejects(publishProposalRevision(io, plan, input.context.sessionId), { code: 'STALE_MATERIAL_VERSION' })
  assert.equal(io.writes, writes); assert.deepEqual([...io.files], files)
  assert.equal((await snapshot(io)).document.text, original)
})
test('section editing revalidates paragraph mappings and preserves headings and adjacent human content', async () => {
  const { io } = await setup(); let current = await snapshot(io)
  await confirmOutline(io, { ...current.ledger.outline, researchQuestion: 'TEST_ONLY 范围是什么？', thesis: 'TEST_ONLY 保留人工稿', sections: [{ id: 'sec_TEST_ONLY', title: '目标章节', purpose: '', claimIds: [], missingEvidence: [] }] }, current.ledger.revision, 0)
  current = await snapshot(io)
  const text = '# TEST_ONLY\n\n## 目标章节\n\nTEST_ONLY old\n\n## 后节\n\nTEST_ONLY human\n'
  await saveManual(io, text, current.document.contentHash, current.ledger.revision); current = await snapshot(io)
  const proposal = buildProposal(current, { runId: 'run_TEST_ONLY_section', instruction: 'TEST_ONLY', replacementText: 'TEST_ONLY candidate', dependentEvidenceIds: [],
    section: { sectionId: 'sec_TEST_ONLY', outlineVersion: current.ledger.outline.version, body: 'TEST_ONLY candidate', paragraphClaims: [{ paragraphIndex: 0, claimIds: [] }], limitations: [] } })
  const saved = await storeProposal(io, proposal, current.ledger.revision)
  const input = { context: context(await snapshot(io)), proposalId: proposal.id, proposalHash: saved.proposalHash, replacementText: 'TEST_ONLY changed\n\nTEST_ONLY second' }
  await assert.rejects(prepareProposalRevision(io, input), { code: 'SECTION_CLAIM_MAPPING_INVALID' })
  const plan = await prepareProposalRevision(io, { ...input, paragraphClaims: [{ paragraphIndex: 0, claimIds: [] }, { paragraphIndex: 1, claimIds: [] }] })
  const published = await publishProposalRevision(io, plan, input.context.sessionId)
  await applyProposal(io, plan.proposal.id, published.revision, published.proposalHash)
  assert.equal((await snapshot(io)).document.text, '# TEST_ONLY\n\n## 目标章节\n\nTEST_ONLY changed\n\nTEST_ONLY second\n\n## 后节\n\nTEST_ONLY human\n')
  assert.equal((await proposalImage(io, proposal.id)).contentHash, saved.proposalHash)
  assert.equal(digest((await io.read('raw.txt'))!.text), digest('TEST_ONLY untouched\r\n'))
})
