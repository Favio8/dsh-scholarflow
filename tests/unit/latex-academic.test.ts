import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latexDocument } from '../../src/core/export/formats.ts'
import { DEFAULT_TYPOGRAPHY } from '../../src/core/export/typography.ts'
import type { Ledger, ProjectConfig, Source } from '../../src/shared/schema.ts'

// LaTeX export mirrors the Word one: same manuscript, same decisions, and the reference list
// is never printed twice.

const config = { project: { id: 'p_TEST', title: 'TEST_ONLY', type: 'course-paper', language: 'zh-CN' },
  paths: {} } as unknown as ProjectConfig
const source = (key: string, title: string): Source => ({
  id: `src_${key}`, kind: 'paper', title, authors: [{ literal: '王五' }], venue: '测试学报', year: 2025,
  identifiers: {}, citeKey: key, provenance: [], identity: { status: 'unverified', method: 'none' }, textAccess: 'metadata',
} as Source)
const ledger = { sources: { a: source('sf_one', 'TEST_ONLY 甲'), b: source('sf_two', 'TEST_ONLY 乙') } } as unknown as Ledger
const manuscript = [
  '# TEST_ONLY 标题', '', '## 引言', '', '引言正文 [@sf_two]。', '',
  '表 2-1 符号说明', '', '| 符号 | 说明 |', '| --- | --- |', '| α | 学习率 |', '',
  '$$', 'E = mc^2', '$$', '', '## 结论', '', '结论正文 [@sf_one]。', '',
].join('\n')

test('the packages a Chinese academic paper needs are all loaded', () => {
  const tex = latexDocument(manuscript, config, ledger)
  for (const name of ['booktabs', 'caption', 'fancyhdr', 'titlesec', 'longtable', 'amsmath'])
    assert.match(tex, new RegExp(`\\\\usepackage\\{[^}]*${name}`), `缺少 ${name}`)
  assert.match(tex, /\\usepackage\[margin=25mm\]\{geometry\}/u, '页面设置保留')
  assert.match(tex, /\\setcounter\{secnumdepth\}\{3\}/u, '标题默认编号到三级')
  assert.match(tex, /\\pagestyle\{fancy\}/u, '页脚居中页码')
})

test('a table becomes a floating three-line table with its own caption', () => {
  const tex = latexDocument(manuscript, config, ledger)
  assert.match(tex, /\\begin\{table\}\[htbp\]/u)
  assert.match(tex, /\\caption\{表 2-1 符号说明\}/u, '题注取主稿原文')
  assert.match(tex, /\\toprule/u)
  assert.match(tex, /\\midrule/u)
  assert.match(tex, /\\bottomrule/u)
  assert.equal(/\\hline/.test(tex), false, '三线表不使用全框线')
})

test('a block formula becomes a numbered equation', () => {
  const tex = latexDocument(manuscript, config, ledger)
  assert.match(tex, /\\begin\{equation\}/u)
  assert.match(tex, /E = mc\^2/u)
  assert.equal(/\\\[/.test(tex), false, '不再用无编号的显示公式')
})

test('the reference list is thebibliography, and never both lists', () => {
  const tex = latexDocument(manuscript, config, ledger)
  assert.match(tex, /\\begin\{thebibliography\}/u)
  assert.equal(/\\bibliographystyle/.test(tex), false)
  assert.equal(/\\bibliography\{references\}/.test(tex), false)
  assert.ok(tex.indexOf('TEST\\_ONLY 乙') < tex.indexOf('TEST\\_ONLY 甲'), '文献表顺序与引用顺序一致')
  assert.match(tex, /\\bibitem\{ref_1\}/u)
})

test('a caption the manuscript wrote is printed once, not twice', () => {
  const tex = latexDocument(manuscript, config, ledger)
  assert.equal(tex.split('表 2-1 符号说明').length - 1, 1, '题注只出现一次')
})

test('an English paper keeps the western document class and the plain reference style', () => {
  const english = { ...config, project: { ...config.project, language: 'en' } } as unknown as ProjectConfig
  const tex = latexDocument(manuscript, english, ledger)
  assert.match(tex, /\\documentclass\[a4paper,12pt\]\{article\}/u)
  assert.equal(/ctexart/.test(tex), false)
  assert.equal(/\\pagestyle\{fancy\}/.test(tex), false, '英文交付不套中文页脚')
})

test('a requirement that says the headings are not numbered switches secnumdepth off', () => {
  const tex = latexDocument(manuscript, config, ledger, { ...DEFAULT_TYPOGRAPHY, headingNumbering: 'none' })
  assert.match(tex, /\\setcounter\{secnumdepth\}\{0\}/u)
})

test('a requirement that asks for Chinese chapter numbering uses ctex numerals', () => {
  const tex = latexDocument(manuscript, config, ledger, { ...DEFAULT_TYPOGRAPHY, headingNumbering: 'chinese' })
  assert.match(tex, /\\renewcommand\{\\thesection\}\{\\zhnum\{section\}\}/u)
})

test('a grid table uses full rules instead of booktabs', () => {
  const tex = latexDocument(manuscript, config, ledger, { ...DEFAULT_TYPOGRAPHY, tableStyle: 'grid' })
  assert.match(tex, /\\hline/u)
})

test('with no cited sources there is no reference list at all', () => {
  const tex = latexDocument('## 引言\n\n没有引用。', config, ledger)
  assert.equal(/thebibliography|bibliography/.test(tex), false)
})
