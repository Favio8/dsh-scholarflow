import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdownDestinations, relocateMarkdownResources, projectRelativeUrl } from '../../src/core/editing/markdown-resources.ts'
import { citationMarkers, projectMarkdown, validateRange } from '../../src/core/editing/markdown.ts'

test('AST destination offsets rewrite only URLs, preserve labels/titles/CRLF and resolve paths from the original manuscript', () => {
  const text = '\uFEFF# TEST_ONLY\r\n\r\n[./notes.md](./notes.md "./notes.md title") ![图](<fig/chart(中文).png>)\r\n\r\n[图标]: <./fig/logo.png> "TEST_ONLY title"\r\n\r\n![图][图标]\r\n'
  const result = relocateMarkdownResources(text, 'old/稿件.md', 'manuscript/paper.md')
  assert.equal(result.changes.length, 3)
  assert.ok(result.text.includes('[./notes.md](../old/notes.md "./notes.md title")'))
  assert.ok(result.text.includes('[图标]: <../old/fig/logo.png> "TEST_ONLY title"'))
  assert.ok(result.text.includes('![图][图标]'))
  assert.ok(result.text.startsWith('\uFEFF')); assert.equal(result.text.split('\r\n').length, text.split('\r\n').length)
  for (const row of result.changes) assert.equal(text.slice(row.startUtf16, row.endUtf16), row.raw)
  assert.equal(markdownDestinations(result.text)[1].url, '../old/fig/chart%28%E4%B8%AD%E6%96%87%29.png')
})
test('nested URL parentheses, escaped space and query/fragment survive relocation; remote and anchor URLs remain unchanged', () => {
  const text = 'TEST_ONLY [nested](fig/a(b(c)).png?version=1#图) [space](<fig/file name.png>) <https://example.com/a> <test@example.com> [anchor](#section)\n\n```md\n[TEST_ONLY code](./do-not-touch.md)\n```\n'
  const result = relocateMarkdownResources(text, 'old/paper.md', 'out/paper.md')
  assert.ok(result.text.includes('../old/fig/a%28b%28c%29%29.png?version=1#图'))
  assert.ok(result.text.includes('../old/fig/file%20name.png'))
  assert.ok(result.text.includes('<https://example.com/a> <test@example.com> [anchor](#section)'))
  assert.ok(result.text.includes('[TEST_ONLY code](./do-not-touch.md)'))
})
test('resource path aliases, sensitive files, encoded traversal and dangerous schemes never produce a rewritten draft', () => {
  assert.equal(projectRelativeUrl('old/paper.md', 'out/paper.md', '../out/').url, './')
  assert.equal(projectRelativeUrl('old/paper.md', 'out/paper.md', '../').url, '../')
  for (const url of ['../../outside.png', '%2Fabsolute.png', '../.scholarflow/data/ledger.json', '../.SCHOLARFLOW', '../.SCHOLARFLOW/data/source.md', '../.credentials.yaml', 'file:///C:/private.md', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'C:/private.md', '//remote/file', 'fig%ZZ.png', '%5Coutside.png'])
    assert.throws(() => projectRelativeUrl('old/paper.md', 'out/paper.md', url))
})
test('legacy markers are explicit unverified candidates; code/math/escaped brackets are excluded and partial markers cannot be selected', () => {
  const text = 'TEST_ONLY [@smith; @sf_TEST_ONLY] [1, 2] \\[@escaped] `[@code]` $[3]$\n'
  const markers = citationMarkers(text)
  assert.equal(markers.length, 2); assert.deepEqual(markers[0].keys, ['smith', 'sf_TEST_ONLY']); assert.equal(markers[1].kind, 'numeric')
  const projection = projectMarkdown(text)
  assert.throws(() => validateRange(projection, markers[0].startUtf16 + 2, markers[0].endUtf16), { code: 'SELECTION_UNSUPPORTED' })
  assert.throws(() => validateRange(projection, markers[1].startUtf16, markers[1].endUtf16 - 1), { code: 'SELECTION_UNSUPPORTED' })
  assert.equal(validateRange(projection, markers[0].startUtf16, markers[0].endUtf16).renderedText, markers[0].text)
})
