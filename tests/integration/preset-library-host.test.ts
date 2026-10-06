import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PresetLibrary } from '../../src/host/presets/library.ts'

const NOW = '2026-10-06T12:00:00.000Z'
const structure = (title: string) => ({ title, summary: '由当前论文结构保存', paperType: 'course-paper' as const,
  sections: [{ key: 'intro', title: '引言', focus: '开头', targetLength: 800 },
    { key: 'body', title: '正文', focus: '主体', targetLength: 3200 }] })

async function fixture() {
  // realpath first: the library refuses a root that is reached through a link.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'sf-presets-TEST_ONLY-')))
  return { home, library: new PresetLibrary(home), userRoot: join(home, 'scholarflow', 'presets', 'user') }
}
const codes = (error: unknown) => (error as { code?: string }).code

test('an empty user directory still yields all twelve built-ins with no issues', async () => {
  const { home, library } = await fixture()
  try {
    const result = await library.list()
    assert.deepEqual(result.issues, [])
    assert.equal(result.all.length, 12)
    assert.equal(result.byType['course-paper']!.length, 4)
    assert.deepEqual(result.byType['research-paper']!.map(preset => preset.id),
      ['research-empirical-imrad', 'research-qualitative', 'research-case-study', 'research-theoretical'])
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('saving the current structure writes one user entry and leaves every built-in byte-identical', async () => {
  const { home, library, userRoot } = await fixture()
  const bundled = fileURLToPath(new URL('../../presets/structures/', import.meta.url))
  const digestOf = async (...parts: string[]) => createHash('sha256').update(await readFile(join(bundled, ...parts))).digest('hex')
  try {
    const before = await digestOf('course-paper', 'course-argumentative.json')
    const saved = await library.save(structure('我的课程结构'), NOW)
    assert.match(saved.id, /^user-[a-f0-9]{32}$/)
    assert.equal(saved.source, 'user')
    assert.deepEqual(saved.sections.map(section => section.share), [0.2, 0.8], '占比从章节目标篇幅归一化得到')

    const files = await readdir(userRoot)
    assert.equal(files.length, 1)
    const stored = JSON.parse(await readFile(join(userRoot, files[0]!), 'utf8'))
    assert.equal(stored.id, saved.id)
    assert.ok(!JSON.stringify(stored).includes('targetLength'), '不保存论文的绝对篇幅')

    const after = await library.list()
    assert.equal(after.all.length, 13)
    assert.equal(after.all.find(preset => preset.id === 'course-argumentative')!.source, 'builtin')
    assert.equal(after.all.find(preset => preset.id === 'course-argumentative')!.order, 1, '内置默认项不受用户条目影响')
    assert.equal(await digestOf('course-paper', 'course-argumentative.json'), before, '写入用户预设不得改动内置文件')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('copying a built-in keeps its shares and records where it came from', async () => {
  const { home, library } = await fixture()
  try {
    const source = await library.read('research-qualitative')
    const copy = await library.copy(source.id, NOW)
    assert.notEqual(copy.id, source.id)
    assert.equal(copy.source, 'user')
    assert.equal(copy.derivedFrom, source.id)
    assert.equal(copy.basedOnVersion, source.version)
    assert.deepEqual(copy.sections.map(section => section.share), source.sections.map(section => section.share))
    assert.deepEqual(copy.sections.map(section => section.key), source.sections.map(section => section.key))

    const original = await library.read(source.id)
    assert.equal(original.source, 'builtin')
    assert.deepEqual(original.sections, source.sections, '复制不影响来源预设')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('a user preset updates only with the expected version, and the version advances', async () => {
  const { home, library } = await fixture()
  try {
    const saved = await library.save(structure('我的课程结构'), NOW)
    await assert.rejects(library.update(saved.id, structure('改过的结构'), NOW, '9.9.9'), error => codes(error) === 'PRESET_VERSION_CONFLICT')
    const updated = await library.update(saved.id, structure('改过的结构'), NOW, saved.version)
    assert.equal(updated.id, saved.id, '更新保持同一身份')
    assert.equal(updated.version, '2.0.0')
    assert.equal(updated.title, '改过的结构')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('built-ins are read-only for rename, update and removal', async () => {
  const { home, library } = await fixture()
  try {
    await assert.rejects(library.update('course-argumentative', structure('覆盖内置'), NOW, '1.0.0'), error => codes(error) === 'PRESET_BUILTIN_READONLY')
    await assert.rejects(library.rename('course-argumentative', '改名', NOW), error => codes(error) === 'PRESET_BUILTIN_READONLY')
    await assert.rejects(library.remove('course-argumentative'), error => codes(error) === 'PRESET_BUILTIN_READONLY')
    assert.equal((await library.read('course-argumentative')).title && (await library.list()).all.length, 12)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('renaming changes only the title, and removing moves the entry out of the list', async () => {
  const { home, library, userRoot } = await fixture()
  try {
    const saved = await library.save(structure('我的课程结构'), NOW)
    const renamed = await library.rename(saved.id, '我的课程结构（二稿）', NOW)
    assert.equal(renamed.title, '我的课程结构（二稿）')
    assert.deepEqual(renamed.sections, saved.sections, '改名不改结构')
    assert.deepEqual(renamed.sections.map(section => section.share), saved.sections.map(section => section.share))

    assert.deepEqual(await library.remove(saved.id), { removed: true })
    assert.equal((await library.list()).all.length, 12)
    await assert.rejects(library.read(saved.id), error => codes(error) === 'PRESET_NOT_FOUND')
    const left = await readdir(userRoot)
    assert.ok(left.every(name => name.startsWith('.removed-')), '删除把字节移开而不是留下同名文件')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('a damaged user entry is reported while the rest of the library stays usable', async () => {
  const { home, library, userRoot } = await fixture()
  try {
    await library.save(structure('好的结构'), NOW)
    await mkdir(userRoot, { recursive: true })
    await writeFile(join(userRoot, 'user-broken.json'), '{ not json')
    const result = await library.list()
    assert.equal(result.all.length, 13)
    assert.equal(result.issues.length, 1)
    assert.match(result.issues[0]!.message, /user-broken/)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('reading an unknown preset fails instead of substituting another one', async () => {
  const { home, library } = await fixture()
  try {
    await assert.rejects(library.read('review-does-not-exist'), error => codes(error) === 'PRESET_NOT_FOUND')
    await assert.rejects(library.read('Not-An-Id'), error => codes(error) === 'PRESET_ID_INVALID')
  } finally { await rm(home, { recursive: true, force: true }) }
})
