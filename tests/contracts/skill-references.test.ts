import { test } from 'node:test'
import assert from 'node:assert/strict'
import { knownSkillReferences } from '../../src/host/skills/references.ts'
import { prepareProjectCopy, applyProjectCopy, IDENTITY_CURRENT } from '../../src/core/project/identity.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { json } from '../../src/core/store/files.ts'
import { packageSkill } from '../../src/core/skills/package.ts'
import { applyBindings, prepareBindings } from '../../src/core/skills/bindings.ts'
import { prepareWorkflow, startWorkflow } from '../../src/core/pipeline/workflow.ts'
import { prepareDraftSequence, startDraftSequence } from '../../src/core/pipeline/draft-sequence.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { prepareAutomatic, startAutomatic } from '../../src/core/pipeline/workflow-automatic.ts'
import { automaticPolicySchema } from '../../src/shared/workflow-automatic.ts'
import { prepareModelReview } from '../../src/core/review/model.ts'

// TEST_ONLY Host seam; native installed tests separately exercise real fs APIs.
async function fixture(review = false) {
  const io = new MemoryStore(); await initialize(io, await prepareInit(io, { title: 'TEST_ONLY reference scan', type: 'course-paper' }))
  const bundle = packageSkill('local:TEST_ONLY:references', [{ relativePath: 'SKILL.md', bytes: new TextEncoder().encode('---\nname: TEST_ONLY\ndescription: TEST_ONLY scan fixture\n---\nStatic text.\n') }],
    { kind: 'local', rootFingerprint: 'sha256:' + '0'.repeat(64), subpath: 'references' }, { capabilities: review ? ['review'] : ['selection-transform'], suggestedStages: review ? ['review'] : ['revision'] })
  const binding = { bindingId: 'binding_TEST_ONLY', qualifiedId: bundle.manifest.metadata.qualifiedId, digest: bundle.manifest.digest, scope: 'library' as const,
    entryPath: 'TEST_ONLY/SKILL.md', enabledStages: review ? ['review' as const] : ['revision' as const] }
  await applyBindings(io, await prepareBindings(io, [binding], async () => bundle))
  const path = (target: { path: string }) => target.path.replaceAll('\\', '/').replace(/^C:\/TEST_ONLY\//u, '')
  const host = { workspaceRegistry: { list: () => [{ id: 'workspace_TEST_ONLY', path: 'C:/TEST_ONLY' }] }, fs: {
    resolve: async (path: string) => ({ path }), processPath: (target: { path: string }) => target.path,
    contains: (_root: unknown, target: { path: string }) => target.path.replaceAll('\\', '/').startsWith('C:/TEST_ONLY/'),
    stat: async (target: { path: string }) => { const row = await io.stat(path(target)); return row && { ...row, version: (await io.read(path(target)))?.version ?? 'TEST_ONLY-directory' } },
    readText: async (target: { path: string }) => (await io.read(path(target)))!.text,
    listDir: async (target: { path: string }) => (await io.list(path(target))).map(row => ({ name: row.path.split('/').at(-1), type: row.type })),
  } }
  return { io, host, bundle }
}

test('an approved automatic review retains exact private Skill references before its child exists, including copied ancestry and corrupted-plan refusal', async () => {
  const { io, host, bundle } = await fixture(true), sessionId = 'session_TEST_ONLY'
  const { workflowId } = await startWorkflow(io, await prepareWorkflow(io, { researchQuestion: 'TEST_ONLY fixed automatic scope', minimumSources: 1, minimumLocatedEvidence: 1 }, sessionId))
  const current = await snapshot(io), review = await prepareModelReview(io, { context: { requestId: 'req_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY', sessionId,
    projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision }, assessmentScope: 'cross-section' }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' }, async () => bundle)
  const preview = await prepareAutomatic(io, workflowId, sessionId, automaticPolicySchema.parse({}), review)
  await startAutomatic(io, preview, { pid: 1, bootInstance: 'TEST_ONLY' })
  assert.equal(await io.read(`.scholarflow/runs/${review.snapshot.runId}/input.json`), undefined)
  await applyBindings(io, await prepareBindings(io, [], async () => bundle))
  const scan = await knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal)
  assert.deepEqual(scan.references, [{ workspaceId: 'workspace_TEST_ONLY', kind: 'run', recordId: preview.input.automaticId }])
  assert.doesNotMatch(JSON.stringify(scan), /C:\/TEST_ONLY/u)
  const latest = await snapshot(io), copy = await prepareProjectCopy(io, { expectedRevision: latest.ledger.revision, sourceSessionId: sessionId,
    rootFingerprint: 'sha256:' + '0'.repeat(64), reason: 'TEST_ONLY copy retains original automatic fixed resource history' })
  await applyProjectCopy(io, copy)
  assert.deepEqual((await knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal)).references, scan.references)
  const path = `.scholarflow/runs/${workflowId}/automatic/${preview.input.automaticId}/review-plan.json`
  const frozen = JSON.parse((await io.read(path))!.text); frozen.snapshot.skillDigests = []; io.externalEdit(path, json(frozen))
  await assert.rejects(knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal), { code: 'INVALID_APPROVAL' })
})

