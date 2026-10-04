import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { parseMaterialBytes } from '../../src/host/parsers/parse.ts'
import { inspectDocxZip } from '../../src/host/parsers/zip-limits.ts'
import { docxFixture, pdfFixture } from '../fixtures/documents.ts'
const signal = () => new AbortController().signal
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

test('AT-05: UTF-8 text preserves original lines, Unicode and explicit coverage', async () => {
  const bytes = new TextEncoder().encode('TEST_ONLY 原文 😀\r\n\r\n限定范围：课堂小样本。\r\n')
  const result = await parseMaterialBytes(bytes, 'text/markdown', signal())
  assert.equal(result.coverage, 'complete')
  assert.deepEqual(result.blocks.map(block => block.locator), [{ kind: 'text', lineStart: 1, lineEnd: 1 }, { kind: 'text', lineStart: 3, lineEnd: 3 }])
  assert.equal(result.blocks[0].text, 'TEST_ONLY 原文 😀')
  const range = await parseMaterialBytes(bytes, 'text/plain', signal(), { kind: 'paragraphs', from: 3, to: 3 })
  assert.equal(range.coverage, 'partial'); assert.equal(range.blocks.length, 1)
})

test('AT-05: text PDFs return physical page locators', async () => {
  const parsed = await parseMaterialBytes(pdfFixture('TEST_ONLY actual PDF text'), 'application/pdf', signal())
  assert.equal(parsed.coverage, 'complete')
  assert.equal(parsed.blocks[0].text, 'TEST_ONLY actual PDF text')
  assert.deepEqual(parsed.blocks[0].locator, { kind: 'pdf', pageNumber: 1 })
})

test('AT-06: a PDF without a text layer is explicitly incomplete, never OCR success', async () => {
  const parsed = await parseMaterialBytes(pdfFixture(), 'application/pdf', signal())
  assert.equal(parsed.coverage, 'partial'); assert.equal(parsed.blocks.length, 0)
  assert.ok(parsed.warnings.some(warning => warning.includes('未执行 OCR')))
})

test('AT-05: DOCX keeps actual paragraph order including empty paragraphs and repeated text', async () => {
  const parsed = await parseMaterialBytes(await docxFixture(['TEST_ONLY 重复原文', '', 'TEST_ONLY 重复原文', '第四段 😀']), docxType, signal())
  assert.equal(parsed.coverage, 'complete')
  assert.deepEqual(parsed.blocks.map(block => block.locator), [1, 3, 4].map(paragraphIndex => ({ kind: 'docx', paragraphIndex, paragraphId: `paragraph_${paragraphIndex}` })))
  assert.equal(parsed.blocks[2].text, '第四段 😀')
})

test('DOCX external entities and decompression bombs fail closed', async () => {
  const entity = await docxFixture(['TEST_ONLY'], '<!DOCTYPE x [<!ENTITY steal SYSTEM "file:///TEST_ONLY-secret">]>')
  await assert.rejects(parseMaterialBytes(entity, docxType, signal()), { code: 'DOCX_XML_UNSAFE' })
  const zip = new JSZip(); zip.file('word/document.xml', 'a'.repeat(1000000))
  const bomb = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  assert.throws(() => inspectDocxZip(bomb), { code: 'DOCX_CONTAINER_LIMIT' })
})

test('unsupported formats, invalid encoding and cancellation never return fabricated text', async () => {
  assert.equal((await parseMaterialBytes(new Uint8Array([1, 2]), 'application/octet-stream', signal())).blocks.length, 0)
  await assert.rejects(parseMaterialBytes(new Uint8Array([255, 255]), 'text/plain', signal()), { code: 'MATERIAL_PARSE_FAILED' })
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(parseMaterialBytes(new Uint8Array(), 'text/plain', cancelled.signal))
})
