import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { buildProposal, storeProposal, saveManual } from '../../src/core/editing/proposals.ts'
import { sectionTarget } from '../../src/core/editing/sections.ts'
import { creationSpec } from '../../src/shared/writing-task.ts'
import { createWritingTask } from '../../src/core/pipeline/writing-task-store.ts'
import { driveWritingTask, type WritingServices } from '../../src/core/pipeline/writing-task.ts'
import { digest } from '../../src/core/store/files.ts'
import { registerMaterial, recordParsed } from '../../src/core/materials/materials.ts'
import { registerSource, upsertClaim } from '../../src/core/evidence/evidence.ts'
import { prepareGeneration } from '../../src/core/pipeline/generation.ts'
import { saveWritingSpec } from '../../src/core/pipeline/writing-task-store.ts'
import { runReview } from '../../src/core/review/review.ts'

async function setup(automatic: boolean) {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY quality repair', type: 'course-paper' }))
  let current = await snapshot(io)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: 'TEST_ONLY scope', thesis: 'TEST_ONLY', confirmation: 'confirmed',
    sections: [{ id: 'section_TEST_ONLY', title: '结构分析', purpose: 'TEST_ONLY', claimIds: [], missingEvidence: [] }] }, current.ledger.revision, 0)
  current = await snapshot(io)
  await saveManual(io, '# TEST_ONLY\n\n## 结构分析\n\n' + '测试'.repeat(650) + '\n', current.document.contentHash, current.ledger.revision)
  const spec = creationSpec.parse({ title: 'TEST_ONLY', type: 'course-paper', language: 'zh-CN', format: 'docx', requirements: 'TEST_ONLY 约1000字',
    materials: [], requirementSources: [], online: false, targetLength: 1000, manuscriptDir: 'manuscript',
    sections: [{ id: 'section_TEST_ONLY', title: '结构分析', targetLength: 1000 }],
    cover: { enabled: true, title: 'TEST_ONLY', fields: [{ label: '姓名', value: 'TEST_ONLY PRIVATE COVER' }] } })
  const task = await createWritingTask(io, spec, 'session_TEST_ONLY', 'TEST_ONLY')
  task.stage = 'review'; task.sectionIndex = 1
  current = await snapshot(io)
  const range = sectionTarget(current.document.text, current.ledger.outline, 'section_TEST_ONLY')
  if (automatic) task.generatedSectionHashes.section_TEST_ONLY = digest(current.document.text.slice(range.startUtf16, range.endUtf16))
  let calls = 0, revisions = 0
  const services: WritingServices = { signal: new AbortController().signal, pauseRequested: () => false, parse: async () => { throw Error('unexpected parse') },
    search: async () => [], recoverChild: async () => undefined,
    model: async (_system, data) => { calls++; assert.equal(JSON.stringify(data).includes('PRIVATE COVER'), false); return JSON.stringify({ issues: [], summary: 'TEST_ONLY simulated review', sectionRevisions: [] }) },
    generate: async (sectionId, instruction) => {
      revisions++; const current = await snapshot(io)
      const proposal = buildProposal(current, { runId: 'run_TEST_ONLY_revision', instruction, replacementText: '', dependentEvidenceIds: [],
        section: { sectionId, outlineVersion: current.ledger.outline.version, body: '测试'.repeat(475), paragraphClaims: [{ paragraphIndex: 0, claimIds: [] }], limitations: ['TEST_ONLY simulated provider'] } })
      await storeProposal(io, proposal, current.ledger.revision); return { proposalId: proposal.id }
    } }
  return { io, task, services, counts: () => ({ calls, revisions }) }
}
test('an oversized automatically generated section is repaired and checked again; cover identity stays out of model context', async () => {
  const { io, task, services, counts } = await setup(true)
  await driveWritingTask(io, task, services)
  assert.equal(task.status, 'completed'); assert.deepEqual(counts(), { calls: 2, revisions: 1 })
  assert.ok((await snapshot(io)).document.text.includes('测试'.repeat(475)))
  assert.equal(task.revisionPlan, undefined)
})
test('quality repair produces a proposal for human content and waits for an explicit decision', async () => {
  const { io, task, services, counts } = await setup(false), before = (await snapshot(io)).document.text
  await driveWritingTask(io, task, services)
  assert.equal(task.status, 'waiting-input'); assert.equal(task.questions.at(-1)?.kind, 'conflict')
  assert.ok(task.pendingProposalId); assert.equal((await snapshot(io)).document.text, before)
  assert.deepEqual(counts(), { calls: 1, revisions: 1 })
})

test('located semantic findings return to the protected revision path before completion', async () => {
  const { io, task, services, counts } = await setup(true)
  let reviews = 0
  services.review = async () => {
    const report = (await runReview(io, (await snapshot(io)).ledger.revision)).report
    if (++reviews === 1) {
      const current = await snapshot(io), range = sectionTarget(current.document.text, current.ledger.outline, 'section_TEST_ONLY')
      report.checks.push({ id: 'style_assessment', status: 'fail', method: 'model-assisted', detail: 'TEST_ONLY located wording needs correction' })
      report.issues.push({ id: 'issue_TEST_ONLY_semantic', reviewId: report.id, category: 'style', severity: 'B2', title: 'TEST_ONLY imprecise wording',
        explanation: 'TEST_ONLY replacement must stay inside the located section', suggestedFix: 'TEST_ONLY revise the wording',
        claimIds: [], evidenceIds: [], requirementIds: [], checkMethod: 'model-assisted', state: 'open', stale: false,
        location: { blockId: 'block_TEST_ONLY', sourceRange: { startUtf16: range.startUtf16, endUtf16: range.startUtf16 + 2 }, quote: '测试', blockTextHash: digest('测试') } })
    }
    return report
  }
  await driveWritingTask(io, task, services)
  assert.equal(task.status, 'completed'); assert.equal(reviews, 2)
  assert.deepEqual(counts(), { calls: 2, revisions: 2 })
  assert.ok(task.issues.some(row => row.object === '全文审查' && row.what.includes('TEST_ONLY located wording') && row.group === 'handled'))
  assert.ok(!task.issues.some(row => row.object === '全文审查' && row.what.includes('TEST_ONLY located wording') && row.group === 'needs-action'))
})

