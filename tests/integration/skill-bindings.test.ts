import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { packageSkill } from '../../src/core/skills/package.ts'
import { prepareBindings, applyBindings, readBindings, resolveStageSkills, selectSkillStage, currentSkillStage, RESOURCE_LOCK } from '../../src/core/skills/bindings.ts'
import { digest, json } from '../../src/core/store/files.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { projectMarkdown } from '../../src/core/editing/markdown.ts'
import { prepareGeneration, executeGeneration } from '../../src/core/pipeline/generation.ts'
import type { ResourceBinding } from '../../src/shared/skills.ts'

const bytes = (text: string) => new TextEncoder().encode(text)
function fixtureResource(text = 'TEST_ONLY retain uncertainty and citations') {
  return packageSkill('local:TEST_ONLY:revision', [{ relativePath: 'SKILL.md', bytes: bytes(`---\nname: TEST_ONLY-revision\ndescription: TEST_ONLY immutable stage resource\n---\n${text}\n`) },
    { relativePath: 'references/limits.md', bytes: bytes('TEST_ONLY fixed scope reference') }],
  { kind: 'local', rootFingerprint: digest('TEST_ONLY'), subpath: 'revision' }, { capabilities: ['selection-transform'], suggestedStages: ['revision'] })
}
const binding = (resource = fixtureResource(), stages: ResourceBinding['enabledStages'] = ['revision']): ResourceBinding => ({ bindingId: 'binding_TEST_ONLY',
  qualifiedId: resource.manifest.metadata.qualifiedId, digest: resource.manifest.digest, scope: 'library', entryPath: 'TEST_ONLY/SKILL.md', enabledStages: stages })
async function project() {
  const io = new MemoryStore(); await initialize(io, await prepareInit(io, { title: 'TEST_ONLY stage bindings', type: 'course-paper' })); return io
}

