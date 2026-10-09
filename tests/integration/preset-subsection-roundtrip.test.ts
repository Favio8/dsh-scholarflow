import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PresetLibrary } from '../../src/host/presets/library.ts'
import { sectionsFromPreset } from '../../src/core/presets/apply.ts'

// Saving a paper as a preset and applying it again must land on the same structure. The
// nesting travels through the host's file round trip, not just through the pure functions,
// so this is where a lost parent key would show up.

const NOW = '2026-10-09T12:00:00.000Z'

async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'sf-roundtrip-TEST_ONLY-')))
  return { home, library: new PresetLibrary(home) }
}

const nested = () => ({ title: '我的论述结构', summary: '按当前论文结构保存', paperType: 'course-paper' as const,
  sections: [
    { key: 'k-intro', title: '引言', focus: '提出问题', targetLength: 600 },
    { key: 'k-argument', title: '主题论证', focus: '展开论证', targetLength: 2400 },
    { key: 'k-claim', title: '主要论据', focus: '给出核心证据', targetLength: 1400, parentKey: 'k-argument' },
    { key: 'k-evidence', title: '补充材料', focus: '补第二类证据', targetLength: 1000, parentKey: 'k-argument' },
    { key: 'k-conclusion', title: '结论', focus: '收束', targetLength: 600 }] })

test('a nested paper survives save, list and apply with its subsections intact', async () => {
  const { home, library } = await fixture()
  try {
    const saved = await library.save(nested(), NOW)
    const listed = (await library.list()).all.find(preset => preset.id === saved.id)!
    const argument = listed.sections.find(section => section.key === 'k-argument')!
    assert.deepEqual(argument.subsections.map(subsection => subsection.key), ['k-claim', 'k-evidence'])
    // The chapter is a container: its own lead-in is the 2400 that is not spent on a subsection.
    assert.ok(argument.leadShare > 0 && argument.leadShare < 1, `章首导语占比应在 0 与 1 之间，当前 ${argument.leadShare}`)
    const sections = sectionsFromPreset(listed, 'zh-CN', 6000)
    const titles = sections.map(section => section.title)
    assert.deepEqual(titles, ['引言', '主题论证', '主要论据', '补充材料', '结论'])
    const parent = sections.find(section => section.title === '主题论证')!
    const child = sections.find(section => section.title === '主要论据')!
    assert.equal(child.parentId, parent.id)
    assert.equal(sections.filter(section => section.parentId === parent.id).length, 2)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('a flat paper still saves flat, so nothing is invented on the way through', async () => {
  const { home, library } = await fixture()
  try {
    const saved = await library.save({ title: '扁平结构', summary: '按当前论文结构保存', paperType: 'course-paper',
      sections: [{ key: 'k-intro', title: '引言', focus: '开头', targetLength: 1000 },
        { key: 'k-body', title: '正文', focus: '主体', targetLength: 3000 }] }, NOW)
    const listed = (await library.list()).all.find(preset => preset.id === saved.id)!
    assert.ok(listed.sections.every(section => section.subsections.length === 0))
    assert.ok(listed.sections.every(section => section.leadShare === 0))
    const sections = sectionsFromPreset(listed, 'zh-CN', 4000)
    assert.ok(sections.every(section => section.parentId === undefined))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('the kept supplemental parts ride along with the saved structure', async () => {
  const { home, library } = await fixture()
  try {
    const saved = await library.save({ ...nested(), supplementalParts: [
      { kind: 'abstract' as const, description: '摘要', suggestedLength: 300 },
      { kind: 'keywords' as const, description: '关键词' }] }, NOW)
    const listed = (await library.list()).all.find(preset => preset.id === saved.id)!
    assert.deepEqual(listed.supplementalParts.map(part => part.kind), ['abstract', 'keywords'])
    const sections = sectionsFromPreset(listed, 'zh-CN', 6000)
    assert.deepEqual(sections.slice(0, 2).map(section => [section.title, section.kind]), [['摘要', 'front'], ['关键词', 'front']])
  } finally { await rm(home, { recursive: true, force: true }) }
})
