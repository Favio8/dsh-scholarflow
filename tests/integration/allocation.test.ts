import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocate, appendAutoSection, lockSection, releaseSection, MINIMUM_SECTION_LENGTH, type AllocationSection } from '../../src/core/presets/allocation.ts'

const auto = (id: string, weight = 1): AllocationSection => ({ id, targetLength: MINIMUM_SECTION_LENGTH, allocationMode: 'auto', allocationWeight: weight })
const manual = (id: string, targetLength: number): AllocationSection => ({ id, targetLength, allocationMode: 'manual' })
const lengths = (result: ReturnType<typeof allocate>) => result.sections.map(section => section.targetLength)

test('AT-39: two manual chapters plus two equal automatic ones add up to the target', () => {
  const result = allocate([manual('a', 800), manual('b', 1200), auto('c'), auto('d')], 4000)
  assert.deepEqual(lengths(result), [800, 1200, 1000, 1000])
  assert.equal(result.total, 4000)
  assert.equal(result.shortfall, 0)
  assert.equal(result.overage, 0)
  assert.deepEqual(result.notes, [], '刚好等于目标时不需要提示')
})

test('AT-39: lowering the target keeps the manual values and reports the difference', () => {
  const sections = [manual('a', 800), manual('b', 1200), auto('c'), auto('d')]
  const result = allocate(sections, 1500)
  assert.deepEqual(lengths(result), [800, 1200, 50, 50], '预算不足时不覆写任何已有数值')
  assert.equal(result.minimumShortfall, true)
  assert.equal(result.overage, 2100 - 1500, '差额按当前计划的实际合计报告，由用户决定怎么处理')
  assert.match(result.notes.join(' '), /至少 50 字/)
  assert.match(result.notes.join(' '), /提高到至少/)
})

test('a chapter below the minimum takes the floor and the rest are recomputed without it', () => {
  const result = allocate([auto('a'), auto('b'), auto('c'), auto('d', 97)], 200)
  assert.deepEqual(lengths(result), [50, 50, 50, 50])
  assert.equal(result.total, 200)
  assert.equal(result.minimumShortfall, false)
})

test('the rounding remainder is handed out so the total lands exactly on target', () => {
  const atFloor = allocate([auto('a'), auto('b'), auto('c')], 150)
  assert.deepEqual(lengths(atFloor), [50, 50, 50], '刚好够每章最低额度')
  assert.equal(atFloor.minimumShortfall, false)
  const rounded = allocate([auto('a'), auto('b'), auto('c')], 152)
  assert.deepEqual(lengths(rounded), [51, 51, 50], '余数按章节顺序补 1')
  assert.equal(rounded.total, 152)
  for (const target of [150, 199, 4000, 59999]) {
    const sized = allocate([auto('a'), auto('b'), auto('c')], target)
    assert.equal(sized.total, target, `目标 ${target} 必须精确合计`)
    assert.equal(sized.shortfall, 0)
    assert.equal(sized.overage, 0)
  }
})

test('a target too small for the minimum is refused rather than silently rewritten', () => {
  const result = allocate([auto('a'), auto('b'), auto('c')], 100)
  assert.deepEqual(lengths(result), [50, 50, 50], '三章至少需要 150 字，100 字时不做部分覆盖')
  assert.equal(result.minimumShortfall, true)
})

test('weights drive the split without adding a base to every chapter', () => {
  const result = allocate([auto('a'), auto('b', 3)], 4000)
  assert.deepEqual(lengths(result), [1000, 3000])
})

test('a counted abstract is reserved before the body is distributed', () => {
  const counted = allocate([manual('a', 800), auto('b')], 4000, { abstractLength: 200, includeAbstract: true })
  assert.equal(counted.total, 4000)
  assert.deepEqual(lengths(counted), [800, 3000])
  const excluded = allocate([manual('a', 800), auto('b')], 4000, { abstractLength: 200, includeAbstract: false })
  assert.deepEqual(lengths(excluded), [800, 3200], '摘要默认不占正文目标')
})

test('with no automatic chapter nothing is recalculated, only the difference is reported', () => {
  const result = allocate([manual('a', 800), manual('b', 1200)], 1500)
  assert.deepEqual(lengths(result), [800, 1200])
  assert.equal(result.overage, 500)
  assert.equal(result.shortfall, 0)
  assert.equal(result.minimumShortfall, false)

  const exact = allocate([manual('a', 4000)], 4000)
  assert.deepEqual(exact.notes, [])
})

test('editing a chapter locks only its number; titles and order leave it untouched', () => {
  const sections = [auto('a'), auto('b')]
  const locked = lockSection(sections, 'a', 900)
  assert.deepEqual(locked.map(section => [section.id, section.allocationMode, section.targetLength]), [['a', 'manual', 900], ['b', 'auto', 50]])
  const released = releaseSection(locked, 'a', 2)
  assert.deepEqual(released[1]!.allocationMode, 'auto')
  assert.equal(released[0]!.allocationWeight, 2)
})

test('a new chapter joins the automatic pool with the average weight of its peers', () => {
  const grown = appendAutoSection([auto('a', 1), auto('b', 3)], 'c', '新章节')
  assert.equal(grown.length, 3)
  assert.equal(grown[2]!.allocationMode, 'auto')
  assert.equal(grown[2]!.allocationWeight, 2, '取现有自动章节的平均权重')
  const first = appendAutoSection([manual('a', 500)], 'b', '新章节')
  assert.equal(first[1]!.allocationWeight, 1, '没有自动章节时权重为 1')
  const result = allocate(grown, 1200)
  assert.equal(result.total, 1200)
  assert.equal(result.shortfall, 0)
})

test('a target that cannot reach the minimum never produces a negative or partial rewrite', () => {
  const sections = [manual('a', 4000), auto('b'), auto('c')]
  const result = allocate(sections, 200)
  assert.ok(lengths(result).every(length => length >= MINIMUM_SECTION_LENGTH))
  assert.equal(result.minimumShortfall, true)
  assert.deepEqual(lengths(result), [4000, 50, 50])
})
