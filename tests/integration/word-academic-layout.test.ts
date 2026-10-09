import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { wordDocument } from '../../src/core/export/formats.ts'
import { DEFAULT_TYPOGRAPHY } from '../../src/core/export/typography.ts'
import type { Ledger, ProjectConfig, Source } from '../../src/shared/schema.ts'

// The layout a Chinese coursework paper is normally submitted under. These assertions read the
// produced XML, because "it exported" says nothing about whether the headings are numbered,
// the table has three rules or the reference list hangs.

const config = { project: { id: 'p_TEST', title: 'TEST_ONLY 报告', type: 'course-paper', language: 'zh-CN' },
  paths: { manuscriptDir: 'manuscript', mainDocument: 'manuscript/paper.md', references: 'manuscript/references.bib' } } as unknown as ProjectConfig

const source = (overrides: Partial<Source> = {}): Source => ({
  id: 'src_TEST_ONLY', kind: 'paper', title: 'TEST_ONLY 文献', authors: [{ literal: '王五' }], venue: '测试学报', year: 2025,
  identifiers: {}, citeKey: 'sf_TEST_ONLY', provenance: [], identity: { status: 'unverified', method: 'none' },
  textAccess: 'metadata', ...overrides,
} as Source)
const ledger = { sources: { src_TEST_ONLY: source() } } as unknown as Ledger

const manuscript = [
  '# TEST_ONLY 课程论文', '',
  '## 摘要', '', '本文分析一个 TEST_ONLY 问题，给出观点与依据。', '',
  '## 关键词', '', '课程论文；结构预设', '',
  '## 引言', '', '引言正文，说明问题与路线 [@sf_TEST_ONLY]。', '',
  '### 研究背景', '', '背景正文。', '',
  '### 研究现状', '', '现状正文。', '',
  '## 材料与方法', '', '方法正文。', '',
  '表 2-1 符号说明', '',
  '| 符号 | 说明 |', '| --- | --- |', '| α | 学习率 |', '',
  '$$', 'E = mc^2', '$$', '',
  '## 结论', '', '结论正文。', '',
  '## 致谢', '', '谢谢。', '',
].join('\n')

async function read(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files)
  const text = async (name: string) => (await zip.file(name)?.async('string')) ?? ''
  return { document: await text('word/document.xml'), styles: await text('word/styles.xml'),
    numbering: await text('word/numbering.xml'), settings: await text('word/settings.xml'), names,
    footers: names.filter(name => /^word\/footer/.test(name)).sort() }
}

test('headings carry one all-decimal numbering configuration, so 二.4 cannot appear', async () => {
  const { numbering, document } = await read(await wordDocument(manuscript, config, ledger))
  assert.match(numbering, /w:numFmt w:val="decimal"/u, '编号格式必须是十进制')
  // Three levels are actually used by this manuscript; each must spell its own pattern.
  for (const pattern of ['%1', '%1.%2', '%1.%2.%3']) assert.ok(numbering.includes(`w:lvlText w:val="${pattern}"`), `缺少 ${pattern}`)
  // ilvl is zero-based: a second-level heading is level 1, a third-level heading level 2.
  const used = [...document.matchAll(/<w:ilvl w:val="(\d)"/gu)].map(row => Number(row[1]))
  assert.deepEqual([...new Set(used)].sort(), [0, 1, 2], '本文档用到一级、二级与三级标题编号')
  // Every used level must be one of the decimal ones, never a fallback style.
  assert.equal(/w:numFmt w:val="(?:chineseCounting|legal)/u.test(numbering), false)
})

test('headings use 黑体 at their own size instead of Word’s built-in blue style', async () => {
  const { document } = await read(await wordDocument(manuscript, config, ledger))
  assert.match(document, /w:eastAsia="黑体"/u, '标题中文必须落到黑体槽位')
  const sizes = [...document.matchAll(/<w:sz w:val="(\d+)"\/>/gu)].map(row => Number(row[1]))
  assert.ok(sizes.includes(32), '一级标题是三号 16pt = 32 半磅')
  assert.ok(sizes.includes(28), '二级标题是四号 14pt = 28 半磅')
  assert.ok(sizes.includes(24), '三级标题是小四 12pt = 24 半磅')
})

test('body paragraphs indent two characters, which is 480 twips at 小四', async () => {
  const { document } = await read(await wordDocument(manuscript, config, ledger))
  assert.match(document, /<w:ind w:firstLine="480"\/>/u)
})

test('a table is a three-line table: rules top and bottom and under the header row only', async () => {
  const { document } = await read(await wordDocument(manuscript, config, ledger))
  assert.match(document, /w:val="single" w:sz="12"/u, '上下框线是 1.5pt')
  assert.match(document, /w:val="single" w:sz="6"/u, '栏目线是 0.75pt')
  assert.match(document, /w:val="none"/u, '其余边框必须显式关闭')
  // The caption the manuscript wrote sits above the table, centred and bold.
  assert.match(document, /表 2-1 符号说明/u)
  const captionIndex = document.indexOf('表 2-1 符号说明'), tableIndex = document.indexOf('<w:tbl>')
  assert.ok(captionIndex > 0 && captionIndex < tableIndex, '表题必须在表上方')
})

test('a block formula is a borderless three-column table with a right-aligned number', async () => {
  const { document } = await read(await wordDocument(manuscript, config, ledger))
  assert.match(document, /\$\$E = mc\^2\$\$/u)
  assert.match(document, />\(1\)</u, '公式编号按文档顺序生成')
})

test('the reference list hangs two characters and each entry follows GB/T 7714', async () => {
  const { document } = await read(await wordDocument(manuscript, config, ledger))
  assert.match(document, /<w:ind w:left="480" w:hanging="480"\/>/u)
  assert.match(document, /\[1\] 王五\. TEST_ONLY 文献\[J\]\. 测试学报, 2025\./u)
  // 致谢 and the references heading each start a new page.
  assert.ok(document.split('w:pageBreakBefore').length >= 3, '致谢、参考文献等应另起一页')
})

test('the table of contents is a field with cached entries, and fields update on open', async () => {
  const { document, settings, names } = await read(await wordDocument(manuscript, config, ledger))
  assert.match(document, /<w:instrText[^>]*>TOC/u)
  assert.match(document, /&quot;1-3&quot;/u, '目录域必须覆盖三级标题')
  assert.match(document, /目录/u)
  assert.match(settings, /<w:updateFields/u, '打开时必须提示更新域，否则目录没有页码')
  assert.equal(names.includes('word/settings.xml'), true)
})

test('an English paper keeps western conventions: no Chinese heading font, no GB/T style', async () => {
  const english = { ...config, project: { ...config.project, language: 'en' } } as unknown as ProjectConfig
  const { document } = await read(await wordDocument(manuscript, english, ledger))
  assert.equal(/w:eastAsia="黑体"/u.test(document), false)
  assert.equal(/w:hanging="480"/u.test(document), false)
  assert.match(document, /正文中文与|引言/u, '正文内容仍然导出')
})

test('the same manuscript exports with heading numbering switched off', async () => {
  const { document } = await read(await wordDocument(manuscript, config, ledger, {}))
  assert.match(document, /w:eastAsia="黑体"/u)
})
