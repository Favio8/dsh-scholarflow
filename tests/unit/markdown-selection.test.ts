import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectMarkdown, mapLeafPoint, validateRange, validateSelection, validateProseRange, citationKeys, unicodeBoundary, wordStats } from '../../src/core/editing/markdown.ts'

test('local co-writing supports adjacent prose while preserving atomic citation and special-block boundaries', () => {
  const source = '首段事实 [@sf_TEST_ONLY]。\n\n第二段分析。\n\n```txt\nTEST_ONLY code\n```\n\n末段。', projection = projectMarkdown(source)
  const end = source.indexOf('\n\n```')
  const local = validateProseRange(projection, 0, end)
  assert.equal(local.blockIds.length, 2); assert.deepEqual(local.citationKeys, ['sf_TEST_ONLY'])
  assert.match(local.renderedText, /第二段分析/)
  assert.throws(() => validateRange(projection, 0, end), /单个普通段落/)
  assert.throws(() => validateProseRange(projection, source.indexOf('sf_TEST_ONLY') + 2, end), /引用/)
  assert.throws(() => validateProseRange(projection, 0, source.length), /表格、公式或代码/)
})

test('BOM remains in raw manuscript coordinates for CRLF headings and the second repeated Unicode paragraph', () => {
  const paragraph = 'TEST_ONLY 重复段落 😀。', source = `\uFEFF# TEST_ONLY\r\n\r\n${paragraph}\r\n\r\n${paragraph}\r\n`
  const projected = projectMarkdown(source), second = projected.blocks[1]
  assert.equal(second.start, source.lastIndexOf(paragraph))
  assert.equal(source.slice(second.start, second.end), paragraph)
  assert.equal(validateRange(projected, second.start, second.end, 'paragraph').renderedText, paragraph)
  const leaf = projected.leaves.find(row => row.blockId === second.id)!
  assert.equal(mapLeafPoint(projected, leaf.id, 0, 'start'), second.start)
  assert.equal(projected.tree.children![0].position!.start.offset, 1)
})

test('AT-11: repeated paragraphs have different AST block identities and source positions', () => {
  const source = '重复内容。\r\n\r\n重复内容。\r\n'
  const projected = projectMarkdown(source)
  assert.equal(projected.blocks.length, 2)
  assert.notEqual(projected.blocks[0].id, projected.blocks[1].id)
  const leaf = projected.leaves[1]
  const from = mapLeafPoint(projected, leaf.id, 0, 'start'), to = mapLeafPoint(projected, leaf.id, leaf.text.length, 'end')
  assert.equal(from, 9)
  assert.equal(source.slice(from, to), '重复内容。')
  const changed = source.slice(0, from) + '只改第二段。' + source.slice(to)
  assert.equal(changed, '重复内容。\r\n\r\n只改第二段。\r\n')
})

test('AT-12: escaping, entities, emphasis and link labels map rendered offsets to UTF-16 source', () => {
  const source = '原文 \\*标记 &amp; **粗体** [链接](https://example.test) 😀。'
  const projected = projectMarkdown(source)
  for (const text of ['原文 *标记 & ', '粗体', '链接', ' 😀。']) {
    const leaf = projected.leaves.find(leaf => leaf.text === text)!
    assert.ok(leaf?.mappable)
    const from = mapLeafPoint(projected, leaf.id, 0, 'start'), to = mapLeafPoint(projected, leaf.id, text.length, 'end')
    assert.equal(validateRange(projected, from, to).renderedText, text)
  }
  const first = projected.leaves[0]
  const asterisk = first.text.indexOf('*')
  const from = mapLeafPoint(projected, first.id, asterisk, 'start'), to = mapLeafPoint(projected, first.id, asterisk + 1, 'end')
  assert.equal(source.slice(from, to), '\\*')
  const amp = first.text.indexOf('&')
  assert.equal(source.slice(mapLeafPoint(projected, first.id, amp, 'start'), mapLeafPoint(projected, first.id, amp + 1, 'end')), '&amp;')
})

test('AT-12: complex cross-node selections are rejected without silent expansion', () => {
  const source = '前文 **粗体文本** 后文。\n\n另一个段落。'
  const projected = projectMarkdown(source)
  assert.throws(() => validateRange(projected, 0, source.indexOf('体') + 1), { code: 'SELECTION_UNSUPPORTED' })
  assert.throws(() => validateRange(projected, 0, source.length), { code: 'SELECTION_UNSUPPORTED' })
  const block = projected.blocks[0]
  assert.equal(validateRange(projected, block.start, block.end, 'paragraph').renderedText, '前文 粗体文本 后文。')
})

