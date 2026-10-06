import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPresetLibrary, duplicateOrders, defaultPreset, presetFromStructure, type RawPresetEntry } from '../../src/core/presets/library.ts'
import { presetDocument, normalizeShares, sharesSumToOne, comparePresets, localized, type Preset } from '../../src/shared/presets.ts'

const structuresRoot = fileURLToPath(new URL('../../presets/structures', import.meta.url))

async function builtinEntries(): Promise<RawPresetEntry[]> {
  const entries: RawPresetEntry[] = []
  for (const paperType of await readdir(structuresRoot)) {
    if (!['course-paper', 'research-paper', 'literature-review'].includes(paperType)) continue
    for (const file of await readdir(join(structuresRoot, paperType))) {
      if (!file.endsWith('.json')) continue
      entries.push({ id: file.replace(/\.json$/, ''), source: 'builtin', text: await readFile(join(structuresRoot, paperType, file), 'utf8') })
    }
  }
  return entries
}

const document = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: 1, id: 'course-argumentative', version: '1.0.0', updatedAt: '2026-10-06T00:00:00.000Z',
  paperType: 'course-paper', order: 1, title: { 'zh-CN': '论述型', en: 'Argumentative' }, summary: { 'zh-CN': '说明', en: 'Summary' },
  whenToUse: [{ 'zh-CN': '情形一', en: 'Case one' }, { 'zh-CN': '情形二', en: 'Case two' }],
  sections: [{ key: 'intro', title: { 'zh-CN': '引言', en: 'Introduction' }, focus: { 'zh-CN': '重点', en: 'Focus' }, share: 1 }],
  references: [{ label: 'R1', url: 'https://example.org/r1' }], ...overrides,
})

test('every shipped built-in preset validates and no entry is silently dropped', async () => {
  const library = loadPresetLibrary(await builtinEntries())
  assert.deepEqual(library.issues, [], '内置资源必须全部通过校验')
  assert.deepEqual(duplicateOrders(library), [])
  assert.equal(library.all.length, 12)
  for (const paperType of ['course-paper', 'research-paper', 'literature-review']) {
    const presets = library.byType[paperType]!
    assert.equal(presets.length, 4, `${paperType} 需要 4 个内置预设`)
    assert.deepEqual(presets.map(preset => preset.order), [1, 2, 3, 4], `${paperType} 的 order 必须是 1–4`)
    assert.equal(presets[0]!.source, 'builtin')
  }
})

test('built-ins are bilingual, explain when to use them and cite their source', async () => {
  const library = loadPresetLibrary(await builtinEntries())
  for (const preset of library.all) {
    assert.equal(typeof preset.title, 'object', `${preset.id} 的标题需要双语`)
    assert.ok((preset.title as { en?: string }).en, `${preset.id} 缺少英文标题`)
    assert.ok((preset.summary as { en?: string }).en, `${preset.id} 缺少英文说明`)
    assert.ok(preset.whenToUse.length >= 2 && preset.whenToUse.length <= 4, `${preset.id} 需要 2–4 条适用场景`)
    assert.ok(preset.references.length > 0, `${preset.id} 需要来源依据`)
    for (const section of preset.sections) {
      assert.ok((section.title as { en?: string }).en, `${preset.id}/${section.key} 缺少英文章节名`)
      assert.ok((section.focus as { en?: string }).en, `${preset.id}/${section.key} 缺少英文写作重点`)
      assert.equal(section.shareSource, 'heuristic', '比例必须标为工程建议')
    }
    assert.ok(sharesSumToOne(preset.sections), `${preset.id} 的正文占比合计必须为 1`)
  }
})

test('the lowest order is the default preset for its paper type', async () => {
  const library = loadPresetLibrary(await builtinEntries())
  assert.equal(defaultPreset(library, 'course-paper')!.id, 'course-argumentative')
  assert.equal(defaultPreset(library, 'research-paper')!.id, 'research-empirical-imrad')
  assert.equal(defaultPreset(library, 'literature-review')!.id, 'review-narrative')
})

test('the preset document rejects unknown fields, unknown types and malformed ids', () => {
  assert.equal(presetDocument.safeParse(JSON.parse(document())).success, true)
  assert.equal(presetDocument.safeParse(JSON.parse(document({ surprise: true }))).success, false, '严格模式必须拒绝未知字段')
  assert.equal(presetDocument.safeParse(JSON.parse(document({ paperType: 'thesis' }))).success, false)
  assert.equal(presetDocument.safeParse(JSON.parse(document({ id: 'Course_Argumentative' }))).success, false)
  assert.equal(presetDocument.safeParse(JSON.parse(document({ sections: [] }))).success, false)
})

test('localized text accepts both a plain string and a Chinese-plus-English pair', () => {
  const plain = presetDocument.safeParse(JSON.parse(document({ title: '我的预设' })))
  assert.equal(plain.success, true, '用户预设可以只提供一种语言')
  const missingZh = presetDocument.safeParse(JSON.parse(document({ title: { en: 'Only English' } })))
  assert.equal(missingZh.success, false)
  assert.equal(localized('我的预设', 'en'), '我的预设', '单语言条目按字面展示，不做隐式翻译')
  assert.equal(localized({ 'zh-CN': '中文', en: 'English' }, 'en'), 'English')
})

