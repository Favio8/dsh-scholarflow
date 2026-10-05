import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { projectMarkdown, validateRange } from '../../src/core/editing/markdown.ts'
import { selectionContext } from '../../src/core/editing/selection-context.ts'

async function setup(paragraph = 'TEST_ONLY **重复限定** &amp; 𐐀。') {
  const io = new MemoryStore({ 'unselected-secret.txt': 'TEST_ONLY do not read unrelated materials' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY 上下文选区', type: 'course-paper' }))
  const first = await snapshot(io), text = `\uFEFF# TEST_ONLY\r\n\r\n${paragraph}\r\n\r\n${paragraph}\r\n`
  await saveManual(io, text, first.document.contentHash, first.ledger.revision)
  const current = await snapshot(io), projected = projectMarkdown(text), block = projected.blocks[1], range = validateRange(projected, block.start, block.end, 'paragraph')
  return { io, current, selection: { projectId: current.ledger.projectId, documentId: 'paper', documentHash: current.document.contentHash, revisionId: current.document.revisionId,
    blockIds: [block.id], sourceRange: { startUtf16: block.start, endUtf16: block.end }, sourceText: text.slice(block.start, block.end), renderedText: range.renderedText,
    prefixContext: 'TEST_ONLY forged credential context must be ignored', suffixContext: 'TEST_ONLY unrelated data must be ignored', citationKeys: range.citationKeys,
    claimIds: [], scope: 'paragraph', capturedAt: new Date().toISOString() } }
}
test('SF-015: readonly context captures exact second BOM/CRLF/Unicode paragraph and rebuilds adjacent context without reading unselected materials or changing facts', async () => {
  const { io, current, selection } = await setup(), before = [...io.files.entries()], reads: string[] = []
  const read = io.read.bind(io); io.read = async path => { reads.push(path); return read(path) }
  const result = await selectionContext(io, selection)
  assert.equal(result.sourceRange.startUtf16, current.document.text.lastIndexOf(selection.sourceText))
  assert.equal(result.sourceText, selection.sourceText); assert.equal(result.renderedText, 'TEST_ONLY 重复限定 & 𐐀。')
  assert.equal(result.documentHash, current.document.contentHash); assert.equal(result.revisionId, current.document.revisionId)
  assert.equal(result.documentPath, 'manuscript/paper.md'); assert.deepEqual(result.chapterPath, ['TEST_ONLY'])
  assert.equal(result.selectedCharacters, [...result.renderedText].length)
  assert.doesNotMatch(result.prefixContext + result.suffixContext, /forged credential|unrelated data/u)
  assert.equal(reads.includes('unselected-secret.txt'), false); assert.deepEqual([...io.files.entries()], before)
})
test('cross-project, forged-render, guessed position, foreign claim and external-change contexts never authorize a stale or unrelated snapshot', async () => {
  const { io, current, selection } = await setup()
  await assert.rejects(selectionContext(io, { ...selection, projectId: 'prj_TEST_ONLY_FOREIGN' }), { code: 'STALE_DOCUMENT_VERSION' })
  await assert.rejects(selectionContext(io, { ...selection, renderedText: 'TEST_ONLY invented text' }), { code: 'SELECTION_INVALID' })
  await assert.rejects(selectionContext(io, { ...selection, blockIds: ['p_TEST_ONLY_guessed'] }), { code: 'SELECTION_INVALID' })
  await assert.rejects(selectionContext(io, { ...selection, claimIds: ['claim_TEST_ONLY_FOREIGN'] }), { code: 'SELECTION_CONTEXT_INVALID' })
  io.externalEdit('manuscript/paper.md', current.document.text + 'TEST_ONLY later user edit\r\n')
  const before = [...io.files.entries()]
  await assert.rejects(selectionContext(io, selection), { code: 'STALE_DOCUMENT_VERSION' }); assert.deepEqual([...io.files.entries()], before)
})
test('oversized selected context is refused without clipping Unicode or silently substituting a smaller range', async () => {
  const { io, selection } = await setup('TEST_ONLY ' + '中文'.repeat(10000)), before = [...io.files.entries()]
  await assert.rejects(selectionContext(io, selection), { code: 'SELECTION_CONTEXT_INVALID' })
  assert.deepEqual([...io.files.entries()], before)
})