test('a repeated located semantic failure pauses rather than reporting quality success', async () => {
  const { io, task, services } = await setup(true)
  services.review = async () => {
    const current = await snapshot(io), report = (await runReview(io, current.ledger.revision)).report
    const range = sectionTarget(current.document.text, current.ledger.outline, 'section_TEST_ONLY')
    report.issues.push({ id: 'issue_TEST_ONLY_stall', reviewId: report.id, category: 'style', severity: 'B2', title: 'TEST_ONLY repeated wording',
      explanation: 'TEST_ONLY no improvement after the previous revision', suggestedFix: 'TEST_ONLY fix this wording',
      claimIds: [], evidenceIds: [], requirementIds: [], checkMethod: 'model-assisted', state: 'open', stale: false,
      location: { blockId: 'block_TEST_ONLY', sourceRange: { startUtf16: range.startUtf16, endUtf16: range.startUtf16 + 2 }, quote: '测试', blockTextHash: digest('测试') } })
    return report
  }
  await driveWritingTask(io, task, services)
  assert.equal(task.status, 'waiting-input'); assert.equal(task.questions.at(-1)?.kind, 'failure')
  assert.match(task.questions.at(-1)!.title, /同一全文检查问题/)
})

test('evidence acquisition retains every readable block, including a long late reference; section context keeps unlinked surrounding text', async () => {
  const { io, task, services } = await setup(false)
  const texts = ['TEST_ONLY title', 'TEST_ONLY authors and addresses', 'TEST_ONLY abstract beginning', 'TEST_ONLY abstract ending',
    'TEST_ONLY methods', 'TEST_ONLY results', 'TEST_ONLY discussion', 'TEST_ONLY references ' + 'x'.repeat(2200)]
  const raw = texts.join('\n'); io.externalEdit('paper.txt', raw)
  const material = (await registerMaterial(io, { relativePath: 'paper.txt', role: 'paper', confirmExcludedFile: false }, (await snapshot(io)).ledger.revision)).material
  await recordParsed(io, { schemaVersion: 1, materialId: material.id, sourceContentHash: digest(raw), parser: { id: 'TEST_ONLY', version: '1' },
    coverage: 'complete', warnings: [], unprocessedContent: [], ranges: [{ kind: 'paragraphs', from: 1, to: texts.length }],
    blocks: texts.map((text, index) => ({ text, kind: 'paragraph', locator: { kind: 'text', lineStart: index + 1, lineEnd: index + 1 } })) }, (await snapshot(io)).ledger.revision)
  task.spec.materials = ['paper.txt']; task.stage = 'evidence'; task.sectionIndex = 0
  await saveWritingSpec(io, task.spec, (await snapshot(io)).ledger.revision)
  services.model = async (_system, data: any) => {
    if (data.blocks) return JSON.stringify({ summary: 'TEST_ONLY all blocks were read', bibliography: {} })
    assert.deepEqual(data.evidence.map((row: any) => row.excerpt), texts)
    return JSON.stringify({ question: { title: 'TEST_ONLY stop after observing full evidence', options: ['TEST_ONLY'] }, claims: [] })
  }
  await driveWritingTask(io, task, services)
  assert.equal(task.status, 'waiting-input'); let current = await snapshot(io)
  const evidence = Object.values(current.ledger.evidence)
  assert.deepEqual(evidence.map(row => row.excerpt), texts)
  const claim = await upsertClaim(io, { text: 'TEST_ONLY limited claim', kind: 'author-inference', scope: 'section_TEST_ONLY', limitations: [],
    evidenceLinks: [{ evidenceId: evidence[0].id, relation: 'supports', rationale: 'TEST_ONLY exact title only' }] }, current.ledger.revision)
  current = await snapshot(io)
  await confirmOutline(io, { ...current.ledger.outline, sections: current.ledger.outline.sections.map(section => ({ ...section, claimIds: [claim.claim.id] })) }, current.ledger.revision, current.ledger.outline.version)
  current = await snapshot(io)
  const request = { context: { requestId: 'req_TEST_ONLY', sessionId: 'ses_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision }, sectionId: 'section_TEST_ONLY', instruction: 'TEST_ONLY report' }
  const model = { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' }
  assert.equal((await prepareGeneration(io, request, model)).evidenceIds.length, 1)
  const full = await prepareGeneration(io, request, model, undefined, { includeSourceContext: true })
  assert.equal(full.evidenceIds.length, texts.length)
  assert.equal((full.context.claims as any[])[0].evidenceLinks.length, 1, 'context coverage does not upgrade a claim support relation')
  assert.equal((await io.read('paper.txt'))?.text, raw)
})

test('confirmed approximate length has a checkable counting policy and both bounds', async () => {
  const { io, task } = await setup(true)
  await saveWritingSpec(io, task.spec, (await snapshot(io)).ledger.revision)
  const { report } = await runReview(io, (await snapshot(io)).ledger.revision)
  assert.equal(report.checks.find(row => row.id === 'requirement_writing_length')?.status, 'pass')
  assert.equal(report.checks.find(row => row.id === 'requirement_writing_length_max')?.status, 'fail')
})
