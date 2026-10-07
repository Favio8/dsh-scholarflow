// TEST_ONLY narrowing helpers for a generation run result. `executeGeneration` answers with one
// of several terminal shapes and a test asserts on exactly one of them, so read the member the
// assertion is about instead of a field that only some shapes carry.
import assert from 'node:assert/strict'
import type { executeGeneration } from '../../src/core/pipeline/generation.ts'

export type GenerationResult = Awaited<ReturnType<typeof executeGeneration>>

export function proposalOf(result: GenerationResult) {
  const proposal = 'proposal' in result ? result.proposal : undefined
  assert.ok(proposal, 'TEST_ONLY expected a persisted proposal')
  return proposal
}

export function proposalHashOf(result: GenerationResult) {
  const hash = 'proposalHash' in result ? result.proposalHash : undefined
  assert.ok(hash, 'TEST_ONLY expected a persisted proposal hash')
  return hash
}

export function revisionOf(result: GenerationResult) {
  const revision = 'revision' in result ? result.revision : undefined
  assert.ok(revision !== undefined, 'TEST_ONLY expected the revision the proposal was built from')
  return revision
}
