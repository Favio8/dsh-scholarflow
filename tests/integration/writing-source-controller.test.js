import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sourceConflictFixture } from '../fixtures/source-conflict.ts'
import { saveWritingTask, readWritingTask } from '../../src/core/pipeline/writing-task-store.ts'
import { snapshot } from '../../src/core/project/project.ts'

const output = resolve('.dsh-tmp/contracts/writing-source-controller.mjs')
await mkdir(resolve('.dsh-tmp/contracts'), { recursive: true })
await build({ entryPoints: ['src/host/bridge/writing-controller.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: output,
  plugins: [{ name: 'TEST_ONLY-no-model-host', setup(builder) {
    builder.onLoad({ filter: /[\\/]executor[\\/]model\.ts$/ }, () => ({ contents: `export async function selectedModel(){ throw Error('TEST_ONLY no paid model boundary permitted') } export async function callStageModel(){ throw Error('TEST_ONLY no model') } export async function callStageModelWithImage(){ throw Error('TEST_ONLY no image model') }`, loader: 'ts' }))
    builder.onLoad({ filter: /[\\/]bridge[\\/]project-api\.ts$/ }, () => ({ contents: `export async function resolveStore(ctx){ return {io:ctx.io} }`, loader: 'ts' }))
  } }] })
const { WritingController } = await import(pathToFileURL(output).href)

test('legacy continue failures receive a read-only preview and only a concrete confirmed decision launches again', async () => {
  const { io, task, source } = await sourceConflictFixture()
  task.status = 'waiting-input'
  task.questions.push({ id: 'question_TEST_ONLY_legacy', kind: 'failure', title: 'TEST_ONLY old raw duplicate error', options: ['继续'] })
  await saveWritingTask(io, task)
  const controller = new WritingController({ io, effect() {} }, 'TEST_ONLY'), context = { requestId: 'req_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY', sessionId: task.sessionId }
  let launches = 0
  controller.launch = async () => { launches++ }
  const writes = io.writes
  const inspected = await controller.inspect({ context }, new AbortController().signal)
  const question = inspected.task.questions[0]
  assert(question.sourceConflict)
  assert.deepEqual(question.options, [])
  assert.equal(io.writes, writes, 'opening or polling never confirms the existing files')
  await assert.rejects(controller.action({ context, action: 'answer', questionId: question.id, answer: '继续' }, new AbortController().signal), { code: 'SOURCE_DUPLICATE_REVIEW_REQUIRED' })
  assert.equal((await readWritingTask(io)).questions[0].answered, undefined)
  assert.equal(launches, 0)
  const result = await controller.action({ context, action: 'answer', questionId: question.id, answer: 'TEST_ONLY paper and reading notes are different files',
    duplicateDecision: 'keep-separate', sourceConflictHash: question.sourceConflict.previewHash }, new AbortController().signal)
  assert.equal(launches, 1)
  assert.equal(result.task.questions[0].answered, 'TEST_ONLY paper and reading notes are different files')
  const after = await snapshot(io)
  assert.equal(Object.keys(after.ledger.sources).length, 2)
  assert.deepEqual(after.ledger.sources[source.id], source)
  assert.equal((await controller.inspect({ context }, new AbortController().signal)).task.questions.some(row => row.answered === undefined), false)
})
