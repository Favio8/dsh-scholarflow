import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, relative, isAbsolute } from 'node:path'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, CONFIG_PATH } from '../../src/core/project/project.ts'
import { inspectProject, resolveStore } from '../../src/host/bridge/project-api.ts'

// TEST_ONLY Host registry/reader seam. No real session, policy or duplicate
// workspace registration is claimed; installed-host-smoke covers the real SDK.
async function fixture() {
  const a = new MemoryStore({ 'raw-private.txt': 'TEST_ONLY do not inspect raw material' })
  await initialize(a, await prepareInit(a, { title: 'TEST_ONLY copied project', type: 'course-paper' }))
  const b = new MemoryStore(Object.fromEntries([...a.files].map(([path, file]) => [path, file.text])))
  const roots = [resolve('TEST_ONLY_copy_A'), resolve('TEST_ONLY_copy_B')], stores = [a, b]
  const registry = roots.map((path, index) => ({ id: `workspace_TEST_ONLY_${index}`, path, sessionIds: [`session_TEST_ONLY_${index}`] }))
  const reads: Array<{ root: number; path: string }> = []
  const locate = (target: { path: string }) => {
    const root = roots.findIndex(root => { const path = relative(root, target.path); return !isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') })
    assert.notEqual(root, -1, 'TEST_ONLY no reads outside fixture roots')
    return { root, io: stores[root], path: relative(roots[root], target.path).replaceAll('\\', '/') }
  }
  const host = { workspaceRegistry: { get: (id: string) => registry.find(row => row.id === id), list: () => registry },
    sessionController: { inspect: async (id: string) => {
      const row = registry.find(row => row.sessionIds.includes(id))
      return row ? { meta: { cwd: row.path, agentPreset: 'scholarflow' }, events: [] } : undefined
    } }, fs: {
      resolve: async (path: string) => ({ path: resolve(path) }), processPath: (target: any) => target.path,
      contains: (base: any, target: any) => { const path = relative(base.path, target.path); return !isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') },
      stat: async (target: any) => { const { io, path } = locate(target), info = await io.stat(path); return info && { ...info, version: (await io.read(path))?.version ?? 'TEST_ONLY_directory' } },
      readText: async (target: any) => { const { root, io, path } = locate(target); reads.push({ root, path }); return (await io.read(path))!.text },
      readBytes: async (target: any, _signal: AbortSignal, cap: number) => { const { root, io, path } = locate(target); reads.push({ root, path }); return io.readBytes(path, cap) },
      listDir: async (target: any) => { const { io, path } = locate(target); return (await io.list(path)).map(row => ({ ...row, name: row.path.split('/').at(-1) })) },
    } }
  const context = { requestId: 'req_TEST_ONLY', workspaceId: registry[1].id, sessionId: registry[1].sessionIds[0] }
  return { a, b, roots, registry, reads, host, context, signal: new AbortController().signal }
}

test('duplicate project identities expose bounded local originals without enabling writes or reading the other manuscript', async () => {
  const { a, b, reads, host, context, signal } = await fixture(), beforeA = [...a.files], beforeB = [...b.files]
  const result = await inspectProject(host, { context }, signal)
  assert.equal(result.initialized, false); assert.equal(result.readonly?.reason.code, 'PROJECT_ID_CONFLICT')
  assert.equal(result.binding.workspaceId, context.workspaceId)
  assert.deepEqual(result.identityConflict?.copies.map(row => row.workspaceId), ['workspace_TEST_ONLY_0'])
  assert.ok(result.readonly?.originals.some(row => row.relativePath === 'manuscript/paper.md'))
  assert.ok(reads.every(row => row.root === 1 || row.path === CONFIG_PATH))
  assert.ok(!reads.some(row => row.path === 'raw-private.txt'))
  assert.ok(!JSON.stringify(result.identityConflict).includes('TEST_ONLY_copy_A'))
  await assert.rejects(resolveStore(host, context, signal), { code: 'PROJECT_ID_CONFLICT' })
  const { io } = await resolveStore(host, context, signal, undefined, true)
  await assert.rejects(io.lock(async () => assert.fail('TEST_ONLY must not create a lock')), { code: 'PROJECT_READONLY' })
  await assert.rejects(io.write(CONFIG_PATH, 'TEST_ONLY invalid replacement', await io.read(CONFIG_PATH)), { code: 'PROJECT_READONLY' })
  assert.deepEqual([...a.files], beforeA); assert.deepEqual([...b.files], beforeB)
})

test('multiple registrations of one canonical root remain one project; removing a duplicate resolves the diagnostic without identity changes', async () => {
  const { host, registry, context, signal, b } = await fixture()
  const originalConfig = (await b.read(CONFIG_PATH))!.text
  registry.push({ id: 'workspace_TEST_ONLY_alias', path: registry[1].path, sessionIds: ['session_TEST_ONLY_alias'] })
  registry.splice(0, 1)
  const result = await inspectProject(host, { context }, signal)
  assert.equal(result.initialized, true); assert.equal(result.readonly, undefined); assert.equal(result.identityConflict, undefined)
  assert.equal((await b.read(CONFIG_PATH))!.text, originalConfig)
  await assert.rejects(inspectProject(host, { context: { ...context, projectId: 'prj_TEST_ONLY_other' } }, signal), { code: 'PROJECT_ID_CONFLICT' })
})
