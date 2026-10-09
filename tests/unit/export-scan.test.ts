import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectMarkdown } from '../../src/core/editing/markdown.ts'
import { scanDocument, isCaptionText } from '../../src/core/export/scan.ts'

// The scan is where the manuscript is read for layout. It runs on one AST node at a time and
// compares whole texts, so the interesting cases are the ones that look like a caption or a
// section boundary but are prose.

const plan = (source: string) => scanDocument(projectMarkdown(source))

test('the first level-1 heading becomes the title and is not repeated in the body', () => {
  const scanned = plan('# 题目\n\n## 引言\n\n内容。\n')
  assert.equal(scanned.title, '题目')
  assert.deepEqual(scanned.headings, [{ text: '引言', depth: 2 }])
  assert.equal(scanned.blocks.filter(block => block.role === 'title').length, 1)
})

test('a caption belongs to the table above it, and a caption to the figure below it', () => {
  const scanned = plan('表 2-1 符号说明\n\n| 符号 | 说明 |\n| --- | --- |\n| α | 学习率 |\n\n![图](a.png)\n\n图 2-1 系统架构\n')
  const table = scanned.blocks.find(block => block.role === 'table')!
  const figure = scanned.blocks.find(block => block.role === 'figure')!
  assert.equal(table.caption, '表 2-1 符号说明')
  assert.equal(table.captionAbove, true)
  assert.equal(figure.caption, '图 2-1 系统架构')
  assert.equal(figure.captionAbove, false)
  // The caption paragraphs are carried by their table and figure, not emitted twice.
  assert.equal(scanned.blocks.length, 2)
})

test('a sentence that merely starts with 图 1-1 stays prose', () => {
  const scanned = plan('如图 1-1 所示，学习率决定了收敛速度。\n')
  assert.deepEqual(scanned.blocks.map(block => block.role), ['paragraph'])
  assert.equal(scanned.blocks[0]!.isCaption, undefined)
  assert.equal(isCaptionText('如图 1-1 所示，学习率决定了收敛速度。'), false)
  assert.equal(isCaptionText('图 1-1 系统架构'), true)
  assert.equal(isCaptionText('表 3-2 不同设置下的误差'), true)
})

test('a caption that names no number is not treated as one', () => {
  assert.equal(isCaptionText('图 系统架构'), false)
  assert.equal(isCaptionText('表 说明'), false)
})

test('a caption with nothing adjacent stays prose instead of being dropped', () => {
  const scanned = plan('表 2-1 符号说明\n\n这里只是引用了一下上面的表。\n')
  assert.deepEqual(scanned.blocks.map(block => block.role), ['paragraph', 'paragraph'])
  assert.equal(scanned.formatNotes.some(note => note.includes('未自动补编号')), false, '没有图表就不该报告缺题注')
})

test('block formulas are counted in document order', () => {
  const scanned = plan('$$\na = b\n$$\n\n$$\nc = d\n$$')
  assert.equal(scanned.equationCount, 2)
  assert.ok(scanned.formatNotes.some(note => note.includes('(1)–(2)')))
})

test('a references heading the manuscript already wrote is not added again', () => {
  const scanned = plan('## 参考文献\n\n条目。\n')
  assert.equal(scanned.hasReferencesHeading, true)
  assert.ok(scanned.formatNotes.some(note => note.includes('不重复添加')))
  const none = plan('## 结论\n\n收束。\n')
  assert.equal(none.hasReferencesHeading, false)
})

test('a document with no level-1 heading is reported rather than given an invented title', () => {
  const scanned = plan('## 引言\n\n内容。\n')
  assert.equal(scanned.title, undefined)
  assert.ok(scanned.formatNotes.some(note => note.includes('没有一级标题')))
})

test('a table with no header row still scans, so nothing is silently dropped', () => {
  const scanned = plan('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  assert.equal(scanned.blocks[0]!.role, 'table')
  assert.deepEqual(scanned.formatNotes.filter(note => note.includes('未自动补编号')).length, 1)
})
