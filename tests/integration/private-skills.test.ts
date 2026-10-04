import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PrivateSkillLibrary } from '../../src/host/skills/library.ts'
import { LocalSkillSource } from '../../src/host/skills/local.ts'

const instructions = '\uFEFF---\r\nname: test-only-private\r\ndescription: TEST_ONLY inert local Skill fixture\r\nhooks: never-start\r\n---\r\n\r\nTEST_ONLY execute scripts/no-run.js.\r\n'
const script = 'throw new Error("TEST_ONLY this script must never execute")\n'
const options = { capabilities: ['selection-transform' as const], suggestedStages: ['revision' as const] }
const signal = () => new AbortController().signal
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'scholarflow-TEST_ONLY-skills-'))
  const home = join(base, 'host-home'), source = join(base, 'source'), directory = join(source, 'nested', 'test-only-private')
  await mkdir(home); await mkdir(join(directory, 'scripts'), { recursive: true }); await mkdir(join(home, 'skills'))
  await writeFile(join(home, 'skills', 'TEST_ONLY-global-sentinel.md'), 'TEST_ONLY global catalog must remain unchanged')
  await writeFile(join(directory, 'SKILL.md'), instructions)
  await writeFile(join(directory, 'scripts', 'no-run.js'), script)
  await writeFile(join(directory, 'binary.bin'), new Uint8Array([0, 255, 13, 10]))
  return { home, source, directory, library: new PrivateSkillLibrary(home) }
}

test('SF-019/020/022: discovery is read-only, install preserves bytes privately, and scripts stay inert', async () => {
  const f = await fixture(), source = await LocalSkillSource.open(f.source)
  const discovered = await source.discover(signal())
  assert.deepEqual(discovered.candidates.map(row => row.subpath), ['nested/test-only-private'])
  assert.deepEqual(await f.library.list(), { versions: [], diagnostics: [] })
  await assert.rejects(stat(join(f.home, 'scholarflow')), { code: 'ENOENT' })
  const bundle = await source.package(discovered.candidates[0].subpath, options, signal())
  assert.equal(bundle.instructions, instructions)
  assert.equal(bundle.manifest.metadata.compatibility, 'partial')
  const installed = await f.library.install(bundle)
  assert.equal(installed.alreadyInstalled, false)
  const loaded = await f.library.read(bundle.manifest.metadata.qualifiedId, bundle.manifest.digest)
  assert.equal(loaded.instructions, instructions)
  assert.deepEqual(loaded.files.find(file => file.relativePath === 'binary.bin')!.bytes, new Uint8Array([0, 255, 13, 10]))
  assert.equal(await readFile(join(f.directory, 'SKILL.md'), 'utf8'), instructions)
  assert.equal(await readFile(join(f.directory, 'scripts', 'no-run.js'), 'utf8'), script)
  assert.equal(await readFile(join(f.home, 'skills', 'TEST_ONLY-global-sentinel.md'), 'utf8'), 'TEST_ONLY global catalog must remain unchanged')
})

test('SF-021: concurrent duplicate installation is immutable and fixed versions never fall back to latest', async () => {
  const f = await fixture(), source = await LocalSkillSource.open(f.source)
  const first = await source.package('nested/test-only-private', options, signal())
  const results = await Promise.all([f.library.install(first), f.library.install(first)])
  assert.deepEqual(results.map(result => result.alreadyInstalled).sort(), [false, true])
  await writeFile(join(f.directory, 'SKILL.md'), instructions + 'TEST_ONLY new version\n')
  const second = await source.package('nested/test-only-private', options, signal())
  await f.library.install(second)
  assert.equal((await f.library.list()).versions.length, 2)
  assert.equal((await f.library.read(first.manifest.metadata.qualifiedId, first.manifest.digest)).instructions, instructions)
  await assert.rejects(f.library.read(first.manifest.metadata.qualifiedId, `sha256:${'1'.repeat(64)}`), { code: 'SKILL_RESOURCE_MISSING' })
})

test('local import excludes sensitive discovery paths and rejects a selected Skill containing credentials', async () => {
  const f = await fixture()
  await writeFile(join(f.directory, '.credentials.yaml'), 'TEST_ONLY fake credentials, never real keys')
  const source = await LocalSkillSource.open(f.source)
  assert.match((await source.discover(signal())).diagnostics.join(' '), /敏感/u)
  await assert.rejects(source.package('nested/test-only-private', options, signal()), { code: 'SKILL_PATH_INVALID' })
  await assert.rejects(source.package('../outside', options, signal()))
})

test('local source and private library reject junctions instead of following an outside target', async () => {
  const f = await fixture(), outside = join(f.home, 'outside')
  await mkdir(outside)
  await symlink(outside, join(f.directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  const source = await LocalSkillSource.open(f.source)
  await assert.rejects(source.package('nested/test-only-private', options, signal()), { code: 'SKILL_SOURCE_LINK' })
  await symlink(outside, join(f.home, 'scholarflow'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(f.library.list(), { code: 'SKILL_LIBRARY_PATH_INVALID' })
})
