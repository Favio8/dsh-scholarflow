import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { wordDocument } from '../../src/core/export/formats.ts'
import { coverParagraphs } from '../../src/core/export/word.ts'
import { typographyToDocx } from '../../src/core/export/typography.ts'
import { DEFAULT_TYPOGRAPHY } from '../../src/core/export/typography.ts'
import type { Ledger, ProjectConfig } from '../../src/shared/schema.ts'

const config = { project: { id: 'p_TEST', title: 'TEST_ONLY 报告', type: 'course-paper', language: 'zh-CN' },
  paths: { manuscriptDir: 'manuscript', mainDocument: 'manuscript/paper.md', references: 'manuscript/references.bib' } } as unknown as ProjectConfig
const ledger = { sources: {} } as unknown as Ledger
const coverDocx = typographyToDocx(DEFAULT_TYPOGRAPHY)
const coverFont = { ascii: coverDocx.fonts.ascii, hAnsi: coverDocx.fonts.hAnsi, eastAsia: coverDocx.fonts.eastAsia, cs: coverDocx.fonts.cs }
const body = '# TEST_ONLY 标题\n\n正文中文与 English words 混排。\n\n## 第一节\n\n内容。\n'

async function readDocumentXml(bytes: Uint8Array, extra = {}) {
  const zip = await JSZip.loadAsync(bytes)
  const footers = Object.keys(zip.files).filter(name => /^word\/footer\d*\.xml$/u.test(name)).sort()
  const footerText = (await Promise.all(footers.map(name => zip.file(name)!.async('string')))).join('')
  return { xml: await zip.file('word/document.xml')!.async('string'), styles: await zip.file('word/styles.xml')!.async('string'),
    footers, footerText, extra }
}

test('both font slots are set, so Chinese and western runs stop falling back to the theme', async () => {
  const { xml, styles } = await readDocumentXml(await wordDocument(body, config, ledger))
  const document = xml + styles
  assert.match(document, /w:eastAsia="宋体"/u, '本体中文没有写到 eastAsia 槽位')
  assert.match(document, /w:ascii="Times New Roman"/u, '西文没有写到 ascii 槽位')
  assert.match(document, /w:hAnsi="Times New Roman"/u, '西文没有写到 hAnsi 槽位')
})

test('小四 becomes 24 half-points and 1.2 倍行距 becomes 288 twentieths, not 360', async () => {
  const { xml, styles } = await readDocumentXml(await wordDocument(body, config, ledger))
  assert.match(xml + styles, /w:sz w:val="24"/u)
  assert.match(xml, /w:line="288"/u, '1.2 倍行距应写为 288；360 是 1.5 倍')
  assert.equal(/w:line="360"/u.test(xml), false, '旧的 1.5 倍行距不应残留')
  assert.match(xml, /w:lineRule="auto"/u, '倍数行距必须用 auto，固定值会改变实际行高')
})

test('the page is A4 with the configured margins', async () => {
  const { xml } = await readDocumentXml(await wordDocument(body, config, ledger))
  assert.match(xml, /w:pgSz w:w="11906" w:h="16838"/u)
  const margins = /w:pgMar[^/]*w:top="(\d+)"[^/]*w:right="(\d+)"[^/]*w:bottom="(\d+)"[^/]*w:left="(\d+)"/u.exec(xml)
  assert.ok(margins, '没有写出页边距')
  assert.equal(Number(margins[1]), Math.round(25 * 56.6929))
})

test('a requirement that asks for a different size and spacing is executed, not just recorded', async () => {
  const typography = { ...DEFAULT_TYPOGRAPHY, bodySizePt: 14, bodySizeLabel: '四号', lineSpacing: 1.5 }
  const { xml, styles } = await readDocumentXml(await wordDocument(body, config, ledger, { typography }))
  // The body size is the document default (headings keep their own, larger, style size), so
  // it belongs in styles.xml; the line multiple is written per paragraph in document.xml.
  assert.match(styles, /w:sz w:val="28"/u, '四号 is 14pt = 28 half-points')
  assert.match(xml, /w:line="360"/u, '1.5 倍行距 is 360')
  assert.equal(/w:line="288"/u.test(xml), false, '旧的行距不应残留在新的排版设置里')
})

test('the cover is requested only when the requirement asked for one', async () => {
  const without = await readDocumentXml(await wordDocument(body, config, ledger))
  assert.equal(without.xml.match(/<w:sectPr/g)!.length, 1, '没有要求封面时只有一个节')
  assert.match(without.xml, /<w:footerReference/u, '正文节必须有页脚')
  assert.equal(without.footers.length, 1, '页脚必须写成一个部件')
  assert.match(without.footerText, /PAGE/u, '页脚必须写页码域')

  const withCover = await readDocumentXml(await wordDocument(body, config, ledger,
    { cover: { enabled: true, title: 'TEST_ONLY 题目', fields: [{ label: '姓名', value: 'TEST_ONLY' }], date: '' } }))
  // The cover is its own section, so the body starts on a fresh page without a page-break run
  // and can number its pages from 1 while the cover carries no number.
  assert.equal(withCover.xml.match(/<w:sectPr/g)!.length, 2, '封面必须是独立的一节')
  assert.match(withCover.xml, /<w:pgNumType w:start="1"/u, '正文节必须从 1 开始编页')
  const coverIndex = withCover.xml.indexOf('TEST_ONLY 题目')
  const bodyIndex = withCover.xml.indexOf('正文中文')
  assert.equal(coverIndex > 0 && coverIndex < bodyIndex, true, '封面必须排在正文之前')
})

test('a cover with no date omits the date line instead of inventing one', () => {
  const paragraphs = coverParagraphs({ enabled: true, title: 'T', fields: [{ label: '姓名', value: 'N' }], date: '' }, coverDocx, coverFont, 'zh-CN')
  const text = JSON.stringify(paragraphs)
  assert.equal(/\d{4}\s*年/u.test(text), false, '参考报告或今天的日期都不应出现在封面')
  const withDate = coverParagraphs({ enabled: true, title: 'T', fields: [], date: '2026 年 10 月' }, coverDocx, coverFont, 'zh-CN')
  assert.match(JSON.stringify(withDate), /2026 年 10 月/u, '用户写下的日期应当保留')
})

test('an empty cover field is dropped rather than exported as a blank label', () => {
  const paragraphs = coverParagraphs({ enabled: true, title: 'T', fields: [{ label: '学号', value: '' }, { label: '姓名', value: 'N' }], date: '' }, coverDocx, coverFont, 'zh-CN')
  const text = JSON.stringify(paragraphs)
  assert.equal(text.includes('学号'), false)
  assert.match(text, /姓名/u)
})