test('reference scans retain project and historical-run references and hash observations without returning root paths', async () => {
  const { io, host, bundle } = await fixture(), current = await snapshot(io)
  const scan = await knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal)
  assert.equal(scan.references.length, 1)
  assert.equal(scan.references[0].kind, 'project')
  assert.doesNotMatch(JSON.stringify(scan), /C:\/TEST_ONLY/u)
  const plan = await prepareBindings(io, [], async () => bundle); await applyBindings(io, plan)
  const removed = await knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal)
  assert.equal(removed.references.length, 0); assert.notEqual(removed.observationHash, scan.observationHash)
  io.externalEdit('.scholarflow/runs/run_TEST_ONLY/snapshot.json', json({ schemaVersion: 1, runId: 'run_TEST_ONLY', projectId: current.ledger.projectId, sessionId: 'session_TEST_ONLY', stage: 'revision',
    configHash: current.configHash, ledgerRevision: current.ledger.revision, documentHash: current.document.contentHash, outlineVersion: 0, materialHashes: {}, sourceHashes: {},
    profileHash: current.configHash, skillDigests: [{ qualifiedId: bundle.manifest.metadata.qualifiedId, digest: bundle.manifest.digest }],
    modelDescriptor: { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' }, budget: current.config.workflow.budget, networkScope: 'local-only', createdAt: new Date().toISOString() }))
  const history = await knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal)
  assert.equal(history.references[0].kind, 'run')
})

test('unknown or missing reference state cannot be treated as unreferenced', async () => {
  const { io, host, bundle } = await fixture()
  io.externalEdit('.scholarflow/resources.lock.json', json({ schemaVersion: 99, projectId: 'TEST_ONLY' }))
  await assert.rejects(knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal), { code: 'SKILL_REFERENCES_UNAVAILABLE' })
})