test('shares are normalised and an all-zero set is refused instead of repaired', () => {
  const original = [{ key: 'a', share: 4 }, { key: 'b', share: 12 }]
  const normalized = normalizeShares(original)
  assert.deepEqual(normalized.map(row => row.share), [0.25, 0.75])
  assert.equal(original[0]!.share, 4, '归一化不得改动调用方数据')
  assert.throws(() => normalizeShares([{ key: 'a', share: 0 }, { key: 'b', share: 0 }]), /PRESET_SHARES_INVALID/)
  assert.equal(sharesSumToOne([{ share: 0.5 }, { share: 0.5 }]), true)
  assert.equal(sharesSumToOne([{ share: 0.5 }, { share: 0.4 }]), false)
})

test('a preset whose shares do not sum to one is reported, not silently corrected', () => {
  const broken = document({ sections: [
    { key: 'intro', title: '引言', focus: '重点', share: 0.5 },
    { key: 'body', title: '正文', focus: '重点', share: 0.4 }] })
  const library = loadPresetLibrary([{ id: 'course-argumentative', source: 'builtin', text: broken }])
  assert.equal(library.all.length, 0)
  assert.equal(library.issues[0]!.code, 'PRESET_SHARES_INVALID')
})

test('damaged entries are reported individually and never take the rest of the library down', () => {
  const library = loadPresetLibrary([
    { id: 'course-argumentative', source: 'builtin', text: document() },
    { id: 'broken-json', source: 'user', text: '{ not json' },
    { id: 'wrong-name', source: 'user', text: document({ id: 'other-id', order: undefined, whenToUse: [], references: [] }) },
    { id: 'Bad_Id', source: 'user', text: document() },
  ])
  assert.equal(library.all.length, 1, '只有合法条目进入库')
  assert.deepEqual(library.issues.map(issue => issue.code), ['PRESET_UNREADABLE', 'PRESET_ID_MISMATCH', 'PRESET_ID_INVALID'])
})

test('a duplicate id is reported and the user copy wins, without relying on directory order', () => {
  const builtin = { id: 'course-argumentative', source: 'builtin' as const, text: document() }
  const user = { id: 'course-argumentative', source: 'user' as const, text: document({ title: '我的版本', order: undefined, whenToUse: [], references: [] }) }
  for (const entries of [[builtin, user], [user, builtin]]) {
    const library = loadPresetLibrary(entries)
    assert.equal(library.all.length, 1)
    assert.equal(library.all[0]!.source, 'user', '重复 id 时用户条目优先，与传入顺序无关')
    assert.equal(library.issues[0]!.code, 'PRESET_DUPLICATE_ID')
  }
})

test('built-ins must be orderable, self-explanatory and sourced', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ order: undefined }, 'PRESET_ORDER_REQUIRED'],
    [{ whenToUse: [{ 'zh-CN': '只有一条' }] }, 'PRESET_WHEN_TO_USE_REQUIRED'],
    [{ references: [] }, 'PRESET_SOURCE_REQUIRED'],
    [{ tags: ['期刊投稿'] }, 'PRESET_TAGS_RESERVED'],
  ]
  for (const [override, code] of cases) {
    const library = loadPresetLibrary([{ id: 'course-argumentative', source: 'builtin', text: document(override) }])
    assert.equal(library.issues[0]?.code, code, `期望 ${code}`)
  }
})

test('duplicate built-in order inside one paper type is reported as a content defect', () => {
  const library = loadPresetLibrary([
    { id: 'course-argumentative', source: 'builtin', text: document() },
    { id: 'course-lab-report', source: 'builtin', text: document({ id: 'course-lab-report', order: 1 }) },
  ])
  assert.equal(library.issues.length, 0)
  const issues = duplicateOrders(library)
  assert.equal(issues.length, 1)
  assert.match(issues[0]!.message, /order 1 重复/)
})

test('presets are ordered by order ascending, with unordered entries last', () => {
  // User copies carry no built-in content requirements, so this isolates ordering.
  const base = (id: string, order?: number) => ({ id, source: 'user' as const, text: document({ id, order, whenToUse: [], references: [] }) })
  const library = loadPresetLibrary([base('zzz', undefined), base('aaa', 2), base('bbb', 1)])
  assert.deepEqual(library.issues, [])
  assert.deepEqual(library.byType['course-paper']!.map(preset => preset.id), ['bbb', 'aaa', 'zzz'])
})

test('a preset body built from the current structure stores shares, never absolute lengths', () => {
  const body = presetFromStructure({ title: '我的结构', summary: '按当前论文保存', paperType: 'course-paper',
    sections: [
      { key: 'intro', title: '引言', focus: '开头', targetLength: 800 },
      { key: 'body', title: '正文', focus: '主体', targetLength: 3200 }],
    derivedFrom: 'course-argumentative', basedOnVersion: '1.0.0' }, '2026-10-06T00:00:00.000Z')
  assert.deepEqual(body.sections.map(section => section.share), [0.2, 0.8])
  assert.equal(body.derivedFrom, 'course-argumentative')
  const text = JSON.stringify(body)
  assert.ok(!text.includes('targetLength'), '不保存论文的绝对篇幅')
  assert.ok(!text.includes('800') && !text.includes('3200'), '不保存论文的具体数值')
  assert.equal(presetDocument.safeParse({ ...body, id: 'user-abc' }).success, true, '生成的正文可直接作为用户预设校验')
})

test('comparePresets keeps a stable order for entries without an explicit order', () => {
  const preset = (id: string, order?: number, title = '同名校验'): Preset => ({ ...JSON.parse(document({ id, order, whenToUse: [], references: [], title })), source: 'user' })
  const rows = [preset('b'), preset('a'), preset('c', 1)]
  assert.deepEqual(rows.sort(comparePresets).map(row => row.id), ['c', 'a', 'b'])
})
