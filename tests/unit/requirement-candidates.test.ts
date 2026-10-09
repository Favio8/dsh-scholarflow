import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adoptBrief, adoptionSummary, basisMatches, conflictsOf, coverageOf, describeLength, diffBrief, flattenBrief, outlineDiff, outlineGaps } from '../../src/core/requirements/candidates.ts'
import { sizeFromLabel, typographyFromText, typographyToDocx, coverFromText, pagePlan, paginationVerdict } from '../../src/core/export/typography.ts'
import { classifyNote, groupIssues, mapLegacyNotes, mergeIssue, mergeIssues } from '../../src/core/pipeline/task-issues.ts'
import type { CreationSpec, RequirementBrief } from '../../src/shared/writing-task.ts'

const at = '2026-10-06T00:00:00.000Z'
const section = (title: string, purpose = '') => ({ id: `section_${title}`, title, purpose, targetLength: 200, allocationMode: 'auto' as const, kind: 'body' as const })

function spec(overrides: Partial<CreationSpec> = {}): CreationSpec {
  return { title: '科技论文阅读报告', type: 'course-paper', language: 'zh-CN', format: 'docx',
    requirements: '写一篇阅读报告', requirementSources: [], materials: [], online: false, targetLength: 4000,
    countingPolicy: { scope: 'body', includeAbstract: false, algorithmVersion: 1 }, supplementalParts: [],
    sections: [section('引言', '')], overrides: [], manuscriptDir: 'manuscript', ...overrides }
}

const brief = (overrides: Partial<RequirementBrief> = {}): RequirementBrief => ({
  schemaVersion: 2, task: { nature: '指定科技论文阅读分析报告', subject: 'Graph Convolution-Based Decoupling…' },
  coverage: [{ id: 'c1', text: '论文题名', kind: 'dimension' }, { id: 'c2', text: '实验结果', kind: 'dimension' }],
  length: { value: 1500, unit: 'zh-characters', approximate: true, pages: 4, coverPages: 1, bodyPages: 3, sourceRef: '作业要求/3.jpg' },
  format: { fileFormat: 'docx', cover: true }, submission: { when: '10 月 30 日 18:00—18:30', where: 'A-327', how: '全部单面打印', needsConfirmation: ['年份'] },
  typography: { bodyFontZh: '宋体', bodyFontEn: 'Times New Roman', bodySizePt: 12, bodySizeLabel: '小四', lineSpacing: 1.2, marginsMm: 25 },
  decisions: [], origins: { length: 'teacher', 'task.nature': 'teacher' }, readIds: ['read_1'], ...overrides })

test('"约 1500 字" keeps its 约 and its page counts instead of becoming a hard bound', () => {
  const text = describeLength(brief().length)
  assert.match(text!, /约 1500 字/)
  assert.match(text!, /共 4 页/)
  assert.match(text!, /封面 1 页＋正文 3 页/)
  const exact = describeLength({ value: 1500, unit: 'zh-characters', approximate: false })
  assert.equal(exact, '1500 字', 'an exact requirement is not decorated with 约')
})

test('flattening only reports groups the source actually mentioned', () => {
  const rows = flattenBrief({ ...brief(), length: { unit: 'zh-characters', approximate: true } })
  assert.equal(rows.some(row => row.label.startsWith('篇幅')), false)
  assert.equal(rows.some(row => row.label.startsWith('需要决定')), false)
  assert.equal(rows.find(row => row.path === 'coverage.c1')?.label, '必须覆盖 · 论文题名')
})

test('the teacher value and the preset default are both shown when they disagree', () => {
  const conflicts = conflictsOf({ brief: brief(), spec: spec(), presetLength: 4000 })
  const length = conflicts.find(row => row.topic === '篇幅')
  assert.ok(length)
  assert.match(length!.current, /4000/)
  assert.match(length!.candidate, /1500/)
  assert.equal(length!.preferred, 'candidate', 'the teacher requirement is suggested, not silently enforced')
})