test('copied historical runs retain pinned resources through verified ancestry without blocking unrelated retirement or accepting unrelated project IDs', async () => {
  const { io, host, bundle } = await fixture(), current = await snapshot(io), qualifiedId = bundle.manifest.metadata.qualifiedId
  await startWorkflow(io, await prepareWorkflow(io, { researchQuestion: 'TEST_ONLY copied reference history', minimumSources: 1, minimumLocatedEvidence: 1 }, 'session_TEST_ONLY_original'))
  const path = '.scholarflow/runs/run_TEST_ONLY/snapshot.json', input = { schemaVersion: 1, runId: 'run_TEST_ONLY', projectId: current.ledger.projectId,
    sessionId: 'session_TEST_ONLY_original', stage: 'revision', configHash: current.configHash, ledgerRevision: current.ledger.revision,
    documentHash: current.document.contentHash, outlineVersion: 0, materialHashes: {}, sourceHashes: {}, profileHash: current.configHash,
    skillDigests: [{ qualifiedId, digest: bundle.manifest.digest }], modelDescriptor: { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' },
    budget: current.config.workflow.budget, networkScope: 'local-only', createdAt: new Date().toISOString() }
  io.externalEdit(path, json(input))
  const copy = await prepareProjectCopy(io, { expectedRevision: (await snapshot(io)).ledger.revision, sourceSessionId: 'session_TEST_ONLY_copy',
    rootFingerprint: 'sha256:' + '0'.repeat(64), reason: 'TEST_ONLY explicitly confirmed copied reference ancestry' })
  await applyProjectCopy(io, copy); await applyBindings(io, await prepareBindings(io, [], async () => bundle))
  const scan = await knownSkillReferences(host, qualifiedId, bundle.manifest.digest, new AbortController().signal)
  assert.deepEqual(scan.references, [{ workspaceId: 'workspace_TEST_ONLY', kind: 'run', recordId: 'run_TEST_ONLY' }])
  assert.equal((await knownSkillReferences(host, qualifiedId, 'sha256:' + '0'.repeat(64), new AbortController().signal)).references.length, 0)
  assert.equal((await io.read(path))!.text, json(input))
  io.externalEdit(path, json({ ...input, projectId: 'prj_TEST_ONLY_unrelated' }))
  await assert.rejects(knownSkillReferences(host, qualifiedId, bundle.manifest.digest, new AbortController().signal), { code: 'SKILL_REFERENCES_UNAVAILABLE' })
  io.externalEdit(path, json(input))
  const pointer = JSON.parse((await io.read(IDENTITY_CURRENT))!.text), archive = `.scholarflow/identity/history/${pointer.operationId}.json`
  io.externalEdit(archive, (await io.read(archive))!.text + ' ')
  await assert.rejects(knownSkillReferences(host, qualifiedId, bundle.manifest.digest, new AbortController().signal), { code: 'PROJECT_COPY_ARCHIVE_INVALID' })
})
test('known guided goals without fixed resources do not mask unrelated retirement; corrupt parent records remain unknown', async () => {
  const { io, host, bundle } = await fixture()
  const { workflowId } = await startWorkflow(io, await prepareWorkflow(io, { researchQuestion: 'TEST_ONLY 引用扫描', minimumSources: 1, minimumLocatedEvidence: 1 }, 'session_TEST_ONLY'))
  await applyBindings(io, await prepareBindings(io, [], async () => bundle))
  const scan = await knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal)
  assert.equal(scan.references.length, 0); assert.equal(scan.checkedRuns, 1)
  io.externalEdit(`.scholarflow/runs/${workflowId}/checkpoint.json`, '{}')
  await assert.rejects(knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal))
})
test('an initial draft sequence retains its frozen Skill version even after the current project unbinds it', async () => {
  const { io, host, bundle } = await fixture()
  const locked = JSON.parse((await io.read('.scholarflow/resources.lock.json'))!.text)
  await applyBindings(io, await prepareBindings(io, [{ ...locked.bindings[0], enabledStages: ['drafting', 'revision'] }], async () => bundle))
  const current = await snapshot(io)
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: 'TEST_ONLY', thesis: 'TEST_ONLY', confirmation: 'draft',
    sections: [{ id: 'sec_TEST_ONLY', title: '正文', purpose: '', claimIds: [], missingEvidence: [] }] }, current.ledger.revision, 0)
  await startWorkflow(io, await prepareWorkflow(io, { researchQuestion: 'TEST_ONLY', minimumSources: 1, minimumLocatedEvidence: 1 }, 'session_TEST_ONLY'))
  const latest = await snapshot(io), preview = await prepareDraftSequence(io, { context: { requestId: 'req_TEST_ONLY', sessionId: 'session_TEST_ONLY',
    workspaceId: 'workspace_TEST_ONLY', projectId: latest.ledger.projectId, expectedLedgerRevision: latest.ledger.revision }, instruction: 'TEST_ONLY', summarySectionIds: [] },
    { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' }, async () => bundle)
  await startDraftSequence(io, preview, async () => bundle)
  await applyBindings(io, await prepareBindings(io, [], async () => bundle))
  const scan = await knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal)
  assert.deepEqual(scan.references, [{ workspaceId: 'workspace_TEST_ONLY', kind: 'run', recordId: preview.input.sequenceId }])
  const path = `.scholarflow/runs/${preview.input.sequenceId}/input.json`, old = JSON.parse((await io.read(path))!.text)
  delete old.skillDigests; io.externalEdit(path, json(old))
  await assert.rejects(knownSkillReferences(host, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest, new AbortController().signal), { code: 'SKILL_REFERENCES_UNAVAILABLE' })
})
