import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { prepareDelivery, createDelivery, readDelivery } from '../../src/core/export/delivery.ts'
import { registerSource } from '../../src/core/evidence/evidence.ts'

// V5: the numbered citation style must be the same one in all three deliveries. Two
// sources cited in a deliberate order, so "numbered" means more than "present".

test('V5: Markdown, LaTeX and Word deliver the same numbered citation order', async () => {
  const io = new MemoryStore({})
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY citation order', type: 'course-paper' }))
  const first = await snapshot(io)
  const alpha = await registerSource(io, { kind: 'paper', title: 'TEST_ONLY 来源甲', authors: [{ literal: 'Doe, Jane' }], year: 2024, identifiers: {} }, first.ledger.revision)
  const second = await snapshot(io)
  const beta = await registerSource(io, { kind: 'paper', title: 'TEST_ONLY 来源乙', authors: [{ literal: 'Roe, Ravi' }], year: 2021, identifiers: {} }, second.ledger.revision)
  const third = await snapshot(io)
  // Cited in the reverse of their registration order, so the numbering is decided by use.
  await saveManual(io, `TEST_ONLY 正文先引 [@${beta.source.citeKey}]，再引 [@${alpha.source.citeKey}]。`, third.document.contentHash, third.ledger.revision)

  const deliveries: Record<string, Record<string, string>> = {}
  for (const format of ['markdown', 'latex', 'docx'] as const) {
    const plan = await prepareDelivery(io, format)
    const made = await createDelivery(io, plan, 'working-draft', (await snapshot(io)).ledger.revision)
    const read = await readDelivery(io, made.manifest.id)
    deliveries[format] = Object.fromEntries(read.files.map(file => [file.relativePath, file.text ?? file.base64]))
  }

  const keyA = alpha.source.citeKey, keyB = beta.source.citeKey
  assert.notEqual(keyA, keyB)

  // Markdown keeps the manuscript as the truth: machine keys, in the order written.
  const markdown = deliveries.markdown!['paper.md']!
  assert.ok(markdown.includes(keyB) && markdown.includes(keyA), 'Markdown 保留机器引用键')
  assert.ok(markdown.indexOf(keyB) < markdown.indexOf(keyA), 'Markdown 保持正文中的引用顺序')

  // LaTeX: unsorted bibliography style, real keys, and the bib in citation order.
  const tex = deliveries.latex!['paper.tex']!
  assert.match(tex, /\\bibliographystyle\{unsrt\}/, 'LaTeX 必须按引用顺序编号')
  assert.match(tex, /\\bibliography\{references\}/)
  assert.ok(tex.includes(`\\cite{${keyB},${keyA}}`) || (tex.includes(`\\cite{${keyB}}`) && tex.includes(`\\cite{${keyA}}`)), 'LaTeX 使用真实引用键')
  const bib = deliveries.latex!['references.bib']!
  assert.ok(bib.includes(keyB) && bib.includes(keyA), 'BibTeX 提供被引来源')
  assert.ok(bib.indexOf(keyB) < bib.indexOf(keyA), 'BibTeX 顺序与引用顺序一致')
  // The entry is written by this project, not by a formatter: a Chinese title must arrive
  // whole, with only the LaTeX specials escaped.
  assert.ok(bib.includes('TEST\\textunderscore{}ONLY 来源乙'), 'BibTeX 保留中文标题并转义下划线')
  assert.ok(bib.includes('TEST\\textunderscore{}ONLY 来源甲'), '两个来源都保留完整标题')
  assert.ok(!/\},[\s]*$/.test(bib.trim().slice(-2)), '标题不留尾随空格')


  // Word: real OOXML whose reference list is numbered in the same order as the citations.
  const docx = Buffer.from(deliveries.docx!['paper.docx']!, 'base64')
  assert.equal(docx.subarray(0, 2).toString('latin1'), 'PK', 'Word 交付是真实 OOXML 字节')
  const zip = await JSZip.loadAsync(docx)
  const xml = await zip.file('word/document.xml')!.async('string')
  assert.ok(xml.includes('[1]') && xml.includes('[2]'), 'Word 参考文献表使用编号')
  assert.ok(xml.indexOf('[1]') < xml.indexOf('[2]'), '编号按顺序出现')
  assert.ok(xml.indexOf('来源乙') < xml.indexOf('来源甲'), 'Word 编号顺序与引用顺序一致')

  // All three deliveries belong to one project revision and carry the same manuscript.
  assert.ok(deliveries.latex!['paper.md'] === markdown && deliveries.docx!['paper.md'] === markdown, '三种交付内含同一份正文')
})
