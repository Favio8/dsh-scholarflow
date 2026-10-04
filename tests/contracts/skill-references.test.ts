import { test } from 'node:test'
import assert from 'node:assert/strict'
import { knownSkillReferences } from '../../src/host/skills/references.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { json } from '../../src/core/store/files.ts'
import { packageSkill } from '../../src/core/skills/package.ts'
import { applyBindings, prepareBindings } from '../../src/core/skills/bindings.ts'

// TEST_ONLY Host seam; native installed tests separately exercise real fs APIs.
async function fixture() {
  const io = new MemoryStore(); await initialize(io, await prepareInit(io, { title: 'TEST_ONLY reference scan', type: 'course-paper' }))
  const bundle = packageSkill('local:TEST_ONLY:references', [{ relativePath: 'SKILL.md', bytes: new TextEncoder().encode('---\nname: TEST_ONLY\ndescription: TEST_ONLY scan fixture\n---\nStatic text.\n') }],
    { kind: 'local', rootFingerprint: 'sha256:' + '0'.repeat(64), subpath: 'references' }, { capabilities: ['selection-transform'], suggestedStages: ['revision'] })
  const binding = { bindingId: 'binding_TEST_ONLY', qualifiedId: bundle.manifest.metadata.qualifiedId, digest: bundle.manifest.digest, scope: 'library' as const,
    entryPath: 'TEST_ONLY/SKILL.md', enabledStages: ['revision' as const] }
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
