import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sourceConflictFixture, paperPath, publication } from '../fixtures/source-conflict.ts'
import { prepareWritingSourceConflict, resolveWritingSourceConflict } from '../../src/core/pipeline/source-conflict.ts'
import { driveWritingTask, type WritingServices } from '../../src/core/pipeline/writing-task.ts'
import { snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { saveWritingTask } from '../../src/core/pipeline/writing-task-store.ts'

function services(): WritingServices {
  return { signal: new AbortController().signal, pauseRequested: () => false, search: async () => [], recoverChild: async () => undefined,
    parse: async () => { throw Error('TEST_ONLY already parsed') }, generate: async () => { throw Error('TEST_ONLY stop before drafting') },
    model: async (_system, data: any) => JSON.stringify(data.blocks
      ? { summary: 'TEST_ONLY observed text', bibliography: { title: publication, authors: [] } }
      : { question: { title: 'TEST_ONLY stop after acquiring evidence', options: ['TEST_ONLY'] }, claims: [] }) }
}

test('similar titles stop with a concrete file preview rather than an unresolvable continue loop', async () => {
  const { io, task } = await sourceConflictFixture()
  const fixtureServices = services(); fixtureServices.model = async () => { throw Error('no model needed for the duplicate preview') }
  await driveWritingTask(io, task, fixtureServices)
  assert.equal(task.status, 'waiting-input'); assert.equal(task.usedModelCalls, 0)
  const question = task.questions.at(-1)!
  assert.deepEqual(question.options, [])
  assert.equal(question.sourceConflict?.materialPath, paperPath)
  assert.equal(question.sourceConflict?.matches[0].materialPath, 'reading-notes.md')
  assert.equal(Object.keys((await snapshot(io)).ledger.sources).length, 1)
})

test('explicit separation continues at the saved evidence cursor without changing original citations or evidence', async () => {
  const { io, task, source } = await sourceConflictFixture()
  await driveWritingTask(io, task, services())
  const question = task.questions.at(-1)!
  await resolveWritingSourceConflict(io, task, question.sourceConflict!.previewHash, 'TEST_ONLY current file is paper; existing file is reading notes', task.sessionId)
  question.answered = 'TEST_ONLY keep separate'; await saveWritingTask(io, task)
  await driveWritingTask(io, task, services())
  const current = await snapshot(io)
  assert.equal(Object.keys(current.ledger.sources).length, 2)
  assert.deepEqual(current.ledger.sources[source!.id], source)
  assert.equal(task.evidenceMaterialIndex, 2)
  assert.equal(task.questions.filter(row => row.sourceConflict).length, 1)
  assert.equal(task.questions.at(-1)!.title, 'TEST_ONLY stop after acquiring evidence')
  const evidence = Object.values(current.ledger.evidence)
  assert.equal(evidence.length, 1)
  assert.notEqual(evidence[0].sourceId, source!.id)
  assert.equal(evidence[0].sourceContentHash, current.ledger.materials[evidenceMaterialsId(current)].contentHash)
  assert.equal(await prepareWritingSourceConflict(io, task), undefined)
})
function evidenceMaterialsId(current: Awaited<ReturnType<typeof snapshot>>) {
  return Object.values(current.ledger.materials).find(row => row.projectRelativePath === paperPath)!.id
}

test('changed ledger previews and externally edited files cannot approve stale source registration', async () => {
  const { io, task, source } = await sourceConflictFixture()
  const preview = (await prepareWritingSourceConflict(io, task))!
  await mutateLedger(io, (await snapshot(io)).ledger.revision, ledger => { ledger.sources[source!.id].title += '!' })
  const writes = io.writes
  await assert.rejects(resolveWritingSourceConflict(io, task, preview.previewHash, 'TEST_ONLY separate text', task.sessionId), { code: 'SOURCE_PREVIEW_STALE' })
  assert.equal(io.writes, writes)
  const updated = (await prepareWritingSourceConflict(io, task))!
  io.externalEdit(paperPath, 'TEST_ONLY changed paper, not the approved parser image')
  await assert.rejects(resolveWritingSourceConflict(io, task, updated.previewHash, 'TEST_ONLY separate text', task.sessionId), { code: 'STALE_MATERIAL_VERSION' })
  assert.equal(Object.keys((await snapshot(io)).ledger.sources).length, 1)
})

test('reading notes that mention a paper do not inherit that paper bibliography', async () => {
  const { io, task } = await sourceConflictFixture(false)
  await driveWritingTask(io, task, services())
  const current = await snapshot(io), sources = Object.values(current.ledger.sources)
  assert.equal(sources.length, 2)
  const notes = sources.find(row => current.ledger.materials[row.materialId!].role === 'notes')!
  const paper = sources.find(row => current.ledger.materials[row.materialId!].role === 'paper')!
  assert.equal(notes.title, 'reading-notes.md')
  assert.equal(paper.title, publication)
  assert.equal(task.questions.some(row => row.sourceConflict), false)
})
