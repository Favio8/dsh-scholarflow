import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../../dist/host.js'

test('editable settings are volatile and own only ScholarFlow configuration', () => {
  const schema = Config
  assert.deepEqual(Object.keys(schema.dict).sort(), ['defaultProjectType', 'language', 'maxModelCalls', 'networkEnabled'])
  for (const field of Object.values(schema.dict)) assert.equal((field as any).meta.volatile, true)
})
