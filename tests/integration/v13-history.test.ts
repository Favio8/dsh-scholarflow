import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { createWritingTask, readWritingTask, readWritingSpec, readWritingSpecImage, taskPath, specPath, saveWritingSpec } from '../../src/core/pipeline/writing-task-store.ts'
import { digest } from '../../src/core/store/files.ts'
import { creationSpec, pendingQuestion, writingQuestion } from '../../src/shared/writing-task.ts'
import { requirementsFallback } from '../../src/core/pipeline/requirements-fallback.ts'
import { parseModel, parseStored } from '../../src/shared/errors.ts'
import { projectMarkdown } from '../../src/core/editing/markdown.ts'
import { proposeCowrite } from '../../src/core/editing/cowrite.ts'
import { readFile } from 'node:fs/promises'

async function setup() {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY historical project', type: 'course-paper' }))
  const spec = creationSpec.parse({ title: 'TEST_ONLY', type: 'course-paper', language: 'zh-CN', format: 'docx',
    requirements: 'TEST_ONLY 约1500字，九项分析', materials: ['TEST_ONLY.pdf'], targetLength: 1500,
    sections: [{ id: 'section_TEST_ONLY', title: '题名分析', targetLength: 1500 }],
    cover: { enabled: true, title: 'TEST_ONLY', fields: [{ label: '姓名', value: 'TEST_ONLY_COVER' }] } })
  const task = await createWritingTask(io, spec, 'session_TEST_ONLY', 'TEST_ONLY')
  return { io, spec, task }
}
for (const answered of [undefined, '继续']) test(`historical budget (${answered ? 'answered' : 'unanswered'}) stays readable, unchanged and never gates execution`, async () => {
  const { io, task } = await setup()
  // Sanitized from the actual legacy file, preserving its old fields and omissions.
  const row = JSON.parse(await readFile(new URL('../fixtures/legacy-budget-task.json', import.meta.url), 'utf8'))
  row.projectId = task.projectId; row.id = task.id
  if (answered === undefined) delete row.questions[0].answered; else row.questions[0].answered = answered
  await io.write(taskPath(task.id), JSON.stringify(row), await io.read(taskPath(task.id)))
  const before = await io.read(taskPath(task.id)), writes = io.writes, restored = await readWritingTask(io)
  assert.deepEqual(restored?.questions, row.questions); assert.equal(restored?.status, 'completed')
  assert.equal(restored?.questions.some(pendingQuestion), false); assert.equal(io.writes, writes)
  assert.deepEqual(await io.read(taskPath(task.id)), before)
  assert.equal(writingQuestion.safeParse(row.questions[0]).success, false, 'current producers cannot create budget questions')
})
test('damaged task and unknown question kinds have stored-data diagnostics; valid requirements remain independently readable', async () => {
  const { io, spec, task } = await setup()
  for (const value of ['{broken', JSON.stringify({ ...task, questions: [{ id: 'question_TEST_ONLY', kind: 'anything', title: 'TEST_ONLY', options: [] }] })]) {
    await io.write(taskPath(task.id), value, await io.read(taskPath(task.id)))
    await assert.rejects(readWritingTask(io), (e: any) => e.code === 'WRITING_TASK_INVALID' && e.details.category === 'stored-data')
    assert.deepEqual(await readWritingSpec(io), spec)
  }
})
test('wrong task, pointer and requirements identities are rejected instead of hidden by compatibility', async () => {
  for (const target of ['task', 'pointer', 'spec']) {
    const { io, task } = await setup(), path = target === 'task' ? taskPath(task.id) : target === 'pointer' ? '.scholarflow/writing/current.json' : specPath
    const before = (await io.read(path))!, row = JSON.parse(before.text); row.projectId = 'prj_wrong_TEST_ONLY'
    await io.write(path, JSON.stringify(row), before)
    await assert.rejects(target === 'spec' ? readWritingSpec(io) : readWritingTask(io), { code: 'SESSION_BINDING_CHANGED' })
  }
})
test('requirements data and expected hash come from the same bytes and do not read or write a task', async () => {
  const { io, spec, task } = await setup()
  await io.write(taskPath(task.id), '{broken', await io.read(taskPath(task.id)))
  const writes = io.writes, file = (await io.read(specPath))!, image = await readWritingSpecImage(io)
  assert.deepEqual(image.spec, spec); assert.equal(image.baseSpecHash, digest(file.text)); assert.equal(io.writes, writes)
  io.files.delete(specPath); assert.deepEqual(await readWritingSpecImage(io), { spec: undefined, baseSpecHash: null })
})
test('no-task projection keeps historical length, materials and explicit fields without project.id or a 4000-word template', async () => {
  const { io, spec } = await setup()
  await saveWritingSpec(io, spec, (await snapshot(io)).ledger.revision)
  const old = await snapshot(io), fallback = requirementsFallback(old)
  assert.equal(fallback.targetLength, 1500); assert.deepEqual(fallback.materials, spec.materials)
  assert.equal('id' in fallback, false); assert.equal('project' in fallback, false)
  assert.equal(fallback.title, old.config.project.title)
  const unknown = requirementsFallback({ ...old, ledger: { ...old.ledger, requirements: {} } })
  assert.equal(unknown.targetLength, undefined, 'no length is invented when the historical project has none')
})
test('model, stored JSON and request validation are separate boundaries and never expose rejected private values', () => {
  const schema = z.object({ replacementText: z.string().min(1) }).strict()
  for (const raw of ['{bad', '{"replacementText":""}', '{"replacementText":42,"secret":"PRIVATE_TEST_ONLY"}']) {
    assert.throws(() => parseModel(schema, raw, 'cowrite.propose'), (e: any) => e.code === 'INVALID_MODEL_OUTPUT' && e.details.category === 'model-response' && !JSON.stringify(e).includes('PRIVATE_TEST_ONLY'))
    assert.throws(() => parseStored(schema, raw, 'WRITING_TASK_INVALID', 'writingTask.inspect'), (e: any) => e.details.category === 'stored-data')
  }
})
test('candidate citations follow manuscript numbering, and empty model output cannot become a deletion proposal', async () => {
  assert.equal(projectMarkdown('候选 [@sf_second]', ['sf_first', 'sf_second']).leaves.find(leaf => leaf.citationKeys)?.text, '[2]')
  const { io } = await setup(), current = await snapshot(io)
  const writes = io.writes
  await assert.rejects(proposeCowrite(io, 'session_TEST_ONLY', { text: current.document.text, baseDocumentHash: current.document.contentHash,
    start: 0, end: 0, replacementText: ' ', instruction: 'TEST_ONLY' }), { code: 'INVALID_MODEL_OUTPUT' })
  assert.equal(io.writes, writes)
})
