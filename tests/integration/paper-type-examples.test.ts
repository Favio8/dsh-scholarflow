// TEST_ONLY end-to-end domain flows. Actual example text/parser; synthetic model
// and storage. Native Host/provider evidence is maintained separately.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { projectType } from '../../src/shared/schema.ts'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { registerMaterial } from '../../src/core/materials/materials.ts'
import { parseRegisteredMaterial } from '../../src/core/materials/parse.ts'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { extractRequirements, confirmRequirement } from '../../src/core/requirements/requirements.ts'
import { registerSource, confirmEvidence, upsertClaim, confirmOutline } from '../../src/core/evidence/evidence.ts'
import { saveManual, applyProposal } from '../../src/core/editing/proposals.ts'
import { prepareWorkflow, startWorkflow, readWorkflow } from '../../src/core/pipeline/workflow.ts'
import { prepareDraftSequence, startDraftSequence, prepareDraftSequenceAction, applyDraftSequenceAction } from '../../src/core/pipeline/draft-sequence.ts'
import { executeGeneration } from '../../src/core/pipeline/generation.ts'
import { prepareAutomatic, startAutomatic, driveAutomatic } from '../../src/core/pipeline/workflow-automatic.ts'
import { automaticPolicySchema } from '../../src/shared/workflow-automatic.ts'
import { inspectReview } from '../../src/core/review/review.ts'
import { prepareDelivery, createDelivery, readDelivery } from '../../src/core/export/delivery.ts'
import { digest, json } from '../../src/core/store/files.ts'

const tasks = z.array(z.object({ type: projectType, title: z.string(), question: z.string(), limitation: z.string() }).strict()).length(3)
  .parse(JSON.parse(await readFile(new URL('../../examples/local-evidence/tasks.json', import.meta.url), 'utf8')))
const assignment = await readFile(new URL('../../examples/local-evidence/requirements.md', import.meta.url), 'utf8')
const notes = await readFile(new URL('../../examples/local-evidence/source-notes.md', import.meta.url), 'utf8')
const owner = { pid: 1, bootInstance: 'TEST_ONLY_examples' }, model = { providerId: 'TEST_ONLY', modelId: 'fixed-example-adapter' }
const signal = () => new AbortController().signal