test('an unimplemented citation style is a conflict rather than a fake option', () => {
  const conflicts = conflictsOf({ brief: brief({ format: { citationStyle: 'APA 作者—年份' } }), spec: spec() })
  const row = conflicts.find(conflict => conflict.topic === '引用样式')
  assert.ok(row)
  assert.match(row!.current, /顺序编号/)
  assert.equal(row!.preferred, 'current')
  assert.equal(conflictsOf({ brief: brief({ format: { citationStyle: '顺序编号 [1]' } }), spec: spec() }).some(row => row.topic === '引用样式'), false)
})

test('adoption appends a labelled record and never overwrites the user text', () => {
  const before = spec({ requirements: '我自己写的说明' })
  const adopted = adoptBrief(before, brief(), { summary: adoptionSummary(brief(), ['task', 'length']) })
  assert.match(adopted.requirements, /^我自己写的说明/)
  assert.match(adopted.requirements, /【已采用的要求整理】/)
  assert.match(adopted.requirements, /指定科技论文阅读分析报告/)
  assert.equal(adopted.brief?.length.value, 1500)
  assert.equal(adopted.targetLength, before.targetLength, 'an approximate length never rewrites the numeric target')
  assert.equal(adopted.cover?.enabled, true)
})

test('an exact length is the only one allowed to change the numeric target, and it is recorded as an override', () => {
  const exact = brief({ length: { value: 1500, unit: 'zh-characters', approximate: false } })
  const adopted = adoptBrief(spec(), exact, { summary: '', overrides: [{ field: '篇幅', requirementValue: '约 4000 字', chosenValue: '1500 字', at }] })
  assert.equal(adopted.targetLength, 1500)
  assert.deepEqual(adopted.overrides.map(row => row.chosenValue), ['1500 字'])
})

test('a candidate is only adoptable while the inputs it was built from still match', () => {
  const candidate = { basedOn: { specHash: 'sha256:' + 'a'.repeat(64), requirementsHash: 'sha256:' + 'b'.repeat(64) } }
  assert.equal(basisMatches(candidate, { requirementsHash: 'sha256:' + 'b'.repeat(64) }), true)
  assert.equal(basisMatches(candidate, { requirementsHash: 'sha256:' + 'c'.repeat(64) }), false)
  assert.equal(basisMatches(candidate, { outlineHash: undefined }), true, 'unrecorded inputs do not invalidate on their own')
})

test('the diff reports what changes against the current input', () => {
  const diffs = diffBrief(brief(), { requirements: '论文题名', targetLength: 4000, sections: [] })
  assert.equal(diffs.some(row => row.after === '论文题名'), false, 'text the user already has is not reported as new')
  assert.equal(diffs.some(row => /1500/.test(row.after)), true)
})

test('coverage maps each required dimension to a section and names the ones left out', () => {
  const sections = [section('论文题名与出处'), section('方法与模型结构')]
  const coverage = coverageOf(sections, brief())
  assert.equal(coverage.find(row => row.itemId === 'c1')?.covered, true)
  assert.equal(coverage.find(row => row.itemId === 'c2')?.covered, false)
  const gaps = outlineGaps(sections, coverage, { coverageRequired: true })
  assert.equal(gaps.some(gap => gap.includes('实验结果')), true)
})

test('a structure keeps its gaps visible instead of hiding them behind generic sections', () => {
  const sections = [section('引言'), section('主题论证'), section('反方观点与回应'), section('结论')]
  const gaps = outlineGaps(sections, coverageOf(sections, brief()), { coverageRequired: true })
  assert.equal(gaps.length >= 3, true)
  assert.equal(gaps.some(gap => gap.includes('没有章节负责分析实验结果')), true)
})

test('outline changes name additions, removals, renames and reordering', () => {
  const before = [section('引言'), section('主题分析'), section('结论')]
  const after = [section('结论'), { ...section('主题分析'), title: '相关工作的定位' }, { ...section('论文题名与出处') }]
  const changes = outlineDiff(before, after)
  const kinds = new Set(changes.map(change => change.kind))
  assert.equal(kinds.has('added'), true)
  assert.equal(kinds.has('removed'), true)
  assert.equal(kinds.has('renamed'), true)
  assert.equal(kinds.has('reordered'), true)
})

