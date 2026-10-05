// TEST_ONLY fault-injectable resource seam; installed-Host smoke separately
// verifies real sandbox authorization, native creation, links and binary bytes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { prepareProjectSkillCopy, applyProjectSkillCopy } from '../../src/core/skills/project-copy.ts'
import { packageSkill } from '../../src/core/skills/package.ts'
import { projectSkillEntry, readProjectSkill, resolveProjectSkill } from '../../src/core/skills/project-resources.ts'
import { prepareBindings, applyBindings, resolveStageSkills } from '../../src/core/skills/bindings.ts'
import type { FileEntry } from '../../src/core/store/files.ts'
import type { ResourceBinding } from '../../src/shared/skills.ts'

class ByteStore extends MemoryStore {
  bytes = new Map<string, Uint8Array>()
  created = 0; failAt = Infinity
  async stat(path: string): Promise<FileEntry | undefined> {
    if (this.bytes.has(path)) return { path, type: 'file', size: this.bytes.get(path)!.byteLength }
    if ([...this.bytes.keys()].some(key => key.startsWith(path + '/'))) return { path, type: 'directory', size: 0 }
    return super.stat(path)
  }
  async list(path: string) {
    const prefix = path ? path + '/' : '', existing = (await super.list(path)).map(row => row.path)
    const names = [...new Set([...existing, ...[...this.bytes.keys()].filter(key => key.startsWith(prefix)).map(key => prefix + key.slice(prefix.length).split('/')[0])])]
    return Promise.all(names.map(async name => (await this.stat(name))!))
  }
  resourceStat = this.stat.bind(this)
  async readResourceBytes(path: string, cap: number) {
    const bytes = this.bytes.get(path)
    if (!bytes) return this.readBytes(path, cap)
    assert.ok(bytes.byteLength <= cap); return new Uint8Array(bytes)
  }
  async createResourceBytes(path: string, bytes: Uint8Array) {
    if (++this.created === this.failAt) throw new Error('TEST_ONLY resource publication interrupted')
    assert.equal(await this.stat(path), undefined)
    this.bytes.set(path, new Uint8Array(bytes))
  }
}
const instructions = '\uFEFF---\r\nname: TEST_ONLY-preserved\r\ndescription: TEST_ONLY static copy\r\n---\r\nRetain facts and citations.\r\n'
const options = { capabilities: ['draft-section' as const], suggestedStages: ['drafting' as const] }
const binary = new Uint8Array([0, 255, 128, 13, 10, 0])
const original = packageSkill('library:TEST_ONLY', [
  { relativePath: 'SKILL.md', bytes: new TextEncoder().encode(instructions) },
  { relativePath: 'assets/binary.bin', bytes: binary },
  { relativePath: 'scripts/no-run.js', bytes: new TextEncoder().encode('throw new Error("TEST_ONLY never execute")') },
], { kind: 'local', rootFingerprint: 'sha256:' + '1'.repeat(64), subpath: '' }, options)
const source: ResourceBinding = { bindingId: 'binding_TEST_ONLY', qualifiedId: 'library:TEST_ONLY', scope: 'library', digest: original.manifest.digest,
  entryPath: 'TEST_ONLY/SKILL.md', enabledStages: ['drafting'] }
const reader = async () => structuredClone(original)
const input = { ...options, reason: 'TEST_ONLY keep immutable project resources', sessionId: 'ses_TEST_ONLY' }
async function fixture() {
  const io = new ByteStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY copy', type: 'course-paper' }))
  return io
}

