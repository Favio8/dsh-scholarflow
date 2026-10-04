import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requirementCount } from '../../src/core/requirements/counting.ts'
import { requirementSchema, sourceSchema } from '../../src/shared/schema.ts'

const reference = (year?: number) => sourceSchema.parse({ id: `src_TEST_ONLY_${year ?? 'unknown'}`, kind: 'paper', title: 'TEST_ONLY', authors: [], year,
  identifiers: {}, citeKey: `sf_TEST_ONLY_${year ?? 'unknown'}`, provenance: [], identity: { status: 'unverified', method: 'none' }, textAccess: 'metadata' })
const requirement = (constraint: unknown, kind = 'references') => requirementSchema.parse({ id: 'req_TEST_ONLY', kind, description: 'TEST_ONLY', origin: { type: 'user' }, confirmation: 'confirmed', verificationMethod: 'deterministic', constraint })
test('recent ratio uses actual unique cited sources, inclusive bounds, and preserves unknown years', () => {
  const rule = requirement({ operator: 'ratio', value: 60, unit: 'percent', countingPolicyId: 'sf-cited-year-window-ratio-v1', windowStart: '2021', windowEnd: '2026' })
  const counted = requirementCount(rule, { chineseCharacters: 0, westernWords: 0 }, [reference(2021), reference(2026), reference(2020)])
  assert.equal(counted.actual, 2 / 3 * 100); assert.match(counted.detail, /分母为正文实际使用的 3/)
  assert.equal(requirementCount(rule, { chineseCharacters: 0, westernWords: 0 }, [reference(2021), reference()]).actual, undefined)
  assert.equal(requirementCount(rule, { chineseCharacters: 0, westernWords: 0 }, []).actual, undefined)
})
test('mixed body counting is explicit and distinct from Chinese-only or Western-only counting', () => {
  const count = { chineseCharacters: 20, westernWords: 5 }
  assert.equal(requirementCount(requirement({ operator: 'min', value: 25, unit: 'words', countingPolicyId: 'sf-body-han-plus-western-v1' }, 'length'), count, []).actual, 25)
  assert.equal(requirementCount(requirement({ operator: 'min', value: 20, unit: 'zh-characters', countingPolicyId: 'sf-body-han-western-v1' }, 'length'), count, []).actual, 20)
  assert.equal(requirementCount(requirement({ operator: 'min', value: 5, unit: 'words', countingPolicyId: 'sf-body-han-western-v1' }, 'length'), count, []).actual, 5)
})
