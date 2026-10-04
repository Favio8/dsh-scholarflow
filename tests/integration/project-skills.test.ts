// TEST_ONLY in-memory Core capability. Native link/byte boundaries are tested
// separately through the gateway and installed Host smoke.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { listProjectSkills, readProjectSkill, resolveProjectSkill, projectSkillEntry } from '../../src/core/skills/project-resources.ts'
import { prepareBindings, applyBindings, resolveStageSkills } from '../../src/core/skills/bindings.ts'
import { type ResourceBinding } from '../../src/shared/skills.ts'
import { digest } from '../../src/core/store/files.ts'

class ResourceStore extends MemoryStore {
  resourceStat = this.stat.bind(this)
  readResourceBytes = this.readBytes.bind(this)
}
const ROOT = '.scholarflow/skills/test-only/revision'
const instructions = '\uFEFF---\r\nname: TEST_ONLY-project-revision\r\ndescription: TEST_ONLY project scoped static resource\r\n---\r\nPreserve facts and citations.\r\n'
const sidecar = JSON.stringify({ schemaVersion: 1, capabilities: ['selection-transform'], suggestedStages: ['revision'] })
async function fixture(note = instructions) {
  const io = new ResourceStore({ [`${ROOT}/SKILL.md`]: note, [`${ROOT}/scholarflow.json`]: sidecar, [`${ROOT}/references/scope.md`]: 'TEST_ONLY local scope' })
  // Existing metadata would collide with initialization; resources are added
  // explicitly after initialization, just as a user copies their owned Skill.
  const saved = [...io.files]; io.files.clear()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY project Skill', type: 'course-paper' }))
  for (const [path, image] of saved) io.files.set(path, image)
  return io
}
const binding = (hash: string): ResourceBinding => ({ bindingId: 'binding_TEST_ONLY_project', qualifiedId: 'project:test-only:revision', scope: 'project',
  digest: hash, entryPath: projectSkillEntry('project:test-only:revision'), enabledStages: ['revision'] })

test('project resources preserve original instructions, remain unbound after discovery and isolate same-name resources by workspace', async () => {
  const a = await fixture(), b = await fixture(instructions + 'TEST_ONLY project B only\r\n'), writes = a.writes
  const catalog = await listProjectSkills(a), resource = await readProjectSkill(a, 'project:test-only:revision')
  assert.equal(a.writes, writes); assert.equal(resource.instructions, instructions)
  assert.equal(catalog.versions.length, 1); assert.equal(catalog.versions[0].scope, 'project')
  assert.equal(resource.manifest.origin.kind, 'project')
  assert.equal((await resolveStageSkills(a, 'revision')).resources.length, 0)
  await applyBindings(a, await prepareBindings(a, [binding(resource.manifest.digest)], row => resolveProjectSkill(a, row)))
  const fixed = await resolveStageSkills(a, 'revision', row => resolveProjectSkill(a, row))
  assert.equal(fixed.resources[0].instructions, instructions)
  assert.equal((await resolveStageSkills(b, 'revision')).resources.length, 0)
  await assert.rejects(resolveProjectSkill(b, binding(resource.manifest.digest)), { code: 'SKILL_DIGEST_MISMATCH' })
})

test('project Skill and sidecar changes invalidate fixed bindings while already frozen instructions stay unchanged', async () => {
  const io = await fixture(), original = await readProjectSkill(io, 'project:test-only:revision'), row = binding(original.manifest.digest)
  await applyBindings(io, await prepareBindings(io, [row], binding => resolveProjectSkill(io, binding)))
  const frozen = await resolveStageSkills(io, 'revision', binding => resolveProjectSkill(io, binding))
  io.externalEdit(`${ROOT}/SKILL.md`, instructions + 'TEST_ONLY changed instructions')
  await assert.rejects(resolveStageSkills(io, 'revision', binding => resolveProjectSkill(io, binding)), { code: 'SKILL_DIGEST_MISMATCH' })
  assert.equal(frozen.resources[0].instructions, instructions)
  assert.equal((await snapshot(io)).config.skills.bindings[0].ref, row.bindingId)
  io.externalEdit(`${ROOT}/SKILL.md`, instructions)
  io.externalEdit(`${ROOT}/scholarflow.json`, JSON.stringify({ schemaVersion: 1, capabilities: ['review'], suggestedStages: ['review'] }))
  await assert.rejects(resolveProjectSkill(io, row), { code: 'SKILL_DIGEST_MISMATCH' })
  assert.notEqual((await readProjectSkill(io, row.qualifiedId)).manifest.digest, original.manifest.digest)
})

test('project resource paths, missing sidecars, sensitive trees and unavailable byte capability fail closed', async () => {
  const io = await fixture()
  for (const qid of ['library:foo', 'project:../foo:bar', 'project:test-only:CON', 'project:test-only:foo/bar']) assert.throws(() => projectSkillEntry(qid))
  await assert.rejects(resolveProjectSkill(io, { ...binding(digest('TEST_ONLY')), entryPath: '.scholarflow/skills/other/revision/SKILL.md' }), { code: 'SKILL_RESOURCE_PATH_INVALID' })
  io.files.delete(`${ROOT}/scholarflow.json`)
  await assert.rejects(readProjectSkill(io, 'project:test-only:revision'), { code: 'SKILL_METADATA_REQUIRED' })
  io.externalEdit(`${ROOT}/scholarflow.json`, sidecar)
  io.externalEdit(`${ROOT}/.credentials.yaml`, 'TEST_ONLY fake credential')
  await assert.rejects(readProjectSkill(io, 'project:test-only:revision'), { code: 'SKILL_PATH_INVALID' })
  assert.equal((await listProjectSkills(io)).versions.length, 0)
  await assert.rejects(listProjectSkills(new MemoryStore()), { code: 'SKILL_RESOURCE_UNAVAILABLE' })
})

test('resource discovery charges bounded content before reads and refuses oversized instructions before loading them', async () => {
  const io = await fixture(), reads: string[] = [], reader = io.readResourceBytes.bind(io)
  io.readResourceBytes = async (path, limit) => { reads.push(path); return reader(path, limit) }
  let budget = 1
  await assert.rejects(readProjectSkill(io, 'project:test-only:revision', size => {
    if (size > budget) throw new Error('TEST_ONLY content budget exceeded')
    budget -= size
  }), /TEST_ONLY content budget exceeded/)
  assert.deepEqual(reads, [])
  io.externalEdit(`${ROOT}/SKILL.md`, instructions + 'x'.repeat(65536))
  await assert.rejects(readProjectSkill(io, 'project:test-only:revision'), { code: 'SKILL_INSTRUCTIONS_INVALID' })
  assert.deepEqual(reads, [])
})
