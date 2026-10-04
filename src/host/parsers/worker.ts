import { parentPort, workerData } from 'node:worker_threads'
import { Readable } from 'node:stream'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { z } from 'zod'
import { parseRange, PARSER_VERSION, type ParsedBody } from '../../shared/materials.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { inspectDocxZip } from './zip-limits.ts'

const inputSchema = z.object({ bytes: z.instanceof(Uint8Array), mediaType: z.string(), range: parseRange.optional() }).strict()
const MAX_TEXT = 4 * 1024 * 1024
const MAX_BLOCKS = 10000

async function parse(): Promise<ParsedBody> {
  const { bytes, mediaType, range } = inputSchema.parse(workerData)
  const blocks: ParsedBody['blocks'] = []
  const warnings: string[] = []
  let textBytes = 0
  const add = (block: ParsedBody['blocks'][number]) => {
    textBytes += Buffer.byteLength(block.text)
    invariant(block.text.length <= 64000 && blocks.length < MAX_BLOCKS && textBytes <= MAX_TEXT, 'PARSE_CONTENT_LIMIT', '解析文本超过限额，请缩小解析范围。')
    blocks.push(block)
  }
  if (mediaType === 'text/plain' || mediaType === 'text/markdown') {
    invariant(!range || range.kind === 'paragraphs', 'INVALID_PARSE_RANGE', '文本按行解析；请选择段落范围。')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    invariant(!text.includes('\0'), 'UNSUPPORTED_TEXT_ENCODING', '资料包含二进制内容，不能按 UTF-8 文本读取。')
    const lines = text.split(/\r\n|\n|\r/)
    const from = range?.from ?? 1, to = Math.min(range?.to ?? lines.length, lines.length)
    invariant(from <= Math.max(lines.length, 1), 'INVALID_PARSE_RANGE', '解析范围超出资料。')
    for (let line = from; line <= to; line++) if (lines[line - 1].trim()) add({ text: lines[line - 1], kind: 'paragraph', locator: { kind: 'text', lineStart: line, lineEnd: line } })
    return { parser: { id: 'utf8-line-text', version: PARSER_VERSION }, blocks, coverage: from === 1 && to === lines.length ? 'complete' : 'partial',
      warnings: ['文本定位使用原文件的 1-based 行号；Markdown 保留原始标记，每行视作一个解析单元。'], unprocessedContent: [], ranges: to >= from ? [{ kind: 'paragraphs', from, to }] : [] }
  }
  if (mediaType === 'application/pdf') {
    invariant(!range || range.kind === 'pages', 'INVALID_PARSE_RANGE', 'PDF 使用物理页码范围。')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: bytes, enableXfa: false, useWasm: false, useSystemFonts: false, useWorkerFetch: false,
      disableAutoFetch: true, disableStream: true, isOffscreenCanvasSupported: false, stopAtErrors: true })
    try {
      const document = await task.promise
      invariant(document.numPages <= 2000, 'PARSE_PAGE_LIMIT', 'PDF 页数超过 2000 页，请拆分资料。')
      const from = range?.from ?? 1, to = Math.min(range?.to ?? 20, document.numPages)
      invariant(from <= to, 'INVALID_PARSE_RANGE', '解析范围超出 PDF 页数。')
      let empty = 0
      for (let pageNumber = from; pageNumber <= to; pageNumber++) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent({ disableNormalization: true })
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
        if (text) add({ text, kind: 'paragraph', locator: { kind: 'pdf', pageNumber } }); else empty++
        page.cleanup()
      }
      warnings.push('PDF 只提取文字层；图像、公式及表格结构未核验。物理页码从 1 开始。')
      if (empty) warnings.push(`${empty} 页没有可提取文字，可能是扫描页；本插件未执行 OCR。`)
      return { parser: { id: 'pdfjs-text', version: `pdfjs-${pdfjs.version}/${PARSER_VERSION}` }, blocks,
        coverage: from === 1 && to === document.numPages && !empty ? 'complete' : 'partial', warnings,
        unprocessedContent: ['images', 'formulas', 'tables', ...(from > 1 || to < document.numPages ? ['pages' as const] : [])], ranges: [{ kind: 'pages', from, to }] }
    } finally { await task.destroy() }
  }
  if (mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    invariant(!range || range.kind === 'paragraphs', 'INVALID_PARSE_RANGE', 'DOCX 使用段落序号范围。')
    const entries = inspectDocxZip(bytes)
    const zip = await JSZip.loadAsync(bytes)
    for (const entry of entries.filter(entry => /\.(xml|rels)$/i.test(entry.name))) {
      const file = zip.file(entry.name)
      invariant(file, 'DOCX_INVALID_CONTAINER', 'DOCX XML 条目缺失。')
      // Bound the ACTUAL decompressed stream, not only the declared ZIP length.
      const chunks: Uint8Array[] = []
      let size = 0
      const stream = new Readable().wrap(file.nodeStream('nodebuffer'))
      for await (const chunk of stream) {
        size += chunk.length
        if (size > entry.size || size > 10 * 1024 * 1024) { stream.destroy(); throw new ScholarError('DOCX_CONTAINER_LIMIT', 'DOCX 实际解压体积超过限额。') }
        chunks.push(chunk)
      }
      const xml = Buffer.concat(chunks).toString('utf-8')
      invariant(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'DOCX_XML_UNSAFE', 'DOCX 禁止外部实体或自定义 DTD。')
      invariant((xml.match(/</g)?.length ?? 0) <= 200000, 'DOCX_XML_LIMIT', 'DOCX XML 节点超过限额。')
    }
    let paragraphIndex = 0
    const collectText = (node: any): string => node.type === 'text' ? node.value : node.type === 'tab' ? '\t' : node.type === 'break' ? '\n' : (node.children ?? []).map(collectText).join('')
    const visit = (node: any): any => {
      if (node.type === 'paragraph') {
        paragraphIndex++
        if (paragraphIndex >= (range?.from ?? 1) && paragraphIndex <= (range?.to ?? 10000)) {
          const text = collectText(node)
          if (text.trim()) add({ text, kind: 'paragraph', locator: { kind: 'docx', paragraphIndex, paragraphId: `paragraph_${paragraphIndex}` } })
        }
      } else for (const child of node.children ?? []) visit(child)
      return node
    }
    await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, { externalFileAccess: false, includeEmbeddedStyleMap: false, ignoreEmptyParagraphs: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })), transformDocument: visit })
    const from = range?.from ?? 1, to = Math.min(range?.to ?? paragraphIndex, paragraphIndex)
    invariant(from <= Math.max(paragraphIndex, 1), 'INVALID_PARSE_RANGE', '解析范围超出 DOCX 段落数。')
    warnings.push('DOCX 定位使用主文档段落序号，不生成页码；图片、公式、脚注及表格结构未核验。')
    return { parser: { id: 'mammoth-paragraph', version: `mammoth-1.13.0/${PARSER_VERSION}` }, blocks,
      coverage: from === 1 && to === paragraphIndex ? 'complete' : 'partial', warnings, unprocessedContent: ['images', 'formulas', 'tables'], ranges: to >= from ? [{ kind: 'paragraphs', from, to }] : [] }
  }
  return { parser: { id: 'unsupported', version: PARSER_VERSION }, blocks: [], coverage: 'partial', warnings: ['当前版本不支持该资料格式；附件保持原样，未宣称已读取全文。'], unprocessedContent: [], ranges: [] }
}

parse().then(data => parentPort?.postMessage({ ok: true, data }), error => parentPort?.postMessage({ ok: false,
  code: error instanceof ScholarError ? error.code : 'MATERIAL_PARSE_FAILED', message: error instanceof ScholarError ? error.message : '资料解析失败；未修改原始资料。' }))