test('AT-12: citations map stable tokens to whole rendered numbers and cannot be split', () => {
  const source = '第一处 [@sf_alpha]，第二处 [@sf_beta; @sf_alpha]。'
  const projected = projectMarkdown(source)
  assert.deepEqual(projected.citationOrder, ['sf_alpha', 'sf_beta'])
  const leaf = projected.leaves.find(leaf => leaf.citationKeys?.length === 2)!
  assert.equal(leaf.text, '[2, 1]')
  assert.equal(source.slice(mapLeafPoint(projected, leaf.id, 0, 'start'), mapLeafPoint(projected, leaf.id, leaf.text.length, 'end')), '[@sf_beta; @sf_alpha]')
  assert.throws(() => mapLeafPoint(projected, leaf.id, 1, 'start'), { code: 'SELECTION_UNSUPPORTED' })
  assert.throws(() => validateRange(projected, leaf.start + 1, leaf.end), { code: 'SELECTION_INVALID' })
  assert.deepEqual(citationKeys('`[@sf_code]` $[@sf_math]$ \\[@sf_escaped] [@sf_real]\n\n```txt\n[@sf_fenced]\n```'), ['sf_real'])
})

test('surrogate pairs and CRLF are never cut, including entity-decoded emoji', () => {
  const projected = projectMarkdown('文字 😀 &#x1F600;\r\n续行。')
  const leaf = projected.leaves[0]
  const emoji = leaf.text.indexOf('😀')
  assert.throws(() => mapLeafPoint(projected, leaf.id, emoji + 1, 'start'), { code: 'SELECTION_UNSUPPORTED' })
  assert.equal(unicodeBoundary(projected.source, projected.source.indexOf('😀') + 1), false)
  assert.equal(unicodeBoundary(projected.source, projected.source.indexOf('\r') + 1), false)
  assert.equal(leaf.mappable, true)
})

test('formula, inline code, HTML, images and tables do not masquerade as prose selection', () => {
  for (const source of ['前文 `code` 后文。', '前文 $x=1$ 后文。', '前文 ![图](https://example.test/img) 后文。', '前文 <script>alert(1)</script> 后文。']) {
    const projected = projectMarkdown(source), block = projected.blocks[0]
    assert.throws(() => validateRange(projected, block.start, block.end, 'paragraph'), { code: 'SELECTION_UNSUPPORTED' })
  }
  const table = projectMarkdown('| a | b |\n| - | - |\n| 内容 | 结果 |')
  assert.throws(() => validateRange(table, table.source.indexOf('内容'), table.source.indexOf('内容') + 2), { code: 'SELECTION_UNSUPPORTED' })
})

test('server rejects forged source, rendered text and block identities', () => {
  const source = 'TEST_ONLY 原文。', projection = projectMarkdown(source), block = projection.blocks[0]
  const selection = { projectId: 'p', documentId: 'paper', documentHash: 'sha256:' + '0'.repeat(64), revisionId: 'rev', blockIds: [block.id],
    sourceRange: { startUtf16: 0, endUtf16: source.length }, sourceText: source, renderedText: source, prefixContext: '', suffixContext: '', citationKeys: [], claimIds: [], scope: 'inline' as const, capturedAt: new Date().toISOString() }
  validateSelection(source, selection)
  assert.throws(() => validateSelection(source, { ...selection, renderedText: '伪造显示内容' }), { code: 'SELECTION_INVALID' })
  assert.throws(() => validateSelection(source, { ...selection, blockIds: ['another'] }), { code: 'SELECTION_INVALID' })
})

test('AT-28: explained counting policy excludes citations, references, code and math', () => {
  const result = wordStats('# 标题\n\n中文研究 test-case 20% [@sf_one]。\n\n`hidden` $中文$\n\n```text\n假字 hidden\n```\n\n## 参考文献\n\n不计入 references\n\n## 附加正文\n\n继续。')
  assert.equal(result.chineseCharacters, 12)
  assert.equal(result.westernWords, 2)
  assert.equal(result.countingPolicyId, 'sf-body-han-western-v1')
})
