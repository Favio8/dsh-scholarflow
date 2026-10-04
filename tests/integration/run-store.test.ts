// TEST_ONLY legacy records; no provider IO or fabricated academic results.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { readRun, readRunInput, inspectRuns, prepareRunMigration, migrateRun, runFile, inputFile, ACTIVE_RUN } from '../../src/core/pipeline/run-store.ts'
import { digest, json } from '../../src/core/store/files.ts'

async function fixture() {
  const io = new MemoryStore(); await initialize(io, await prepareInit(io, { title: 'TEST_ONLY run migration', type: 'course-paper' }))
  const current = await snapshot(io), runId = 'run_TEST_ONLY_legacy', timestamp = new Date().toISOString()
  const state = { schemaVersion: 1, runId, projectId: current.ledger.projectId, sessionId: 'ses_TEST_ONLY', status: 'failed',
    usedModelCalls: 1, owner: { pid: 1234, bootInstance: 'TEST_ONLY' }, startedAt: timestamp, updatedAt: timestamp, errorCode: 'TEST_ONLY_FAILURE' }
  const input = { schemaVersion: 1, runId, projectId: current.ledger.projectId, sessionId: 'ses_TEST_ONLY', stage: 'revision', configHash: current.configHash,
    ledgerRevision: current.ledger.revision, documentHash: current.document.contentHash, outlineVersion: 0, materialHashes: {}, sourceHashes: {}, profileHash: digest('TEST_ONLY'),
    skillDigests: [], modelDescriptor: { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' }, budget: current.config.workflow.budget, networkScope: 'local-only', createdAt: timestamp }
  const statePath = `.scholarflow/runs/${runId}/state.json`, snapshotPath = `.scholarflow/runs/${runId}/snapshot.json`
  io.externalEdit(statePath, json(state)); io.externalEdit(snapshotPath, json(input)); io.externalEdit(ACTIVE_RUN, json(state))
  return { io, current, runId, statePath, snapshotPath, state, input }
}
test('legacy run inspection and migration preview are read-only; confirmed migration preserves every old byte and manuscript', async () => {
  const f = await fixture(), writes = f.io.writes
  assert.equal((await readRun(f.io, f.runId, f.current.ledger.projectId)).legacy, true)
  assert.equal((await inspectRuns(f.io)).runs[0].legacyStorage, true)
  const plan = await prepareRunMigration(f.io, f.runId)
  assert.equal(f.io.writes, writes)
  await migrateRun(f.io, plan)
  assert.equal((await readRun(f.io, f.runId, f.current.ledger.projectId)).legacy, false)
  assert.equal((await readRunInput(f.io, f.runId, f.current.ledger.projectId)).legacy, false)
  assert.equal((await f.io.read(f.statePath))!.text, json(f.state))
  assert.equal((await f.io.read(f.snapshotPath))!.text, json(f.input))
  assert.equal((await snapshot(f.io)).document.text, f.current.document.text)
  assert.equal((await snapshot(f.io)).ledger.revision, f.current.ledger.revision)
  // An archived legacy file never silently replaces the new authoritative state.
  f.io.externalEdit(f.statePath, 'TEST_ONLY damaged old archive')
  assert.equal((await readRun(f.io, f.runId, f.current.ledger.projectId)).run.status, 'failed')
  await assert.rejects(migrateRun(f.io, plan), { code: 'RUN_STATE_CHANGED' })
})
test('running records, cross-project identities and changed migration preimages are never silently migrated', async () => {
  const f = await fixture()
  f.io.externalEdit(f.statePath, json({ ...f.state, status: 'running' }))
  await assert.rejects(prepareRunMigration(f.io, f.runId), { code: 'RUN_IN_PROGRESS' })
  f.io.externalEdit(f.statePath, json(f.state))
  const plan = await prepareRunMigration(f.io, f.runId)
  f.io.externalEdit(f.snapshotPath, json({ ...f.input, ledgerRevision: 99 }))
  await assert.rejects(migrateRun(f.io, plan), { code: 'RUN_STATE_CHANGED' })
  assert.equal(await f.io.read(runFile(f.runId)), undefined)
  assert.equal(await f.io.read(inputFile(f.runId)), undefined)
  await assert.rejects(readRun(f.io, f.runId, 'proj_TEST_ONLY_other'), { code: 'PROJECT_ID_CONFLICT' })
  f.io.externalEdit(f.statePath, json({ ...f.state, runId: 'run_TEST_ONLY_wrong' }))
  assert.equal((await inspectRuns(f.io)).runs.length, 0)
  assert.equal((await inspectRuns(f.io)).diagnostics.length, 1)
})
