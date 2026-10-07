// TEST_ONLY: real parser and guarded persistence, deterministic model adapter.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { proposalOf, proposalHashOf, revisionOf } from '../fixtures/generation-result.ts'
import { initialize, prepareInit, snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { registerSource, confirmEvidence, upsertClaim, confirmOutline } from '../../src/core/evidence/evidence.ts'
import { saveManual, applyProposal, buildProposal, storeProposal } from '../../src/core/editing/proposals.ts'
import { sectionTarget, sectionEdit } from '../../src/core/editing/sections.ts'
import { projectMarkdown } from '../../src/core/editing/markdown.ts'
import { prepareGeneration, executeGeneration } from '../../src/core/pipeline/generation.ts'
import { digest } from '../../src/core/store/files.ts'
import { upsertAnchor } from '../../src/core/editing/anchors.ts'

async function setup(text = '# TEST_ONLY 人工标题\r\n\r\n## 人工前节\r\n\r\n人工内容不改 😀。\r\n\r\n## 证据与范围\r\n\r\n旧节内容。\r\n\r\n### 已有人工作品\r\n\r\n子节原文。\r\n\r\n## 人工后节\r\n\r\n后节原文。\r\n') {
  const io = new MemoryStore({ '原始资料.txt': 'TEST_ONLY 仅限当前资料；未运行本项目实验。\r\n' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 章节生成', type: 'research-paper' }))
  let current = await snapshot(io)
  await saveManual(io, text, current.document.contentHash, current.ledger.revision)
  current = await snapshot(io)
  const material = await registerMaterial(io, { relativePath: '原始资料.txt', role: 'notes', confirmExcludedFile: false }, current.ledger.revision)
  const parsed = await parseRegisteredMaterial(io, material.material.id, material.revision, new AbortController().signal,
    (bytes, mediaType) => parseMaterialBytes(bytes, mediaType, new AbortController().signal))
  const source = await registerSource(io, { title: 'TEST_ONLY 局部资料', authors: [], kind: 'other', identifiers: {}, materialId: material.material.id }, parsed.revision)
  const evidence = await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: parsed.parsed.sourceContentHash,
    locator: parsed.parsed.blocks[0].locator, excerpt: parsed.parsed.blocks[0].text, kind: 'quotation' }, source.revision)
  const claim = await upsertClaim(io, { text: 'TEST_ONLY 未运行实验', kind: 'planned-experiment', scope: '仅本项目',
    evidenceLinks: [{ evidenceId: evidence.evidence.id, relation: 'background', rationale: '只说明资料的限定范围' }], limitations: ['尚无结果'] }, evidence.revision)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: '范围是什么？', thesis: '不得编造', confirmation: 'draft', sections: [
    { id: 'sec_before', title: '人工前节', purpose: '', claimIds: [], missingEvidence: [] },
    { id: 'sec_target', title: '证据与范围', purpose: '限定范围', claimIds: [claim.claim.id], missingEvidence: ['真实实验结果'] },
    { id: 'sec_child', parentId: 'sec_target', title: '已有人工作品', purpose: '', claimIds: [], missingEvidence: [] },
    { id: 'sec_after', title: '人工后节', purpose: '', claimIds: [], missingEvidence: [] },
  ] }, claim.revision, 0)
  const output = { replacementText: `TEST_ONLY 只在资料范围内讨论 [@${source.source.citeKey}]。\n\n[待补：真实结果与原始记录，当前尚未完成]`,
    sectionId: 'sec_target', paragraphClaims: [{ paragraphIndex: 0, claimIds: [claim.claim.id] }, { paragraphIndex: 1, claimIds: [] }], limitations: ['真实实验尚未完成'] }
  current = await snapshot(io)
  const input = { context: { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'ses_TEST_ONLY', projectId: current.config.project.id, expectedLedgerRevision: current.ledger.revision },
    sectionId: 'sec_target', instruction: 'TEST_ONLY 只生成目标章节并保留真实缺口' }
  return { io, input, output, claim, source }
}
const model = { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' }, owner = { pid: 1234, bootInstance: 'TEST_ONLY' }

test('SF-013: section candidates preserve headings, adjacent chapters and nested human content; accepted paragraphs trace to scoped claims', async () => {
  const { io, input, output, claim } = await setup(), before = await snapshot(io)
  // Existing anchors outside this patch remain exact even after source offsets shift.
  const last = projectMarkdown(before.document.text).blocks.at(-1)!
  await mutateLedger(io, before.ledger.revision, ledger => { ledger.claimAnchors.anchor_TEST_ONLY = { id: 'anchor_TEST_ONLY', documentId: 'paper', documentHash: before.document.contentHash,
    blockId: last.id, blockTextHash: digest(before.document.text.slice(last.start, last.end)), claimIds: [claim.claim.id], status: 'current' } })
  input.context.expectedLedgerRevision++
  const plan = await prepareGeneration(io, input, model)
  assert.equal(plan.sectionTarget?.mode, 'replace-body')
  assert.equal((plan.context.outline as any).sections.length, 1)
  assert.ok((plan.context.manuscript as any).actualSavedManuscriptForConsistency.includes('子节原文。'))
  const result = await executeGeneration(io, plan, owner, new AbortController().signal, async () => JSON.stringify(output), () => true)
  assert.equal((await snapshot(io)).document.text, before.document.text)
  assert.equal(proposalOf(result).scope, 'section')
  const edit = proposalOf(result).edits[0]
  const accepted = await applyProposal(io, proposalOf(result).id, revisionOf(result), proposalHashOf(result)), after = await snapshot(io)
  assert.equal(after.document.text, before.document.text.slice(0, edit.startUtf16) + edit.replacementText + before.document.text.slice(edit.endUtf16))
  assert.ok(after.document.text.includes('### 已有人工作品\r\n\r\n子节原文。'))
  assert.ok(after.document.text.includes('[待补：真实结果与原始记录，当前尚未完成]'))
  assert.equal(after.ledger.claims[claim.claim.id].status, 'unsupported', 'mapping never upgrades academic support')
  const anchors = Object.values(after.ledger.claimAnchors)
  assert.equal(anchors.length, 2)
  for (const anchor of anchors) {
    assert.equal(anchor.status, 'current'); assert.equal(anchor.documentHash, accepted.documentHash)
    const block = projectMarkdown(after.document.text).blocks.find(row => row.id === anchor.blockId)!
    assert.equal(digest(after.document.text.slice(block.start, block.end)), anchor.blockTextHash)
  }
  assert.equal((await io.read('原始资料.txt'))!.text, 'TEST_ONLY 仅限当前资料；未运行本项目实验。\r\n')
})

test('missing sections insert in outline order without replacing any existing human bytes', async () => {
  const { io, input, output } = await setup('# TEST_ONLY\n\n## 人工前节\n\n前节。\n\n## 人工后节\n\n后节。\n')
  const before = await snapshot(io), plan = await prepareGeneration(io, input, model)
  assert.equal(plan.sectionTarget?.mode, 'insert')
  const result = await executeGeneration(io, plan, owner, new AbortController().signal, async () => JSON.stringify(output), () => true)
  const edit = proposalOf(result).edits[0]
  assert.equal(edit.startUtf16, before.document.text.indexOf('## 人工后节'))
  assert.equal(edit.expectedText, '')
  await applyProposal(io, proposalOf(result).id, revisionOf(result), proposalHashOf(result))
  const after = await snapshot(io)
  assert.equal(after.document.text.slice(0, edit.startUtf16), before.document.text.slice(0, edit.startUtf16))
  assert.equal(after.document.text.slice(edit.startUtf16 + edit.replacementText.length), before.document.text.slice(edit.startUtf16))
  assert.equal(Object.values(after.ledger.claimAnchors).filter(row => row.status === 'current').length, 1)
})

test('wrong section IDs, fabricated claim maps and out-of-scope headings fail after one repair without a body patch', async () => {
  for (const kind of ['id', 'map', 'heading', 'missing-map']) {
    const { io, input, output } = await setup(), before = await snapshot(io), plan = await prepareGeneration(io, input, model)
    const bad = { ...output }
    if (kind === 'id') bad.sectionId = 'sec_after'
    if (kind === 'map') bad.paragraphClaims = [{ paragraphIndex: 0, claimIds: ['cl_FAKE'] }, { paragraphIndex: 1, claimIds: [] }]
    if (kind === 'heading') bad.replacementText = '## 人工后节\n\n' + output.replacementText
    if (kind === 'missing-map') bad.paragraphClaims = []
    let calls = 0
    await assert.rejects(executeGeneration(io, plan, owner, new AbortController().signal, async () => { calls++; return JSON.stringify(bad) }, () => true), { code: 'MODEL_OUTPUT_INVALID' })
    assert.equal(calls, 2); assert.equal((await snapshot(io)).document.text, before.document.text)
    assert.deepEqual((await snapshot(io)).ledger.proposalStates, {})
  }
})

test('ambiguous titles, wrong hierarchy and reordered chapters refuse targets rather than guess', async () => {
  const { io } = await setup(), current = await snapshot(io), outline = current.ledger.outline
  assert.throws(() => sectionTarget(current.document.text + '\n## 证据与范围\n\n重复目标。', outline, 'sec_target'), { code: 'SECTION_TARGET_AMBIGUOUS' })
  assert.throws(() => sectionTarget(current.document.text.replace('## 证据与范围', '### 证据与范围'), outline, 'sec_target'), { code: 'SECTION_SCOPE_UNSUPPORTED' })
  assert.throws(() => sectionTarget('## 人工后节\n\n后\n\n## 人工前节\n\n前', outline, 'sec_target'), { code: 'SECTION_ORDER_CONFLICT' })
  assert.throws(() => sectionTarget('# TEST_ONLY', outline, 'sec_child'), { code: 'SECTION_PARENT_REQUIRED' })
})

test('stale section candidates and altered patch scope never overwrite external changes', async () => {
  const { io, output } = await setup(), before = await snapshot(io)
  const section = { sectionId: output.sectionId, outlineVersion: before.ledger.outline.version, body: output.replacementText,
    paragraphClaims: output.paragraphClaims, limitations: output.limitations }
  assert.throws(() => sectionEdit(before.document.text, before.ledger.outline, { ...section, outlineVersion: 0 }), { code: 'STALE_OUTLINE_VERSION' })
  const proposal = buildProposal(before, { runId: 'run_TEST_ONLY', instruction: 'TEST_ONLY', replacementText: output.replacementText, section, dependentEvidenceIds: [] })
  proposal.edits[0].startUtf16 = 0; proposal.edits[0].expectedText = before.document.text.slice(0, proposal.edits[0].endUtf16)
  const stored = await storeProposal(io, proposal, before.ledger.revision)
  await assert.rejects(applyProposal(io, proposal.id, stored.revision, stored.proposalHash), { code: 'PROPOSAL_RANGE_INVALID' })
  io.externalEdit('manuscript/paper.md', 'TEST_ONLY 外部人工更正')
  await assert.rejects(applyProposal(io, proposal.id, stored.revision, stored.proposalHash), { code: 'STALE_DOCUMENT_VERSION' })
  assert.equal((await io.read('manuscript/paper.md'))!.text, 'TEST_ONLY 外部人工更正')
})

test('manual anchor confirmation uses the exact current paragraph and never upgrades support or changes manuscript bytes', async () => {
  const { io, claim } = await setup(), before = await snapshot(io), block = projectMarkdown(before.document.text).blocks[0]
  const input = { documentHash: before.document.contentHash, blockId: block.id, blockTextHash: digest(before.document.text.slice(block.start, block.end)), claimIds: [claim.claim.id] }
  const result = await upsertAnchor(io, input, before.ledger.revision)
  assert.equal((await snapshot(io)).document.text, before.document.text)
  assert.equal((await snapshot(io)).ledger.claims[claim.claim.id].status, 'unsupported')
  assert.equal(result.anchor?.status, 'current')
  await assert.rejects(upsertAnchor(io, { ...input, blockTextHash: digest('TEST_ONLY forged paragraph') }, result.revision), { code: 'ANCHOR_TARGET_CHANGED' })
  await assert.rejects(upsertAnchor(io, { ...input, claimIds: ['cl_FAKE'] }, result.revision), { code: 'CLAIM_NOT_FOUND' })
  await assert.rejects(upsertAnchor(io, input, result.revision), { code: 'ANCHOR_ALREADY_EXISTS' })
  const change = await saveManual(io, before.document.text.replace('人工内容不改 😀。', '人工新内容 😀。'), before.document.contentHash, result.revision)
  const after = await snapshot(io)
  assert.equal(after.ledger.claimAnchors[result.anchor!.id].status, 'needs-remap')
  await assert.rejects(upsertAnchor(io, { ...input, anchorId: result.anchor!.id }, change.revision), { code: 'STALE_DOCUMENT_VERSION' })
  const newBlock = projectMarkdown(after.document.text).blocks[0]
  const remap = await upsertAnchor(io, { ...input, anchorId: result.anchor!.id, documentHash: after.document.contentHash, blockId: newBlock.id,
    blockTextHash: digest(after.document.text.slice(newBlock.start, newBlock.end)) }, change.revision)
  assert.equal(remap.anchor?.id, result.anchor!.id)
  assert.equal(remap.anchor?.status, 'current')
  const removed = await upsertAnchor(io, { ...input, anchorId: remap.anchor!.id, documentHash: after.document.contentHash, blockId: newBlock.id,
    blockTextHash: remap.anchor!.blockTextHash, claimIds: [] }, remap.revision)
  assert.equal(removed.removed, true); assert.equal(Object.keys((await snapshot(io)).ledger.claimAnchors).length, 0)
})

test('manual edits never remap an old anchor to one of two identical paragraphs by similarity', async () => {
  const { io, claim } = await setup('# TEST_ONLY\n\n唯一原段落。\n'), before = await snapshot(io), block = projectMarkdown(before.document.text).blocks[0]
  const linked = await upsertAnchor(io, { documentHash: before.document.contentHash, blockId: block.id,
    blockTextHash: digest('唯一原段落。'), claimIds: [claim.claim.id] }, before.ledger.revision)
  await saveManual(io, '# TEST_ONLY\n\n唯一原段落。\n\n唯一原段落。\n', before.document.contentHash, linked.revision)
  assert.equal((await snapshot(io)).ledger.claimAnchors[linked.anchor!.id].status, 'needs-remap')
})
