import test from 'node:test'
import assert from 'node:assert/strict'
import { lengthRepairTargets } from '../../src/core/pipeline/length-repair.ts'

test('a small whole-draft shortage is repaired in one section instead of repeatedly rewriting all nine', () => {
  const sections = Array.from({ length: 9 }, (_, index) => ({ id: 'section_' + index, count: index === 5 ? 300 : 120 }))
  const targets = lengthRepairTargets(1500, 1340, sections)
  assert.deepEqual([...targets], [['section_5', 460]])
  assert.equal(1340 - sections[5].count + targets.get('section_5')!, 1500)
  assert.equal(lengthRepairTargets(1500, 1490, sections).size, 0)
})
test('large reductions preserve unmodified headings and count other prose outside section bodies', () => {
  const sections = [{ id: 'a', count: 900 }, { id: 'b', count: 1100 }]
  const targets = lengthRepairTargets(1500, 2100, sections)
  assert.equal([...targets.values()].reduce((sum, count) => sum + count, 100), 1500)
  assert.ok(targets.get('b')! > targets.get('a')!)
})
