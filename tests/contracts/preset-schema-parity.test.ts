import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { presetDocument, presetSection, presetSubsection, supplementalKind } from '../../src/shared/presets.ts'

// The JSON Schema and the zod contract are two descriptions of one resource. Nothing in the
// build compares them, so a field added to one and forgotten in the other would only surface
// as a shipped preset failing to load. This test keeps the two in step without adding a
// schema-validation dependency.

const schema = JSON.parse(await readFile(fileURLToPath(new URL('../../presets/structures/presets.schema.json', import.meta.url)), 'utf8'))

const keys = (shape: Record<string, unknown>) => Object.keys(shape).sort()

test('the preset document contract names the same top-level fields in both places', () => {
  assert.deepEqual(keys(schema.properties), keys(presetDocument.shape),
    'presets.schema.json 与 presetDocument.shape 的顶层字段必须一致')
})

test('a chapter names the same fields in both places, subsections included', () => {
  assert.deepEqual(keys(schema.properties.sections.items.properties), keys(presetSection.shape),
    'sections.items 与 presetSection.shape 的字段必须一致')
  assert.deepEqual(keys(schema.$defs.presetSubsection.properties), keys(presetSubsection.shape),
    'presetSubsection 的字段必须一致')
  assert.equal(schema.properties.sections.items.properties.subsections.maxItems, 8)
  assert.equal(schema.properties.sections.maxItems, 40)
  assert.equal(schema.properties.sections.minItems, 1)
})

test('the supplemental kinds are the same set in both places', () => {
  assert.deepEqual([...schema.properties.supplementalParts.items.properties.kind.enum].sort(),
    [...supplementalKind.options].sort(), 'supplementalParts.kind 的枚举必须一致')
})

test('the schema still refuses unknown fields, as the strict zod object does', () => {
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.sections.items.additionalProperties, false)
  assert.equal(schema.$defs.presetSubsection.additionalProperties, false)
})
