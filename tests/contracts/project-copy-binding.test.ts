import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, relative, isAbsolute } from 'node:path'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, CONFIG_PATH } from '../../src/core/project/project.ts'
import { inspectProject, resolveStore } from '../../src/host/bridge/project-api.ts'
import { prepareProjectCopy, applyProjectCopy, copyPlanTransition } from '../../src/core/project/identity.ts'
import { digest } from '../../src/core/store/files.ts'
import { snapshot } from '../../src/core/project/project.ts'
import { parse, stringify } from 'yaml'

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

test('a safely readable newer-schema copy identity still conflicts without adopting its unknown policies', async () => {
  const { a, b, host, context, signal } = await fixture(), future = parse((await a.read(CONFIG_PATH))!.text)
  future.schemaVersion = 99; future.futureOnly = { TEST_ONLY: 'unknown policy must not be applied' }
  a.externalEdit(CONFIG_PATH, stringify(future)); const beforeA = [...a.files], beforeB = [...b.files]
  const result = await inspectProject(host, { context }, signal)
  assert.equal(result.readonly?.reason.code, 'PROJECT_ID_CONFLICT'); assert.equal(result.identityConflict?.copies.length, 1)
  await assert.rejects(resolveStore(host, context, signal), { code: 'PROJECT_ID_CONFLICT' })
  assert.deepEqual([...a.files], beforeA); assert.deepEqual([...b.files], beforeB)
})

test('the internal identity transition is confined to one root and two exact configs; third-party config edits stop further gateway writes', async () => {
  const { a, b, host, context, signal, roots } = await fixture(), beforeA = [...a.files]
  const rootFingerprint = (await resolveStore(host, context, signal, undefined, true)).binding.rootFingerprint
  const plan = await prepareProjectCopy(b, { sourceSessionId: context.sessionId, rootFingerprint, expectedRevision: (await snapshot(b)).ledger.revision,
    reason: 'TEST_ONLY explicit current-root copy confirmation' }), transition = copyPlanTransition(plan)
  await assert.rejects(resolveStore(host, context, signal, undefined, false, { ...transition, rootFingerprint: digest('TEST_ONLY another root') }), { code: 'SESSION_BINDING_CHANGED' })
  const ctx: any = host
  ctx.sessionController.resolveAgent = async () => ({ agent: { session: { header: { cwd: roots[1] } } } })
  ctx.sandboxPolicy = { resolve: () => ({ mode: 'workspace-write', workspaceRoot: roots[1] }) }
  let writes = 0
  ctx.fs.writeText = async (target: any, text: string, expected: any, _signal: AbortSignal, policy: any) => {
    assert.equal(policy.workspaceRoot, roots[1]); const path = relative(roots[1], target.path).replaceAll('\\', '/')
    const previous = await b.read(path)
    assert.equal(expected.kind, 'replaceIfVersion'); assert.equal(expected.version, previous!.version)
    writes++; return b.write(path, text, previous)
  }
  const { io } = await resolveStore(host, { ...context, projectId: plan.oldProjectId }, signal, undefined, false, transition)
  await io.write(CONFIG_PATH, plan.newConfigText, await io.read(CONFIG_PATH)); assert.equal(writes, 1)
  b.externalEdit(CONFIG_PATH, plan.newConfigText + '# TEST_ONLY unapproved external edit\n')
  await assert.rejects(io.write(CONFIG_PATH, plan.newConfigText, await io.read(CONFIG_PATH)), { code: 'SESSION_BINDING_CHANGED' })
  assert.equal(writes, 1); assert.deepEqual([...a.files], beforeA)
})

test('a confirmed copy journal can be inspected read-only while duplicate identity still exists; an injected transaction target loses the exemption', async () => {
  const { b, host, context, signal } = await fixture()
  const rootFingerprint = (await resolveStore(host, context, signal, undefined, true)).binding.rootFingerprint
  const plan = await prepareProjectCopy(b, { sourceSessionId: context.sessionId, rootFingerprint, expectedRevision: (await snapshot(b)).ledger.revision,
    reason: 'TEST_ONLY explicitly confirmed copy transaction recovery' }), write = b.write.bind(b)
  b.write = async (...args) => { const result = await write(...args); if (args[0].startsWith('.scholarflow/transactions/')) throw new Error('TEST_ONLY interruption before config'); return result }
  await assert.rejects(applyProjectCopy(b, plan), /TEST_ONLY interruption/); b.write = write
  const result = await inspectProject(host, { context }, signal)
  assert.equal(result.readonly?.reason.code, 'PROJECT_ID_CONFLICT'); assert.equal(result.recovery?.copyIdentity, true)
  assert.ok(result.recovery?.transactions[0].files.some(row => row.relativePath === CONFIG_PATH))
  const path = [...b.files.keys()].find(path => path.startsWith('.scholarflow/transactions/') && JSON.parse(b.files.get(path)!.text).state === 'prepared')!
  const journal = JSON.parse((await b.read(path))!.text); journal.changes.push({ path: '.scholarflow/TEST_ONLY-extra.json', before: null,
    after: { text: '{}', hash: digest('{}') } }); b.externalEdit(path, JSON.stringify(journal))
  const before = [...b.files], invalid = await inspectProject(host, { context }, signal)
  assert.equal(invalid.recovery, undefined); assert.equal(invalid.readonly?.reason.code, 'PROJECT_ID_CONFLICT'); assert.deepEqual([...b.files], before)
})
