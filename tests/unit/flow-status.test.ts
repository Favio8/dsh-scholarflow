import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { runReview, inspectReview } from '../../src/core/review/review.ts'
import { creationSpec, writingTaskSchema } from '../../src/shared/writing-task.ts'
import { materialSchema, requirementSchema } from '../../src/shared/schema.ts'
import { flowNodes } from '../../src/client/flow-status.ts'

async function fixture() {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 流程', type: 'course-paper' }))
  const project = await snapshot(io)
  const spec = creationSpec.parse({ title: 'TEST_ONLY', type: 'course-paper', language: 'zh-CN', format: 'docx', requirements: 'TEST_ONLY 已确认要求',
    materials: [], online: false, targetLength: 500, sections: [{ id: 'sec_TEST_ONLY', title: '正文', targetLength: 500 }], manuscriptDir: 'manuscript' })
  const task = writingTaskSchema.parse({ schemaVersion: 1, id: 'writing_TEST_ONLY', projectId: project.ledger.projectId, sessionId: 'session_TEST_ONLY', spec,
    mode: 'first-draft', status: 'running', stage: 'drafting', revision: 1, materialIndex: 0, sectionIndex: 0, usedModelCalls: 0, usedSearchQueries: 0,
    elapsedMs: 0, owner: 'TEST_ONLY', expectedDocumentHash: project.document.contentHash, questions: [], notes: [], issues: [], onlineSources: [],
    createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' })
  return { io, project, spec, task }
}
const node = (project: Parameters<typeof flowNodes>[0], id: string, options: Parameters<typeof flowNodes>[1] = {}) => flowNodes(project, options).find(row => row.id === id)!

test('empty projects do not turn the placeholder or unstarted checks into completed stages', async () => {
  const { project } = await fixture(), before = JSON.stringify(project)
  assert(flowNodes(project).every(row => row.state === 'pending'))
  assert.equal(JSON.stringify(project), before, 'Displaying status cannot mutate authoritative state')
})

test('saved requirements and confirmed outline are independent of running and paused drafting', async () => {
  const { project, spec, task } = await fixture()
  project.ledger.outline = { ...project.ledger.outline, confirmation: 'confirmed', sections: [{ id: 'sec_TEST_ONLY', title: '正文', purpose: '', claimIds: [], missingEvidence: [] }] }
  const active = flowNodes(project, { spec, task })
  assert.equal(active.find(row => row.id === 'requirements')!.state, 'completed')
  assert.equal(active.find(row => row.id === 'outline')!.state, 'completed')
  assert.equal(active.find(row => row.id === 'draft')!.state, 'running')
  for (const status of ['paused', 'interrupted', 'cancelled'] as const) assert.equal(node(project, 'draft', { task: { ...task, status } }).state, 'paused')
  for (const status of ['waiting-input', 'failed'] as const) assert.equal(node(project, 'draft', { task: { ...task, status } }).state, 'attention')
  assert.equal(node(project, 'review', { task }).state, 'pending')
})

test('material selection ignores unselected failures but preserves partial and stale selected input', async () => {
  const { project } = await fixture()
  const material = (id: string, path: string, parseStatus: string) => materialSchema.parse({ id, projectRelativePath: path, role: 'paper', mediaType: 'text/plain', sizeBytes: 20, parseStatus, parsedRanges: [] })
  project.config.materials.include = ['selected.txt']
  project.ledger.materials = { mat_selected: material('mat_selected', 'selected.txt', 'ready'), mat_other: material('mat_other', 'other.txt', 'failed') }
  assert.equal(node(project, 'materials').state, 'completed')
  for (const parseStatus of ['partial', 'failed', 'unsupported', 'stale'] as const) {
    project.ledger.materials.mat_selected.parseStatus = parseStatus
    assert.equal(node(project, 'materials').state, 'attention')
  }
  project.config.materials.include.push('not-read.txt')
  project.ledger.materials.mat_selected.parseStatus = 'ready'
  assert.equal(node(project, 'materials').state, 'pending', 'An unregistered selected file is still unread')
})

test('current unconfirmed requirements and outline remain visible even with saved draft text', async () => {
  const { project, spec } = await fixture()
  project.document.initialPlaceholder = false
  project.ledger.requirements.req_TEST_ONLY = requirementSchema.parse({ id: 'req_TEST_ONLY', kind: 'other', description: 'TEST_ONLY 冲突', origin: { type: 'user' }, confirmation: 'conflicting', verificationMethod: 'manual' })
  project.ledger.outline.sections = [{ id: 'sec_TEST_ONLY', title: '正文', purpose: '', claimIds: [], missingEvidence: [] }]
  assert.equal(node(project, 'requirements', { spec }).state, 'attention')
  assert.equal(node(project, 'outline').state, 'attention')
  assert.equal(node(project, 'draft').state, 'completed')
})

test('completing generation never completes review and preserves current draft gaps', async () => {
  const { project, task } = await fixture()
  project.document.initialPlaceholder = false
  task.status = 'completed'; task.stage = 'completed'; task.outcome = 'draft-with-gaps'
  assert.equal(node(project, 'draft', { task }).state, 'attention')
  assert.equal(node(project, 'review', { task }).state, 'pending')
  project.document.contentHash = 'a'.repeat(64)
  assert.equal(node(project, 'draft', { task }).state, 'completed', 'Historical gaps do not override a newer manuscript')
})

test('real rules-only review stays unresolved, and a later manuscript invalidates it', async () => {
  const { io, project } = await fixture()
  await saveManual(io, '# TEST_ONLY\n\nTEST_ONLY 当前正文。', project.document.contentHash, project.ledger.revision)
  let saved = await snapshot(io)
  await runReview(io, saved.ledger.revision)
  saved = await snapshot(io)
  const review = await inspectReview(io)
  assert.equal(node(saved, 'review', { review }).state, 'attention', 'Rules do not complete unperformed semantic checks')
  await saveManual(io, saved.document.text + '\nTEST_ONLY 新内容。', saved.document.contentHash, saved.ledger.revision)
  saved = await snapshot(io)
  assert.equal(node(saved, 'review', { review }).state, 'stale')
  assert.equal(node(saved, 'review', { review: await inspectReview(io) }).state, 'stale')
})

test('all-pass report is current only for saved input; unknown, dirty and failed checks stay distinct', async () => {
  const { io, project } = await fixture()
  await runReview(io, project.ledger.revision)
  const review = await inspectReview(io), report = { ...review.report!, checks: [{ id: 'TEST_ONLY', status: 'pass' as const, method: 'deterministic' as const, detail: 'TEST_ONLY' }] }
  assert.equal(node(project, 'review', { review: { report, stale: false } }).state, 'completed')
  assert.equal(node(project, 'review', { review: { report, stale: false }, dirty: true }).state, 'stale')
  assert.equal(node(project, 'review', { review: { report: { ...report, checks: [{ ...report.checks[0], status: 'unknown' }] }, stale: false } }).state, 'attention')
  for (const reviewActivity of ['running', 'paused', 'stopped', 'failed'] as const)
    assert.equal(node(project, 'review', { review: { report, stale: false }, reviewActivity }).state, reviewActivity === 'running' ? 'running' : reviewActivity === 'failed' ? 'attention' : 'paused')
})
