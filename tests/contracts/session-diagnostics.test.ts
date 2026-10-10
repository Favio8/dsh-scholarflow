// TEST_ONLY SDK refusal contract; installed legacy-session probe is separate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applicationResult, resolveStore } from '../../src/host/bridge/project-api.ts'

test('an unsupported persisted Session remains a distinct sanitized refusal before any project filesystem IO', async () => {
  const refusal = new Error('TEST_ONLY unknown plugin event (raw log: C:/TEST_ONLY_PRIVATE/session.jsonl.zstd)')
  refusal.name = 'SessionFormatUnsupportedError'
  const ctx = { workspaceRegistry: { get: () => ({ id: 'workspace_TEST_ONLY' }) },
    sessionController: { inspect: async () => { throw refusal } },
    fs: { resolve: async () => { throw new Error('TEST_ONLY must not access files through a refused Session') } } }
  const result = await applicationResult(() => resolveStore(ctx, { requestId: 'req_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY',
    sessionId: 'session_TEST_ONLY' }, new AbortController().signal))
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('TEST_ONLY expected refusal')
  assert.equal(result.error.code, 'SESSION_FORMAT_UNSUPPORTED')
  assert.match(result.error.message, /支持 v5 的配套修复版/u)
  assert.doesNotMatch(JSON.stringify(result), /TEST_ONLY_PRIVATE|session\.jsonl|unknown plugin/u)
  assert.equal(result.error.retryable, false)
})
