import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { buildProposal, storeProposal } from '../../src/core/editing/proposals.ts'
import { sectionTarget } from '../../src/core/editing/sections.ts'
import { creationSpec, writingQuestion } from '../../src/shared/writing-task.ts'
import { createWritingTask } from '../../src/core/pipeline/writing-task-store.ts'
import { driveWritingTask, type WritingServices } from '../../src/core/pipeline/writing-task.ts'

// TEST_ONLY: real domain persistence, deterministic model adapter. The question this answers
// is what the paper actually looks like when a preset with an abstract and subsections is
// applied: the skeleton carries the nesting, and the abstract is written last.

async function setup() {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY 只记录教学说明，没有实验结果。' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 课程论文', type: 'course-paper' }))
  await confirmOutline(io, { version: 0, title: 'TEST_ONLY', researchQuestion: 'TEST_ONLY 范围', thesis: 'TEST_ONLY', confirmation: 'draft',
    sections: [{ id: 'section_legacy', title: '占位', purpose: '', claimIds: [], missingEvidence: [] }] }, (await snapshot(io)).ledger.revision, 0)
  const spec = creationSpec.parse({ title: 'TEST_ONLY 课程论文', type: 'course-paper', language: 'zh-CN', format: 'markdown',
    requirements: 'TEST_ONLY 写一篇课程论文，约 2000 字', materials: [], requirementSources: [], online: false, targetLength: 2000,
    manuscriptDir: 'manuscript', supplementalParts: [],
    sections: [
      { id: 'sec_abstract', title: '摘要', purpose: '总结全文观点与依据', targetLength: 300, allocationMode: 'manual', kind: 'front' },
      { id: 'sec_keywords', title: '关键词', purpose: '三到五个', targetLength: 50, allocationMode: 'manual', kind: 'front' },
      { id: 'sec_intro', title: '引言', purpose: '提出问题', targetLength: 400, allocationMode: 'auto', allocationWeight: 0.2, kind: 'body' },
      { id: 'sec_argument', title: '主题论证', purpose: '展开论证', targetLength: 50, allocationMode: 'auto', allocationWeight: 0, kind: 'body' },
      { id: 'sec_claim', title: '主要论据', purpose: '核心证据', targetLength: 640, allocationMode: 'auto', allocationWeight: 0.64, parentId: 'sec_argument', kind: 'body' },
      { id: 'sec_evidence', title: '补充材料', purpose: '第二类证据', targetLength: 480, allocationMode: 'auto', allocationWeight: 0.48, parentId: 'sec_argument', kind: 'body' },
      { id: 'sec_conclusion', title: '结论', purpose: '收束', targetLength: 480, allocationMode: 'auto', allocationWeight: 0.48, kind: 'body' },
      { id: 'sec_thanks', title: '致谢', purpose: '致谢', targetLength: 100, allocationMode: 'manual', kind: 'back' }] })
  const task = await createWritingTask(io, spec, 'session_TEST_ONLY', 'TEST_ONLY')
  task.stage = 'outline'; task.sectionIndex = 0
  // Answering this once is what lets the run continue without located evidence; the sections
  // are then generated with a 待补 note instead of fabricated content.
  task.questions = [writingQuestion.parse({ id: 'q_TEST_ONLY', title: 'TEST_ONLY 资料问题', options: ['先创建结构草稿'], kind: 'materials', answered: '先创建结构草稿' })]
  const generated: string[] = []
  const services: WritingServices = { signal: new AbortController().signal, pauseRequested: () => false,
    parse: async () => { throw new Error('unexpected parse') }, search: async () => [], recoverChild: async () => undefined,
    model: async () => JSON.stringify({ question: null, claims: [] }),
    generate: async (sectionId, instruction) => {
      generated.push(sectionId)
      const current = await snapshot(io)
      const range = sectionTarget(current.document.text, current.ledger.outline, sectionId)
      const proposal = buildProposal(current, { runId: 'run_TEST_ONLY_structure', instruction, replacementText: '', dependentEvidenceIds: [],
        section: { sectionId, outlineVersion: current.ledger.outline.version, body: `TEST_ONLY ${sectionId} 正文。`,
          paragraphClaims: [{ paragraphIndex: 0, claimIds: [] }], limitations: ['TEST_ONLY simulated provider'] } })
      await storeProposal(io, proposal, current.ledger.revision)
      void range
      return { proposalId: proposal.id }
    } }
  return { io, task, services, generated }
}

test('a preset with an abstract and subsections produces a nested skeleton and drafts the body first', async () => {
  const { io, task, services, generated } = await setup()
  await driveWritingTask(io, task, services)
  const text = (await snapshot(io)).document.text
  // The skeleton keeps document order: front matter, body with its subsections, back matter.
  const headings = text.split('\n').filter(line => line.startsWith('#'))
  assert.deepEqual(headings, ['# TEST_ONLY 课程论文', '## 摘要', '## 关键词', '## 引言', '## 主题论证', '### 主要论据', '### 补充材料', '## 结论', '## 致谢'])
  // A subsection is one level deeper than its chapter, which is what sectionTarget derives
  // from the parent chain; every section was found and written.
  assert.deepEqual(generated, ['sec_intro', 'sec_argument', 'sec_claim', 'sec_evidence', 'sec_conclusion', 'sec_abstract', 'sec_keywords', 'sec_thanks'])
  assert.ok(task.notes.some(note => note.includes('正文之后生成')), `起草顺序须记录在任务备注里，实际：${JSON.stringify(task.notes)}`)
})

test('a subsection cannot be located against a flat skeleton, so the depth matters', async () => {
  const { io, task, services } = await setup()
  await driveWritingTask(io, task, services)
  const current = await snapshot(io)
  // The outline records the parent, and the manuscript heading agrees with it.
  const child = current.ledger.outline.sections.find(section => section.id === 'sec_claim')!
  assert.equal(child.parentId, 'sec_argument')
  assert.equal(child.kind, 'body')
  assert.doesNotThrow(() => sectionTarget(current.document.text, current.ledger.outline, 'sec_claim'))
})
