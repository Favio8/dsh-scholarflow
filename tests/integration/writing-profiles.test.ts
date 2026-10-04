import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile, stat, symlink, link } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { prepareInit, initialize, snapshot, updateProjectText } from '../../src/core/project/project.ts'
import { builtinProfiles, profileDigest, profileText, verifyProfile, prepareProfileCopy, applyProfileCopy, projectProfile } from '../../src/core/project/profiles.ts'
import { PrivateProfileLibrary } from '../../src/host/profiles/library.ts'
import { digest } from '../../src/core/store/files.ts'

const instructions = '\uFEFF# TEST_ONLY 自定义文风\r\n保留引用与限定条件。\r\n'
function custom(text = instructions) {
  const base = { id: 'user_TEST_ONLY', displayName: 'TEST_ONLY custom', language: 'zh-CN' as const, instructions: text,
    structuredPreferences: { tone: 'formal' as const, preferredTerms: { benchmark: '基准测试' } } }
  return verifyProfile({ ...base, sourceDigest: profileDigest(base), scope: 'library' })
}
async function project(type: 'course-paper' | 'literature-review' = 'course-paper') {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY user source is read-only' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY profile project', type }))
  return io
}
async function library() {
  const parent = resolve('.dsh-tmp/profile-tests'); await mkdir(parent, { recursive: true })
  const home = await mkdtemp(join(parent, 'TEST_ONLY-'))
  await mkdir(join(home, 'skills')); await writeFile(join(home, 'skills/sentinel.md'), 'TEST_ONLY global Skill untouched')
  return { home, library: new PrivateProfileLibrary(home) }
}

test('SF-017: built-in types and languages are copied at initialization with verifiable provenance', async () => {
  assert.equal(builtinProfiles.length, 6)
  for (const profile of builtinProfiles) assert.equal(verifyProfile(profile).sourceDigest, profile.sourceDigest)
  const io = await project('literature-review'), result = await projectProfile(io)
  assert.equal(result.customized, false)
  assert.equal((result.source!.profile as any).id, 'builtin_literature-review_zh')
  assert.match(result.instructions, /争议与证据缺口/u)
  assert.throws(() => verifyProfile({ ...custom(), instructions: instructions + 'TEST_ONLY changed' }), { code: 'PROFILE_DIGEST_MISMATCH' })
})

test('SF-017/034 AT-15: preview cancellation is read-only and confirmed copy archives the previous profile without touching project B', async () => {
  const a = await project(), b = await project('literature-review'), beforeB = [...b.files.entries()], beforeA = [...a.files.entries()]
  const plan = await prepareProfileCopy(a, custom(), 0)
  assert.deepEqual([...a.files.entries()], beforeA)
  const previous = (await projectProfile(a)).instructions
  await applyProfileCopy(a, plan, 'session_TEST_ONLY_A')
  const current = await projectProfile(a)
  assert.equal(current.instructions, profileText(custom())); assert.equal(current.customized, false)
  assert.equal((current.source!.profile as any).sourceDigest, custom().sourceDigest)
  assert.equal(current.source!.sourceSessionId, 'session_TEST_ONLY_A')
  const records = [...a.files].filter(([path]) => path.startsWith('.scholarflow/profiles/history/') && path.endsWith('.json'))
  assert.equal(records.length, 1); assert.equal(JSON.parse(records[0][1].text).previousText, previous)
  assert.equal((await a.read('raw.txt'))!.text, 'TEST_ONLY user source is read-only')
  assert.deepEqual([...b.files.entries()], beforeB)
  const body = (await snapshot(a)).document.text
  await updateProjectText(a, current.path, current.instructions + 'TEST_ONLY project-only preference', current.contentHash, 1, 'session_TEST_ONLY_A')
  assert.equal((await projectProfile(a)).customized, true)
  assert.equal((await snapshot(a)).document.text, body)
  assert.equal([...a.files].filter(([path]) => path.startsWith('.scholarflow/profiles/history/') && path.endsWith('.json')).length, 2)
  assert.deepEqual([...b.files.entries()], beforeB)
})

