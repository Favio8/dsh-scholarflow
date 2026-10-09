import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftingOrder } from '../../src/core/pipeline/writing-task.ts'
import type { WritingTask } from '../../src/shared/writing-task.ts'

// The document keeps front matter at the top; the drafting order does not. A summary can
// only summarise text that already exists, so the body is written first.

type Section = WritingTask['spec']['sections'][number]
const section = (id: string, kind?: Section['kind']): Section => ({ id, title: id, purpose: '', targetLength: 500,
  allocationMode: 'auto', kind: kind ?? 'body' })

test('a paper with only body sections keeps its document order', () => {
  const sections = [section('a'), section('b'), section('c')]
  assert.deepEqual(draftingOrder(sections).map(row => row.id), ['a', 'b', 'c'])
  assert.equal(draftingOrder(sections), sections, '没有前置后置部分时不必复制数组')
})

test('front and back matter move to the end without changing their own order', () => {
  const sections = [section('abstract', 'front'), section('keywords', 'front'), section('intro'),
    section('argument'), section('acknowledgements', 'back'), section('appendix', 'back')]
  assert.deepEqual(draftingOrder(sections).map(row => row.id),
    ['intro', 'argument', 'abstract', 'keywords', 'acknowledgements', 'appendix'])
})

test('a section stored without a kind is body, which is what every task written earlier says', () => {
  // Stored data written before the field existed arrives without it after parsing.
  const legacy = { ...section('intro'), kind: undefined } as unknown as Section
  const sections = [section('abstract', 'front'), legacy]
  assert.deepEqual(draftingOrder(sections).map(row => row.id), ['intro', 'abstract'])
})

test('subsections stay next to their chapter', () => {
  const sections = [section('abstract', 'front'), section('intro'), section('argument'),
    { ...section('claim'), parentId: 'argument' }, section('conclusion'), section('acknowledgements', 'back')]
  assert.deepEqual(draftingOrder(sections).map(row => row.id),
    ['intro', 'argument', 'claim', 'conclusion', 'abstract', 'acknowledgements'])
})

test('the order is stable across calls, so a resumed task does not rewind', () => {
  const sections = [section('abstract', 'front'), section('intro'), section('conclusion')]
  assert.deepEqual(draftingOrder(sections).map(row => row.id), draftingOrder(sections).map(row => row.id))
})
