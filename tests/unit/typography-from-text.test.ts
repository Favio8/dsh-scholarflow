import { test } from 'node:test'
import assert from 'node:assert/strict'
import { typographyFromText, DEFAULT_TYPOGRAPHY } from '../../src/core/export/typography.ts'

// A stated convention overrides the shipped default; silence keeps it. Nothing here may
// invent a value the assignment never asked for.

test('a requirement that says the headings are not numbered switches numbering off', () => {
  const next = typographyFromText('标题不编号，正文宋体小四。')
  assert.equal(next.headingNumbering, 'none')
  assert.equal(DEFAULT_TYPOGRAPHY.headingNumbering, 'decimal', '默认仍然是十进制编号')
})

test('a requirement written as 第1章 asks for Chinese chapter numbering', () => {
  assert.equal(typographyFromText('各章按第1章、第2章编号。').headingNumbering, 'chinese')
})

test('a stated heading font is used, and an unstated one keeps the default', () => {
  assert.equal(typographyFromText('标题用黑体，正文用宋体。').headingFontZh, '黑体')
  assert.equal(typographyFromText('标题用楷体。').headingFontZh, '楷体')
  assert.equal(typographyFromText('正文宋体小四，1.5 倍行距。').headingFontZh, DEFAULT_TYPOGRAPHY.headingFontZh)
})

test('a stated indent in characters is executed, and a nonsense one is ignored', () => {
  assert.equal(typographyFromText('首行缩进 2 字符。').firstLineIndentChars, 2)
  assert.equal(typographyFromText('首行缩进 0 字符。').firstLineIndentChars, 0)
  assert.equal(typographyFromText('首行缩进 40 字符。').firstLineIndentChars, DEFAULT_TYPOGRAPHY.firstLineIndentChars)
})

test('a stated table and reference convention is recognised', () => {
  assert.equal(typographyFromText('表格用三线表。').tableStyle, 'three-line')
  assert.equal(typographyFromText('参考文献按 GB/T 7714 格式。').referenceStyle, 'gbt7714')
  assert.equal(typographyFromText('不要目录。').tableOfContents, 'none')
  assert.equal(typographyFromText('需要有目录。').tableOfContents, 'field')
})

test('a requirement that says nothing about layout keeps every default', () => {
  const next = typographyFromText('写一篇约 3000 字的课程论文。')
  assert.deepEqual(next, DEFAULT_TYPOGRAPHY)
})

test('a stated font, size and spacing still win over the layout defaults', () => {
  const next = typographyFromText('中文用楷体，英文用 Arial，字号四号，1.5 倍行距，页边距 3cm。')
  assert.equal(next.bodyFontZh, '楷体')
  assert.equal(next.bodyFontEn, 'Arial')
  assert.equal(next.bodySizePt, 14)
  assert.equal(next.bodySizeLabel, '四号')
  assert.equal(next.lineSpacing, 1.5)
})
