import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelReviewKeys, modelReviewOutputSchema } from '../../src/shared/review.ts'
import { MODEL_REVIEW_SYSTEM, CROSS_SECTION_REVIEW_SYSTEM } from '../../src/core/review/model.ts'

// SF-186 regression. The prompts used to spell the recheck key as 「旧 issueId」 while the schema
// spelled it issueId; the model returned `oldIssueId` and `.strict()` discarded two complete runs.
// The prompts are now interpolated from the schema, so the failure cannot return by retyping a
// field list — and this test is the backstop if someone reintroduces a hand-written one.

test('every key the prompts name is a real key, and every real key is named', () => {
  for (const prompt of [MODEL_REVIEW_SYSTEM, CROSS_SECTION_REVIEW_SYSTEM]) {
    for (const group of ['check', 'finding', 'recheck'] as const) {
      for (const key of modelReviewKeys[group]) {
        assert.ok(prompt.includes(key), `prompt never spells the ${group} key "${key}"`)
      }
    }
  }
})

test('the recheck key is named issueId, and oldIssueId is called out as wrong', () => {
  assert.ok(modelReviewKeys.recheck.includes('issueId'))
  for (const prompt of [MODEL_REVIEW_SYSTEM, CROSS_SECTION_REVIEW_SYSTEM])
    assert.match(prompt, /不是 oldIssueId/, 'the prompt must name the wrong spelling it keeps getting')
})

test('a non-empty rechecks example exists in both prompts, since an empty one teaches no key names', () => {
  for (const prompt of [MODEL_REVIEW_SYSTEM, CROSS_SECTION_REVIEW_SYSTEM]) {
    assert.doesNotMatch(prompt, /"rechecks":\[\]/, 'an empty rechecks example gives the model nothing to copy')
    assert.match(prompt, /"rechecks":\[\{/)
  }
})

test('every key the JSON examples use is a real key, and invent none', () => {
  const allowed = new Set(['checks', 'findings', 'rechecks', 'limitations', ...Object.values(modelReviewKeys).flat()])
  for (const prompt of [MODEL_REVIEW_SYSTEM, CROSS_SECTION_REVIEW_SYSTEM]) {
    // Only the examples are scanned. Prose deliberately names oldIssueId in order to forbid it, and
    // a regex over the prose cannot tell a claimed key from a rejected one — it flagged its own
    // warning. The examples are what the model actually copies.
    const exampleKeys = new Set([...prompt.matchAll(/"([A-Za-z][A-Za-z0-9]*)":/g)].map(match => match[1]))
    assert.ok(exampleKeys.size > 0, 'the prompt carries no JSON example to scan')
    for (const name of exampleKeys) assert.ok(allowed.has(name), `the JSON example uses "${name}", which is not a schema key`)
  }
})

test('the strict schema still rejects the failure that actually happened', () => {
  const base = {
    checks: [{ id: 'argument_assessment', status: 'unknown', detail: '至少十个字符的实际依据说明' },
      { id: 'style_assessment', status: 'unknown', detail: '至少十个字符的实际依据说明' }],
    findings: [], rechecks: [], limitations: [],
  }
  assert.ok(modelReviewOutputSchema.safeParse(base).success)
  const wrong = { ...base, rechecks: [{ oldIssueId: 'iss_a', status: 'unknown', reason: '至少十个字符的实际依据说明', blockId: 'blk_a', quote: 'q' }] }
  const rejected = modelReviewOutputSchema.safeParse(wrong)
  assert.equal(rejected.success, false)
  assert.ok(rejected.error.issues.some(issue => issue.code === 'unrecognized_keys'),
    'the repair prompt keys off unrecognized_keys, so this failure mode has to stay that code')
})