test('profile copy cannot cover external edits, changed provenance, or a tampered approval plan', async () => {
  for (const target of ['.scholarflow/profiles/writing.md', '.scholarflow/profiles/writing-source.json']) {
    const io = await project(), plan = await prepareProfileCopy(io, custom(), 0)
    io.externalEdit(target, 'TEST_ONLY external editor changed this file')
    const before = [...io.files.entries()]
    await assert.rejects(applyProfileCopy(io, plan, 'session_TEST_ONLY'), { code: 'STALE_DOCUMENT_VERSION' })
    assert.deepEqual([...io.files.entries()], before)
  }
  const io = await project(), plan = await prepareProfileCopy(io, custom(), 0)
  await assert.rejects(applyProfileCopy(io, { ...plan, profile: custom('TEST_ONLY forged') }, 'session_TEST_ONLY'), { code: 'INVALID_APPROVAL' })
  const before = [...io.files.entries()]
  await assert.rejects(applyProfileCopy(await project('literature-review'), plan, 'session_TEST_ONLY'), { code: 'STALE_LEDGER_REVISION' })
  assert.deepEqual([...io.files.entries()], before)
  const metadata = JSON.parse((await io.read('.scholarflow/profiles/writing-source.json'))!.text)
  io.externalEdit('.scholarflow/profiles/writing-source.json', JSON.stringify({ ...metadata, confirmedAt: { TEST_ONLY: 'invalid' } }))
  const malformed = await projectProfile(io)
  assert.equal(malformed.source, undefined); assert.match(malformed.warning!, /未通过校验/u)
  const large = custom('TEST_ONLY ' + '汉'.repeat(21800))
  await assert.rejects(prepareProfileCopy(io, large, 0), { code: 'CONTENT_TOO_LARGE' })
})

test('private profile versions retain original text and preferences without changing global Skills or old versions', async () => {
  const f = await library()
  assert.deepEqual(await f.library.list(), { profiles: [], diagnostics: [] })
  await assert.rejects(stat(join(f.home, 'scholarflow')), { code: 'ENOENT' })
  const original = custom(); await f.library.install(original)
  assert.deepEqual(await f.library.read(original.id, original.sourceDigest), original)
  assert.equal((await f.library.install(original)).alreadyInstalled, true)
  const updated = custom(instructions + 'TEST_ONLY new version\r\n'); await f.library.install(updated)
  assert.equal((await f.library.list()).profiles.length, 2)
  assert.equal((await f.library.read(original.id, original.sourceDigest)).instructions, instructions)
  assert.equal(await readFile(join(f.home, 'skills/sentinel.md'), 'utf8'), 'TEST_ONLY global Skill untouched')
  assert.equal(await stat(join(f.home, 'scholarflow/skills')).catch(error => error.code), 'ENOENT')
})

test('private profile directory links, hardlinks, and altered records fail before being accepted as fixed templates', async () => {
  const f = await library(), profile = custom(); await f.library.install(profile)
  const file = join(f.home, 'scholarflow/profiles', digest(profile.id).slice(7), profile.sourceDigest.slice(7) + '.json')
  await writeFile(file, JSON.stringify({ ...profile, instructions: 'TEST_ONLY external tampering' }))
  await assert.rejects(f.library.read(profile.id, profile.sourceDigest), { code: 'PROFILE_DIGEST_MISMATCH' })
  assert.equal((await f.library.list()).profiles.length, 0)
  const g = await library(), outside = join(g.home, 'outside'); await mkdir(outside); await mkdir(join(g.home, 'scholarflow'))
  await symlink(outside, join(g.home, 'scholarflow/profiles'), 'junction')
  await assert.rejects(g.library.install(profile), { code: 'PROFILE_LIBRARY_INVALID' })
  const h = await library(), hardProfile = custom('TEST_ONLY hardlink denied'); await h.library.install(hardProfile)
  const hardFile = join(h.home, 'scholarflow/profiles', digest(hardProfile.id).slice(7), hardProfile.sourceDigest.slice(7) + '.json')
  await link(hardFile, join(h.home, 'hardlink.json'))
  await assert.rejects(h.library.read(hardProfile.id, hardProfile.sourceDigest), { code: 'PROFILE_LIBRARY_INVALID' })
})
