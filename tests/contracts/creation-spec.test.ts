import { test } from 'node:test'
import assert from 'node:assert/strict'
import { creationSpec, requirementDraftSpec, requirementSource, writingSection } from '../../src/shared/writing-task.ts'
import { creationErrorMessage } from '../../src/client/creation-errors.ts'
import { adoptBrief, adoptionSummary, ADOPTABLE_PATHS } from '../../src/core/requirements/candidates.ts'
import { requirementBrief } from '../../src/shared/writing-task.ts'
import { readRequirementSources, readApproval, folderMembers, countingUnit, usesLegacyAssignment } from '../../src/core/pipeline/spec-compat.ts'

const base = {
  title: '科技论文大作业', type: 'course-paper', language: 'zh-CN', format: 'docx', requirements: '围绕课堂主题提出观点',
  materials: ['课件/第3讲.pdf'], targetLength: 4000,
  sections: [{ id: 'section_1', title: '引言', purpose: '', targetLength: 1000 }],
}
const spec = (overrides: Record<string, unknown> = {}) => creationSpec.parse({ ...base, ...overrides })

test('a source-only draft can be read before its title or requirements exist, without relaxing submission', () => {
  for (const requirementSources of [
    [{ resourceId: 'req_file', origin: 'workspace', kind: 'file', path: '要求/说明.md' }],
    [{ resourceId: 'req_folder', origin: 'workspace', kind: 'folder', path: '作业要求',
      members: ['1.jpg', '2.jpg', '3.jpg'].map(name => ({ name: `作业要求/${name}` })) }],
    [{ resourceId: 'req_external', origin: 'external', kind: 'folder', handle: 'TEST_ONLY',
      members: [{ name: '说明.md' }], state: 'connected' }],
  ]) {
    const input = { ...base, title: '', requirements: '  ', requirementSources }
    const draft = requirementDraftSpec.parse(input)
    assert.equal(draft.title, '')
    assert.equal(draft.requirements, '')
    assert.deepEqual(draft.materials, base.materials)
    assert.equal(creationSpec.safeParse(draft).success, false)
    assert.equal(creationSpec.safeParse({ ...draft, title: 'TEST_ONLY' }).success, false)
  }
})

test('text-only and legacy-source drafts are accepted, empty input and unsafe sources are refused', () => {
  assert.equal(requirementDraftSpec.safeParse({ ...base, title: '' }).success, true)
  assert.equal(requirementDraftSpec.safeParse({ ...base, title: '', requirements: '', assignmentPath: '要求.md' }).success, true)
  assert.equal(requirementDraftSpec.safeParse({ ...base, requirements: ' ' }).success, false)
  assert.equal(requirementDraftSpec.safeParse({ ...base, requirements: 'x'.repeat(12001) }).success, false)
  assert.equal(requirementDraftSpec.safeParse({ ...base, requirementSources: [
    { resourceId: 'req_bad', origin: 'workspace', kind: 'file', path: '../private.txt' }] }).success, false)
})

test('adopting a source-only brief fills requirements but never invents a missing title', () => {
  const draft = requirementDraftSpec.parse({ ...base, title: '', requirements: '', assignmentPath: '要求.md' })
  const brief = requirementBrief.parse({ schemaVersion: 2, task: { nature: 'TEST_ONLY 阅读报告' },
    coverage: [], length: {}, format: {}, submission: {}, decisions: [], origins: {}, readIds: [] })
  const adopted = requirementDraftSpec.parse(adoptBrief(draft, brief, {
    adopt: [...ADOPTABLE_PATHS], summary: adoptionSummary(brief, [...ADOPTABLE_PATHS]),
  }))
  assert.match(adopted.requirements, /TEST_ONLY 阅读报告/)
  assert.equal(adopted.title, '')
  assert.equal(creationSpec.safeParse(adopted).success, false)
  assert.equal(creationSpec.safeParse({ ...adopted, title: '我的报告' }).success, true)
})

test('local and serialized validation failures become actionable field names, never raw JSON', () => {
  const result = creationSpec.safeParse({ ...base, requirements: '' })
  assert.equal(result.success, false)
  if (result.success) return
  for (const error of [result.error, new Error(result.error.message), new Error('INVALID_REQUEST: ' + result.error.message)]) {
    assert.match(creationErrorMessage(error), /请检查写作要求/)
    assert.doesNotMatch(creationErrorMessage(error), /too_small|minimum|origin|expected/)
  }
  assert.equal(creationErrorMessage(new Error('MODEL_NOT_SELECTED: 请先选择模型。')), '请先选择模型。')
})

test('a stored project from before this change still parses unchanged', () => {
  const old = creationSpec.parse({ ...base, assignmentPath: '要求/作业说明.md' })
  assert.equal(old.assignmentPath, '要求/作业说明.md')
  assert.deepEqual(old.requirementSources, [])
  assert.equal(old.countingPolicy.scope, 'body')
  assert.equal(old.countingPolicy.includeAbstract, false)
  assert.equal(old.preset, undefined)
})