test('SF-021/034: binding previews are read-only, explicitly migrate legacy locks, and preserve original YAML and lock history', async () => {
  const io = await project(), initial = await snapshot(io), resource = fixtureResource()
  const oldLock = json({ schemaVersion: 1, projectId: initial.ledger.projectId, skills: [], profiles: [{ ref: 'TEST_ONLY-old-profile', content: 'TEST_ONLY preserved' }] })
  io.externalEdit(RESOURCE_LOCK, oldLock)
  const configPath = '.scholarflow/project.yaml', originalConfig = (await io.read(configPath))!.text + '\n# TEST_ONLY user comment\nuserExtra: TEST_ONLY preserve unknown key\n'
  io.externalEdit(configPath, originalConfig)
  const plan = await prepareBindings(io, [binding(resource)], async () => resource)
  assert.equal(plan.legacyMigration, true)
  assert.equal((await io.read(RESOURCE_LOCK))!.text, oldLock)
  assert.equal((await io.read(configPath))!.text, originalConfig)
  await applyBindings(io, plan)
  const current = await snapshot(io), locked = await readBindings(io, current.config)
  assert.equal(locked.legacyMigration, false)
  assert.equal(current.config.skills.bindings[0].ref, 'binding_TEST_ONLY')
  assert.match((await io.read(configPath))!.text, /# TEST_ONLY user comment/u)
  assert.match((await io.read(configPath))!.text, /userExtra: TEST_ONLY preserve unknown key/u)
  const archive = JSON.parse((await io.read(`.scholarflow/resource-lock-history/${plan.id}.json`))!.text)
  assert.equal(archive.previousConfig, originalConfig); assert.equal(archive.previousResourceLock, oldLock)
  await assert.rejects(applyBindings(io, plan), { code: 'STALE_LEDGER_REVISION' })
})

test('SF-005/021/022: shared library installation never enables another project or an unselected stage', async () => {
  const a = await project(), b = await project(), resource = fixtureResource()
  await applyBindings(a, await prepareBindings(a, [binding(resource)], async () => resource))
  assert.equal((await resolveStageSkills(a, 'revision', async () => resource)).resources.length, 1)
  assert.equal((await resolveStageSkills(a, 'drafting')).resources.length, 0)
  assert.equal((await resolveStageSkills(b, 'revision')).resources.length, 0)
  await assert.rejects(resolveStageSkills(b, 'revision', async () => resource, 'binding_TEST_ONLY'), { code: 'SKILL_STAGE_DENIED' })
  await selectSkillStage(a, 'revision', (await snapshot(a)).ledger.revision)
  assert.equal((await currentSkillStage(a)).stage, 'revision')
  assert.equal((await currentSkillStage(b)).stage, 'drafting')
})

test('external lock edits, duplicate versions and mismatched config fail closed without replacing files', async () => {
  const io = await project(), resource = fixtureResource(), row = binding(resource)
  await assert.rejects(prepareBindings(io, [row, { ...row, bindingId: 'binding_TEST_ONLY_duplicate' }], async () => resource), { code: 'SKILL_BINDING_CONFLICT' })
  const plan = await prepareBindings(io, [row], async () => resource)
  const changed = JSON.parse((await io.read(RESOURCE_LOCK))!.text); changed.resolvedAt = new Date(0).toISOString()
  io.externalEdit(RESOURCE_LOCK, json(changed))
  await assert.rejects(applyBindings(io, plan), { code: 'STALE_RESOURCE_VERSION' })
  assert.equal((await snapshot(io)).ledger.revision, 0)
  const currentPlan = await prepareBindings(io, [row], async () => resource); await applyBindings(io, currentPlan)
  const lock = JSON.parse((await io.read(RESOURCE_LOCK))!.text); lock.bindings[0].enabledStages = ['drafting']; io.externalEdit(RESOURCE_LOCK, json(lock))
  await assert.rejects(resolveStageSkills(io, 'revision', async () => resource), { code: 'SKILL_BINDING_MISMATCH' })
})

test('SF-021: generation consumes and durably stores actual pinned Skill bytes after the library changes', async () => {
  const io = await project(), resource = fixtureResource(), row = binding(resource)
  await applyBindings(io, await prepareBindings(io, [row], async () => resource))
  let current = await snapshot(io); await saveManual(io, 'TEST_ONLY 可安全改写的原句。', current.document.contentHash, current.ledger.revision)
  current = await snapshot(io); const block = projectMarkdown(current.document.text).blocks[0]
  const plan = await prepareGeneration(io, { context: { requestId: 'req_TEST_ONLY', workspaceId: 'ws_TEST_ONLY', sessionId: 'ses_TEST_ONLY', projectId: current.ledger.projectId,
    expectedLedgerRevision: current.ledger.revision }, instruction: 'TEST_ONLY improve clarity', skillBindingId: row.bindingId,
  selection: { projectId: current.ledger.projectId, documentId: 'paper', documentHash: current.document.contentHash, revisionId: current.document.revisionId,
    blockIds: [block.id], sourceRange: { startUtf16: block.start, endUtf16: block.end }, sourceText: current.document.text, renderedText: current.document.text,
    prefixContext: '', suffixContext: '', citationKeys: [], claimIds: [], scope: 'paragraph', capturedAt: new Date().toISOString() } },
  { providerId: 'TEST_ONLY-provider', modelId: 'TEST_ONLY-model' }, async () => resource)
  const originalInstructions = resource.instructions
  resource.files[0].bytes.fill(0); resource.instructions = 'TEST_ONLY altered library resource'
  const result = await executeGeneration(io, plan, { pid: 12345, bootInstance: 'TEST_ONLY' }, new AbortController().signal, async request => {
    const skills = request.context.academicSkills as any[]
    assert.equal(skills[0].instructions, originalInstructions)
    assert.equal(skills[0].references[0].content, 'TEST_ONLY fixed scope reference')
    assert.match(request.system, /绝不编造/u)
    assert.deepEqual(plan.snapshot.skillDigests, [{ qualifiedId: row.qualifiedId, digest: row.digest }])
    return JSON.stringify({ replacementText: 'TEST_ONLY 更清晰的原句。', limitations: [] })
  }, () => true)
  assert.equal(result.run.status, 'completed-with-issues')
  assert.equal((await snapshot(io)).document.text, current.document.text)
  const stored = JSON.parse((await io.read(`.scholarflow/runs/${plan.snapshot.runId}/skills.json`))!.text)
  assert.equal(stored.resources[0].instructions, originalInstructions)
})