test('排版 prose becomes executable DOCX values, including east-asian and latin fonts', () => {
  const text = '中文宋体，英文Times New Roman，小四，1.2倍行距'
  const typography = typographyFromText(text)
  assert.equal(typography.bodyFontZh, '宋体')
  assert.equal(typography.bodyFontEn, 'Times New Roman')
  assert.equal(typography.bodySizePt, 12)
  assert.equal(typography.lineSpacing, 1.2)
  const docx = typographyToDocx(typography)
  assert.equal(docx.sizeHalfPoints, 24, '小四 is 12pt, which Word stores as 24 half-points')
  assert.equal(docx.lineTwips, 288, '1.2 lines is 288 twentieths of a point, not the old 360')
  assert.equal(docx.fonts.eastAsia, '宋体')
  assert.equal(docx.fonts.ascii, 'Times New Roman')
  assert.equal(docx.fonts.hAnsi, 'Times New Roman')
})

test('an unstated requirement keeps the default rather than inventing a value', () => {
  const typography = typographyFromText('写一份阅读报告即可')
  assert.equal(typography.bodyFontZh, '宋体')
  assert.equal(typography.bodySizeLabel, '小四')
  assert.equal(sizeFromLabel('小四'), 12)
  assert.equal(sizeFromLabel('特大号'), undefined)
})

test('the cover only asks for fields the requirement actually names', () => {
  const cover = coverFromText('A4封面一页，封面含题目、姓名、学号', { enabled: false, title: '', fields: [], date: '' })
  assert.equal(cover.enabled, true)
  assert.deepEqual(cover.fields.map(field => field.label), ['姓名', '学号', '题目'])
  const plain = coverFromText('写一份阅读报告', { enabled: false, title: '', fields: [], date: '' })
  assert.equal(plain.enabled, false)
  assert.deepEqual(plain.fields, [], 'no reference document may contribute a name or a date')
})

test('page counts stay separate and a mismatch is reported rather than rounded away', () => {
  const plan = pagePlan({ enabled: true, title: '', fields: [], date: '' }, { pages: 4, coverPages: 1, bodyPages: 3 })
  assert.deepEqual(plan, { coverPages: 1, bodyPages: 3, totalPages: 4 })
  const verdict = paginationVerdict({ viewer: 'Word', viewerVersion: '16', pages: 5, coverPages: 1, bodyPages: 4,
    overflow: false, largeBlank: false, measuredAt: at }, { coverPages: 1, bodyPages: 3 })
  assert.equal(verdict.ok, false)
  assert.match(verdict.notes.join(' '), /正文实际 4 页，要求 3 页/)
})

test('a note becomes an issue with an object, an impact and an action', () => {
  const issue = classifyNote('作业要求/3.jpg：这个文件的扫描页没有文字层', at)
  assert.equal(issue.group, 'needs-action')
  assert.equal(issue.object, '作业要求/3.jpg')
  assert.equal(issue.actions.length > 0, true)
  assert.match(issue.impact, /要求/)
  assert.equal(issue.occurrences, 1)
})

test('the same object and cause merge into one row with a count', () => {
  let issues = mapLegacyNotes(['a.pdf：未获得可读全文', 'a.pdf：未获得可读全文', 'a.pdf：未获得可读全文'], at)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].occurrences, 3)
  issues = mergeIssues(issues, [classifyNote('b.pdf：未获得可读全文', at)])
  assert.equal(issues.length, 2)
  assert.equal(groupIssues(issues).needsAction.length, 2)
})

test('technical text is kept in the secondary detail and never becomes the headline', () => {
  const issue = classifyNote('x.pdf：Error: ENOENT at Object.readFile', at)
  assert.equal(issue.what.includes('Error'), false, 'the headline is the user-facing statement')
  assert.match(issue.detail!, /Error: ENOENT/)
})

test('an old budget note is shown as handled rather than as a blocker', () => {
  const issue = classifyNote('本轮调用额度已用完', at)
  assert.equal(issue.group, 'handled')
  assert.deepEqual(issue.actions, [])
  assert.match(issue.what, /不再限制/)
})

test('a resolved issue keeps its object and moves to handled', () => {
  const open = classifyNote('a.pdf：未获得可读全文', at)
  const resolved = mergeIssue([open], classifyNote('a.pdf：仅找到文献信息，未获得可读全文', at))
  assert.equal(groupIssues(resolved).needsAction.length, 1)
  assert.equal(groupIssues(resolved).needsAction[0].occurrences, 2)
})
