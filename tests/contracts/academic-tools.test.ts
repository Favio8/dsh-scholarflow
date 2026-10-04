import { test } from 'node:test'
import assert from 'node:assert/strict'
import { academicDefinitions } from '../../src/host/tools/academic.ts'

test('academic tools reject caller-selected project scopes and self-approval before accessing Host files', async () => {
  const definitions = academicDefinitions({})
  for (const definition of definitions) {
    const action = (definition.parameters as any).properties.action.enum[0]
    for (const injected of [{ workspaceId: 'workspace_TEST_ONLY_other' }, { sessionId: 'session_TEST_ONLY_other' }, { root: 'C:/' }, { confirmed: true }]) {
      const result = await definition.execute({ action, ...injected }, { signal: new AbortController().signal } as any) as any
      assert.equal(result.ok, false, definition.name)
      assert.equal(result.error.code, 'INVALID_REQUEST', definition.name)
    }
  }
})

test('academic tools require a real executing Agent and reject acceptance, installation and arbitrary writes', async () => {
  for (const definition of academicDefinitions({})) {
    const action = (definition.parameters as any).properties.action.enum[0]
    const noAgent = await definition.execute({ action }, { signal: new AbortController().signal } as any) as any
    assert.equal(noAgent.error.code, 'SESSION_BINDING_CHANGED', definition.name)
    for (const forbidden of ['accept', 'initialize', 'write', 'install', 'publish']) {
      await assert.rejects(() => definition.execute({ action: forbidden }, { signal: new AbortController().signal } as any),
        { code: 'INVALID_ARGS' }, `${definition.name}/${forbidden}`)
    }
  }
})