for (const task of tasks) test(`${task.type}: example requirements → located evidence → body then summary acceptance → cold restore → honest same-version delivery`, async () => {
  let io = new MemoryStore({ 'requirements.md': assignment, 'source-notes.md': notes, 'unselected.txt': 'TEST_ONLY_UNSELECTED_EXAMPLE_SENTINEL' })
  await initialize(io, await prepareInit(io, { title: task.title, type: task.type }))
  const context = async () => { const current = await snapshot(io); return { requestId: 'req_TEST_ONLY_example', workspaceId: `workspace_TEST_ONLY_${task.type.replaceAll('-', '_')}`,
    sessionId: 'session_TEST_ONLY_example', projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision } }
  const register = async (relativePath: string, role: 'assignment' | 'notes') => {
    const material = await registerMaterial(io, { relativePath, role, confirmExcludedFile: false }, (await snapshot(io)).ledger.revision)
    const parsed = await parseRegisteredMaterial(io, material.material.id, material.revision, signal(), (bytes, format) => parseMaterialBytes(bytes, format, signal()))
    return { material, parsed }
  }
  const teacher = await register('requirements.md', 'assignment')
  const extracted = await extractRequirements(io, teacher.material.material.id, (await snapshot(io)).ledger.revision)
  assert.ok(extracted.requirements.some(row => row.kind === 'length')); assert.ok(extracted.requirements.some(row => row.kind === 'references'))
  for (const row of extracted.requirements) await confirmRequirement(io, row.id, row.kind === 'length' ? 'sf-body-han-western-v1' : undefined, (await snapshot(io)).ledger.revision)
  const reading = await register('source-notes.md', 'notes'), source = await registerSource(io, { kind: 'other', title: 'TEST_ONLY 本地证据层次练习说明', authors: [],
    identifiers: {}, materialId: reading.material.material.id }, reading.parsed.revision)
  assert.equal(source.source.identity.status, 'unverified'); assert.equal(source.source.identifiers.doi, undefined)
  const block = reading.parsed.parsed.blocks.find(row => row.text.includes('资料身份核验'))!
  assert.ok(block)
  const evidence = await confirmEvidence(io, { sourceId: source.source.id, sourceContentHash: reading.parsed.parsed.sourceContentHash,
    locator: block.locator, excerpt: block.text, kind: 'quotation' }, source.revision)
  const claim = await upsertClaim(io, { text: '本地教学说明将身份、定位与支持范围分开记录。', kind: 'author-inference', scope: '仅限这份 TEST_ONLY 教学说明，不能推广为实测研究结论。',
    evidenceLinks: [{ evidenceId: evidence.evidence.id, relation: 'supports', rationale: '所选原文直接列出这三层，仅确认教学说明自身的表述。' }], limitations: [task.limitation] }, evidence.revision)
  const human = 'TEST_ONLY 人工备注 😀：保留原文，不把教学资料当作正式论文与实验记录。'
  let current = await snapshot(io)
  await saveManual(io, `# ${task.title}\n\n## 人工备注\n\n${human}\n`, current.document.contentHash, current.ledger.revision)
  current = await snapshot(io)
  await confirmOutline(io, { version: 0, title: task.title, researchQuestion: task.question, thesis: '区分证据层次并保留任务限制。', confirmation: 'confirmed', sections: [
    { id: 'sec_TEST_ONLY_summary', title: '摘要', purpose: '总结实际已接受讨论', claimIds: [claim.claim.id], missingEvidence: [task.limitation] },
    { id: 'sec_TEST_ONLY_body', title: '证据讨论', purpose: '依据定位原文保留范围', claimIds: [claim.claim.id], missingEvidence: task.type === 'research-paper' ? ['真实实验与结果'] : [] },
    { id: 'sec_TEST_ONLY_human', title: '人工备注', purpose: '保留人工原文', claimIds: [], missingEvidence: [] },
  ] }, current.ledger.revision, 0)
  const workflow = await startWorkflow(io, await prepareWorkflow(io, { researchQuestion: task.question, minimumSources: 1, minimumLocatedEvidence: 1 }, 'session_TEST_ONLY_example'))
  const sequence = await startDraftSequence(io, await prepareDraftSequence(io, { context: await context(), instruction: 'TEST_ONLY 教学练习，保留资料范围、人工备注和所有未实施研究限制。',
    summarySectionIds: ['sec_TEST_ONLY_summary'] }, model))
  let modelRequests = 0, acceptedBody = ''
  for (const sectionId of ['sec_TEST_ONLY_body', 'sec_TEST_ONLY_summary']) {
    const preview = await prepareDraftSequenceAction(io, { context: await context(), sequenceId: sequence.sequenceId, action: 'next' })
    assert.equal(preview.generation!.input.sectionId, sectionId)
    await applyDraftSequenceAction(io, preview)
    const before = (await snapshot(io)).document.text
    const result = await executeGeneration(io, preview.generation!, owner, signal(), async request => {
      modelRequests++; assert.doesNotMatch(json(request.context), /TEST_ONLY_UNSELECTED_EXAMPLE_SENTINEL/u)
      if (sectionId === 'sec_TEST_ONLY_summary') assert.equal((request.context.manuscript as any).actualSavedManuscriptForConsistency, acceptedBody)
      const text = sectionId === 'sec_TEST_ONLY_body'
        ? `TEST_ONLY 本练习依据本地说明区分资料身份、原文定位和论点支持范围，定位成功不等于任意范围的论断都得到证明 [@${source.source.citeKey}]。${task.limitation}`
        : `TEST_ONLY 摘要仅总结已经接受的证据讨论：本文区分身份核验、文本定位与支持范围，依据仅为一份本地教学说明 [@${source.source.citeKey}]。${task.limitation}`
      const gap = task.type === 'research-paper' ? '\n\n[待补：本项目实验尚未实施，真实结果和原始记录缺失。]' : ''
      return json({ replacementText: text + gap, sectionId, paragraphClaims: [{ paragraphIndex: 0, claimIds: [claim.claim.id] }, ...(gap ? [{ paragraphIndex: 1, claimIds: [] }] : [])],
        limitations: [task.limitation, 'TEST_ONLY 固定适配器输出，不是在线模型判断。'] })
    }, () => true)
    assert.equal((await snapshot(io)).document.text, before, 'a candidate alone cannot modify the paper')
    await applyProposal(io, result.proposal!.id, (await snapshot(io)).ledger.revision, result.proposalHash!)
    acceptedBody = (await snapshot(io)).document.text; assert.ok(acceptedBody.includes(human))
    if (sectionId === 'sec_TEST_ONLY_body') io = new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text])))
  }
  await applyDraftSequenceAction(io, await prepareDraftSequenceAction(io, { context: await context(), sequenceId: sequence.sequenceId, action: 'next' }))
  const auto = await startAutomatic(io, await prepareAutomatic(io, workflow.workflowId, 'session_TEST_ONLY_example', automaticPolicySchema.parse({ workingDraftDelivery: true,
    stopRevisionReason: 'TEST_ONLY 缺口、未知与未核验身份全部保留，只交付工作草稿，不冒称完整学术成果。' })), owner)
  assert.equal((await driveAutomatic(io, workflow.workflowId, auto.automaticId, signal(), { pauseRequested: () => false })).status, 'completed-with-issues')
  const root = await readWorkflow(io, workflow.workflowId)
  assert.equal(root.checkpoint.budget!.calls.length, 2); assert.equal(modelRequests, 2)
  const review = await inspectReview(io); assert.equal(review.stale, false)
  assert.equal(review.report!.checks.find(row => row.id === 'own_research_results')?.status, task.type === 'research-paper' ? 'fail' : undefined)
  if (task.type === 'research-paper') assert.ok(review.report!.issues.some(row => row.severity === 'B0' && row.state === 'open'))
  assert.ok(review.report!.checks.some(row => row.status === 'unknown'))
  const delivery = Object.values((await snapshot(io)).ledger.deliveries)[0], exported = await readDelivery(io, delivery.id)
  assert.equal(delivery.reviewState, 'draft-incomplete'); assert.equal(exported.files.length, 3)
  const paper = exported.files.find(row => row.relativePath === 'paper.md')!.text
  assert.equal(paper, acceptedBody); assert.equal(delivery.documentHash, digest(paper))
  assert.match(exported.files.find(row => row.relativePath === 'references.bib')!.text, new RegExp(source.source.citeKey))
  assert.doesNotMatch(json(exported), /TEST_ONLY_UNSELECTED_EXAMPLE_SENTINEL/u)
  const preflight = await prepareDelivery(io)
  await assert.rejects(createDelivery(io, preflight, 'reviewed-draft', preflight.ledgerRevision), { code: 'REVIEW_NOT_READY' })
  assert.equal((await io.read('requirements.md'))!.text, assignment); assert.equal((await io.read('source-notes.md'))!.text, notes)
  assert.equal((await io.read('unselected.txt'))!.text, 'TEST_ONLY_UNSELECTED_EXAMPLE_SENTINEL')
})