test('an old section literal becomes a manual chapter, so its number is never rewritten', () => {
  const section = writingSection.parse({ id: 'section_1', title: '引言', purpose: '', targetLength: 800 })
  assert.equal(section.allocationMode, 'manual')
  const auto = writingSection.parse({ id: 'section_2', title: '正文', purpose: '', targetLength: 800, allocationMode: 'auto', allocationWeight: 2 })
  assert.equal(auto.allocationWeight, 2)
})

test('requirement sources keep workspace paths and external handles apart', () => {
  assert.equal(requirementSource.safeParse({ resourceId: 'req_1', origin: 'workspace', kind: 'file', path: '要求/说明.md' }).success, true)
  assert.equal(requirementSource.safeParse({ resourceId: 'req_1', origin: 'external', kind: 'file', handle: 'host:pick:7' }).success, true)
  assert.equal(requirementSource.safeParse({ resourceId: 'req_1', origin: 'external', kind: 'file', path: 'C:/x/y.md' }).success, false,
    '外部来源不得写成项目相对路径')
  assert.equal(requirementSource.safeParse({ resourceId: 'req_1', origin: 'workspace', kind: 'file', handle: 'host:pick:7' }).success, false,
    '工作区来源不得携带外部句柄')
})

test('an old single assignment file is read as one source without writing anything', () => {
  const legacy = spec({ assignmentPath: '要求/作业说明.md' })
  const sources = readRequirementSources(legacy)
  assert.equal(sources.length, 1)
  assert.equal(sources[0]!.origin, 'workspace')
  assert.equal(sources[0]!.path, '要求/作业说明.md')
  assert.equal(sources[0]!.role, 'assignment')
  assert.equal(usesLegacyAssignment(legacy), true)
  assert.equal(legacy.requirementSources.length, 0, '读取不得改写项目数据')
  assert.deepEqual(readRequirementSources(legacy), readRequirementSources(legacy), '同一项目每次读出同样的身份')
})

test('new requirement sources take precedence over the legacy field', () => {
  const modern = spec({ assignmentPath: '旧的.md', requirementSources: [
    { resourceId: 'req_a', origin: 'workspace', kind: 'file', path: '新的.md' }] })
  const sources = readRequirementSources(modern)
  assert.equal(sources.length, 1)
  assert.equal(sources[0]!.path, '新的.md')
  assert.equal(usesLegacyAssignment(modern), false)
})

test('a folder source contributes only the members that were confirmed', () => {
  const folder = spec({ requirementSources: [{ resourceId: 'req_dir', origin: 'workspace', kind: 'folder', path: '要求',
    members: [{ name: '要求/说明.md', size: 1200 }, { name: '要求/截图.png', size: 40000 }] }] })
  assert.deepEqual(folderMembers(folder), ['要求/说明.md', '要求/截图.png'])
  assert.deepEqual(readRequirementSources(folder)[0]!.members.length, 2)
})

test('read approval is the union of requirement sources and materials, never one implying the other', () => {
  const both = spec({ assignmentPath: '要求/说明.md', materials: ['课件/第3讲.pdf'],
    requirementSources: [{ resourceId: 'req_dir', origin: 'workspace', kind: 'folder', path: '要求', members: [{ name: '要求/说明.md' }] }] })
  const approval = readApproval(both)
  assert.deepEqual([...approval.paths].sort(), ['要求/说明.md', '课件/第3讲.pdf'].sort(), 'folder itself is not a readable material work unit')
  assert.deepEqual(approval.materials, ['课件/第3讲.pdf'], '材料清单本身不被要求来源改写')

  const onlyRequirements = readApproval(spec({ assignmentPath: '要求/说明.md' }))
  assert.deepEqual(onlyRequirements.materials, ['课件/第3讲.pdf'])
  assert.deepEqual(onlyRequirements.paths.sort(), ['要求/说明.md', '课件/第3讲.pdf'].sort(), '要求来源不要求出现在材料里')
})

test('the counting unit follows the paper language unless the user chose otherwise', () => {
  assert.equal(countingUnit(spec()), 'zh-CN')
  assert.equal(countingUnit(spec({ language: 'en' })), 'en')
  assert.equal(countingUnit(spec({ countingPolicy: { unit: 'en' } })), 'en')
  assert.equal(countingUnit(spec({ language: 'en', countingPolicy: { unit: 'zh-CN' } })), 'zh-CN')
})

test('a preset selection records where the structure came from, with its own version', () => {
  const selected = spec({ preset: { id: 'research-empirical-imrad', source: 'builtin', version: '1.0.0', modified: true } })
  assert.equal(selected.preset!.id, 'research-empirical-imrad')
  assert.equal(selected.preset!.source, 'builtin')
  assert.equal(selected.preset!.modified, true)
  assert.equal(creationSpec.safeParse({ ...base, preset: { id: 'Bad Id', source: 'builtin', version: '1.0.0' } }).success, false)
  assert.equal(creationSpec.safeParse({ ...base, preset: { id: 'x', source: 'library', version: '1.0.0' } }).success, false)
})
