import { test } from 'node:test'
import { wordStats } from '../../src/core/editing/markdown.ts'
import assert from 'node:assert/strict'
import { validateGeneration, assessOutline, validateOutline, moveOutlineSection, outlineInputKey } from '../../src/core/requirements/outline.ts'
import { requirementDraftSpec, creationSpec, writingSection } from '../../src/shared/writing-task.ts'

const spec = (requirements: string) => requirementDraftSpec.parse({ title: '', type: 'course-paper', language: 'zh-CN',
  format: 'docx', requirements, materials: [], targetLength: 1500, sections: [] })
const row = (id: string, title: string, parentId?: string) => writingSection.parse({ id, title, targetLength: 500, ...(parentId && { parentId }) })

test('different tasks preserve model-chosen structures without injected chapter names', () => {
  for (const [requirement, titles] of [
    ['比较政策的实施条件与实际影响', ['实施环境', '影响与适用边界']],
    ['分析小说中的叙事视角', ['视角转换', '叙事距离与阅读感受']],
    ['分析论文结构与各部分承接关系', ['文献信息的定位作用', '论证链与章节衔接', '研究贡献的呈现']],
  ] as const) {
    const generated = validateGeneration({ taskSummary: requirement, targetLength: 1500,
      sections: titles.map((title, i) => row(`s${i}`, title)), requirements: [{ id: 'r1', text: requirement, quote: requirement }] }, spec(requirement))
    assert.deepEqual(generated.sections.map(row => row.title), titles)
    const checked = assessOutline(generated, { coverage: [{ itemId: 'r1', sectionIds: ['s0'], status: 'partial', reason: '覆盖了任务的一部分，还需解释其余部分。' }], issues: [] })
    assert.equal(checked.coverage[0].covered, false)
    assert(checked.gaps.some(gap => gap.includes('还需解释')))
    assert(!checked.gaps.some(gap => gap.includes('实验')))
  }
})

test('matching words cannot override a model assessment of missing semantic coverage', () => {
  const input = spec('解释方法如何支撑结论')
  const generated = validateGeneration({ taskSummary: input.requirements, targetLength: 500,
    sections: [row('s1', '方法与结论')], requirements: [{ id: 'r1', text: input.requirements, quote: input.requirements }] }, input)
  const reviewed = assessOutline(generated, { coverage: [{ itemId: 'r1', sectionIds: ['s1'], status: 'missing', reason: '只是列出名词，没有解释支撑关系。' }] })
  assert.equal(reviewed.coverage[0].covered, false)
})

test('invented source requirements and unknown, duplicate or omitted review references are rejected', () => {
  const input = spec('分析叙事视角')
  const data = { taskSummary: '叙事分析', targetLength: 500, sections: [row('s1', '叙事分析')], requirements: [{ id: 'r1', text: input.requirements, quote: input.requirements }] }
  assert.throws(() => validateGeneration({ ...data, requirements: [{ id: 'r1', text: '补做实验', quote: '请补做实验' }] }, input), /无法回到/)
  const generated = validateGeneration(data, input)
  const valid = { itemId: 'r1', sectionIds: ['s1'], status: 'covered', reason: '解释叙事视角。' }
  for (const coverage of [[], [valid, valid], [{ ...valid, itemId: 'invented' }], [{ ...valid, sectionIds: ['invented'] }], [{ ...valid, sectionIds: [] }]])
    assert.throws(() => assessOutline(generated, { coverage }))
})

test('all confirmed requirements survive generation, and an explicit target overrides model preference', () => {
  const input = { ...spec('比较两种政策'), targetLengthOrigin: 'user' as const, targetLength: 2200,
    brief: { ...requirementDraftSpec.parse({ ...spec('比较两种政策'), brief: {} }).brief!, coverage: [{ id: 'c1', text: '比较两种政策', kind: 'dimension' as const }] } }
  const data = { taskSummary: '政策比较', targetLength: 1500, sections: [row('s1', '制度比较')], requirements: [{ id: 'c1', text: '比较两种政策', quote: '' }] }
  assert.equal(validateGeneration(data, input).targetLength, 2200)
  assert.throws(() => validateGeneration({ ...data, requirements: [{ id: 'r1', text: '比较', quote: '比较' }] }, input), /遗漏/)
})

test('empty drafts parse but cannot be submitted, and outline inputs track materials and requirements', () => {
  const draft = spec('做文献比较')
  assert.equal(draft.sections.length, 0)
  assert.equal(creationSpec.safeParse({ ...draft, title: '报告' }).success, false)
  assert.notEqual(outlineInputKey(draft), outlineInputKey({ ...draft, materials: ['已选.pdf'] }))
  assert.notEqual(outlineInputKey(draft), outlineInputKey({ ...draft, requirements: '另一个任务' }))
})

test('parents move with children; children stay inside a contiguous parent group', () => {
  const sections = [row('a', '甲'), row('a1', '甲一', 'a'), row('a2', '甲二', 'a'), row('b', '乙'), row('b1', '乙一', 'b')]
  const moved = moveOutlineSection(sections, 'a', 1)
  assert.deepEqual(moved.map(row => row.id), ['b', 'b1', 'a', 'a1', 'a2'])
  validateOutline(moved)
  assert.deepEqual(moveOutlineSection(sections, 'a1', 1).map(row => row.id), ['a', 'a2', 'a1', 'b', 'b1'])
  assert.equal(moveOutlineSection(sections, 'a2', 1), sections)
  assert.throws(() => validateOutline([sections[0], sections[3], sections[1]]), /子节/)
  assert.throws(() => validateOutline([sections[0], sections[0]]), /重复/)
})


test('the role of an analysis section controls counting instead of the name of the analyzed part', () => {
  const manuscript = '## 摘要\n分析摘要如何概括研究。\n## 参考文献\n分析文献组织如何支撑论证。'
  const body = wordStats(manuscript, { bodyOnly: true, sectionKinds: [{ title: '摘要', kind: 'body' }, { title: '参考文献', kind: 'body' }] })
  assert(body.chineseCharacters > 20)
  assert.equal(wordStats(manuscript, { bodyOnly: true }).chineseCharacters, 0, 'old untyped manuscripts keep their existing policy')
  assert.equal(wordStats(manuscript, { bodyOnly: true, sectionKinds: [{ title: '摘要', kind: 'front' }, { title: '参考文献', kind: 'back' }] }).chineseCharacters, 0)
})