test('copy preview writes nothing; complete copy preserves binary, BOM/CRLF, scripts and leaves source bindings unchanged', async () => {
  const io = await fixture()
  await applyBindings(io, await prepareBindings(io, [source], reader))
  const before = await snapshot(io), config = (await io.read('.scholarflow/project.yaml'))!.text, lock = (await io.read('.scholarflow/resources.lock.json'))!.text
  const writes = io.writes, plan = await prepareProjectSkillCopy(io, source, reader, input)
  assert.equal(io.writes, writes); assert.equal(io.created, 0)
  await applyProjectSkillCopy(io, plan, reader)
  const copied = await readProjectSkill(io, plan.bundle.manifest.metadata.qualifiedId)
  assert.equal(copied.instructions, instructions)
  assert.deepEqual(copied.files.find(file => file.relativePath === 'assets/binary.bin')!.bytes, binary)
  assert.deepEqual(copied.files.find(file => file.relativePath === 'scripts/no-run.js')!.bytes, original.files.find(file => file.relativePath === 'scripts/no-run.js')!.bytes)
  assert.equal((await io.read('.scholarflow/project.yaml'))!.text, config); assert.equal((await io.read('.scholarflow/resources.lock.json'))!.text, lock)
  assert.equal((await snapshot(io)).document.contentHash, before.document.contentHash)
  const history = JSON.parse((await io.read(`.scholarflow/skill-copy-history/${plan.id}.json`))!.text)
  assert.equal(history.sourceSessionId, input.sessionId); assert.equal(history.sourceManifest.digest, original.manifest.digest)
  assert.equal(history.bindingChanged, false); assert.equal(history.previousInstructions, instructions)
})
test('project instruction customization creates an independent version and explicit binding retains frozen old instructions', async () => {
  const io = await fixture(), first = await prepareProjectSkillCopy(io, source, reader, input)
  await applyProjectSkillCopy(io, first, reader)
  const binding: ResourceBinding = { ...source, qualifiedId: first.bundle.manifest.metadata.qualifiedId, scope: 'project', digest: first.bundle.manifest.digest,
    entryPath: projectSkillEntry(first.bundle.manifest.metadata.qualifiedId) }
  await applyBindings(io, await prepareBindings(io, [binding], row => resolveProjectSkill(io, row)))
  const frozen = await resolveStageSkills(io, 'drafting', row => resolveProjectSkill(io, row))
  const second = await prepareProjectSkillCopy(io, binding, row => resolveProjectSkill(io, row), { ...input, instructions: instructions + 'TEST_ONLY new operator preference\r\n' })
  await applyProjectSkillCopy(io, second, row => resolveProjectSkill(io, row))
  assert.notEqual(first.bundle.manifest.metadata.qualifiedId, second.bundle.manifest.metadata.qualifiedId)
  assert.equal((await resolveProjectSkill(io, binding)).instructions, instructions)
  assert.equal(frozen.resources[0].instructions, instructions)
  assert.equal((await resolveStageSkills(io, 'drafting', row => resolveProjectSkill(io, row))).resources[0].instructions, instructions)
  const nextBinding = { ...binding, qualifiedId: second.bundle.manifest.metadata.qualifiedId, digest: second.bundle.manifest.digest,
    entryPath: projectSkillEntry(second.bundle.manifest.metadata.qualifiedId) }
  await applyBindings(io, await prepareBindings(io, [nextBinding], row => resolveProjectSkill(io, row)))
  assert.match((await resolveStageSkills(io, 'drafting', row => resolveProjectSkill(io, row))).resources[0].instructions, /new operator preference/)
  assert.deepEqual(second.bundle.files.find(file => file.relativePath === 'assets/binary.bin')!.bytes, binary)
})
test('changed plan bytes, stale project and changed source fail before resource creation', async () => {
  const io = await fixture(), plan = await prepareProjectSkillCopy(io, source, reader, input), changed = structuredClone(plan)
  changed.bundle.files.find(file => file.relativePath === 'assets/binary.bin')!.bytes[0] = 123
  await assert.rejects(applyProjectSkillCopy(io, changed, reader), { code: 'SKILL_DIGEST_MISMATCH' })
  await assert.rejects(applyProjectSkillCopy(io, plan, async () => ({ ...original, instructions: instructions + 'TEST_ONLY tamper' })), { code: 'SKILL_DIGEST_MISMATCH' })
  await applyBindings(io, await prepareBindings(io, [], reader))
  await assert.rejects(applyProjectSkillCopy(io, plan, reader), { code: 'STALE_LEDGER_REVISION' })
  assert.equal(io.created, 0)
})
test('interrupted creation preserves original files and ledger; fresh preview never reuses or overwrites partial tree', async () => {
  const io = await fixture(), plan = await prepareProjectSkillCopy(io, source, reader, input), before = await snapshot(io)
  io.failAt = 2
  await assert.rejects(applyProjectSkillCopy(io, plan, reader), /TEST_ONLY resource publication interrupted/)
  const partial = [...io.bytes].map(([path, bytes]) => [path, new Uint8Array(bytes)] as const)
  assert.equal((await snapshot(io)).ledgerHash, before.ledgerHash)
  assert.equal(await io.read(`.scholarflow/skill-copy-history/${plan.id}.json`), undefined)
  await assert.rejects(applyProjectSkillCopy(io, plan, reader), { code: 'OUTPUT_PATH_CONFLICT' })
  io.failAt = Infinity
  const fresh = await prepareProjectSkillCopy(io, source, reader, input)
  await applyProjectSkillCopy(io, fresh, reader)
  assert.notEqual(fresh.bundle.manifest.metadata.qualifiedId, plan.bundle.manifest.metadata.qualifiedId)
  for (const [path, bytes] of partial) assert.deepEqual(io.bytes.get(path), bytes)
  assert.equal((await snapshot(io)).config.skills.bindings.length, 0)
})
test('missing capability, invalid frontmatter and file-count overflow do not publish any bytes', async () => {
  const io = await fixture()
  await assert.rejects(prepareProjectSkillCopy(new MemoryStore(), source, reader, input), { code: 'SKILL_RESOURCE_WRITE_UNAVAILABLE' })
  await assert.rejects(prepareProjectSkillCopy(io, source, reader, { ...input, instructions: 'TEST_ONLY missing frontmatter' }), { code: 'SKILL_FRONTMATTER_REQUIRED' })
  const full = packageSkill('library:TEST_ONLY', [{ relativePath: 'SKILL.md', bytes: new TextEncoder().encode(instructions) },
    ...Array.from({ length: 199 }, (_, i) => ({ relativePath: `references/${i}.txt`, bytes: new Uint8Array() }))], original.manifest.origin, options)
  await assert.rejects(prepareProjectSkillCopy(io, { ...source, digest: full.manifest.digest }, async () => full, input), { code: 'SKILL_PACKAGE_TOO_LARGE' })
  assert.equal(io.created, 0)
})
