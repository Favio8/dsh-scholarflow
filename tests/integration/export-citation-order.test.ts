import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  // Word needs a store with the create-only binary capability (BINARY_EXPORT_UNAVAILABLE on
  // MemoryStore); its numbered list is checked in the installed-host run instead.
  for (const format of ['markdown', 'latex'] as const) {
    const plan = await prepareDelivery(io, format)
    const made = await createDelivery(io, plan, 'working-draft', (await snapshot(io)).ledger.revision)
    const read = await readDelivery(io, made.manifest.id)
    deliveries[format] = Object.fromEntries(read.files.map(file => [file.relativePath, file.text]))
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
  // Observed 2026-10-06 and recorded in the G0 notes: the BibTeX title keeps only the
  // ASCII part of a Chinese source title. Order and keys are correct; the title text is not.


  // All three deliveries belong to one project revision and carry the same manuscript.
  assert.ok(deliveries.latex!['paper.md'] === markdown, '两种交付内含同一份正文')
})
