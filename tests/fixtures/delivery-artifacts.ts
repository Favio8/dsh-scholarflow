// TEST_ONLY narrowing helpers for delivered artifacts. `readDelivery` returns a union of text and
// base64 entries, so a test that wants the text reads it through `textOf` rather than a field that
// only one member carries.
import assert from 'node:assert/strict'
import type { readDelivery } from '../../src/core/export/delivery.ts'

export type DeliveryArtifact = Awaited<ReturnType<typeof readDelivery>>['files'][number]

export function contentOf(file: DeliveryArtifact) {
  return 'text' in file ? file.text : file.base64
}

export function textOf(file: DeliveryArtifact | undefined) {
  assert.ok(file, 'TEST_ONLY expected a delivered artifact')
  const text = 'text' in file ? file.text : undefined
  assert.ok(text !== undefined, `TEST_ONLY expected ${file.relativePath} to be a text artifact`)
  return text
}

export function deliveredText(files: readonly DeliveryArtifact[], relativePath: string) {
  return textOf(files.find(row => row.relativePath === relativePath))
}
