import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, realpath, symlink, link } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { HostFileStore } from '../../src/host/gateway/file-store.ts'
import { ScholarError } from '../../src/shared/errors.ts'

// TEST_ONLY Host service seam with actual native filesystem metadata and bytes.
// No policy or writer is fabricated: these tests perform only resource reads.
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'scholarflow-TEST_ONLY-project-resource-')))
  const path = '.scholarflow/skills/test-only/revision'
  await mkdir(join(root, path), { recursive: true })
  const calls: string[] = []
  const host = { fs: {
    resolve: async (path: string) => ({ path: await realpath(path).catch(() => resolve(path)) }),
    processPath: (target: any) => target.path,
    contains: (base: any, target: any) => { const rel = relative(base.path, target.path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') },
    stat: async (target: any) => {
      const info = await stat(target.path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
      return info && { type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size, version: `${info.ino}:${info.mtimeMs}:${info.size}` }
    },
    readBytes: async (target: any, _signal: AbortSignal, cap: number) => { calls.push(target.path); const bytes = await readFile(target.path); assert.ok(bytes.length <= cap); return bytes },
    listDir: async (target: any) => (await readdir(target.path, { withFileTypes: true })).map(row => ({ name: row.name, type: row.isDirectory() ? 'directory' : row.isFile() ? 'file' : 'other' })),
  } }
  const io = new HostFileStore(host, { canonicalRoot: root, manuscriptDir: 'manuscript', sessionId: 'ses_TEST_ONLY', revalidate: async () => {} }, new AbortController().signal)
  return { root, path, io, calls }
}
test('fixed project resource byte capability preserves binary bytes without opening raw-material or arbitrary metadata paths', async () => {
  const { root, path, io, calls } = await fixture(), original = new Uint8Array([0, 255, 13, 10, 128])
  await writeFile(join(root, path, 'binary.bin'), original)
  assert.deepEqual(new Uint8Array(await io.readResourceBytes(`${path}/binary.bin`, 10)), original)
  await assert.rejects(io.readBytes(`${path}/binary.bin`, 10), { code: 'MATERIAL_ACCESS_DENIED' })
  for (const bad of ['.scholarflow/project.yaml', '.scholarflow/skills/current-stage.json', '.scholarflow/skills/test-only/SKILL.md', 'manuscript/paper.md', 'unselected.txt', `${path}/.credentials.yaml`])
    await assert.rejects(io.readResourceBytes(bad, 10), { code: 'SKILL_RESOURCE_PATH_INVALID' })
  assert.equal(calls.length, 1)
})
test('project resource junctions and hardlinks fail before any Host content read', async () => {
  const { root, path, io, calls } = await fixture(), outside = join(root, 'TEST_ONLY-outside')
  await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'TEST_ONLY private outside data')
  await symlink(outside, join(root, path, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(io.readResourceBytes(`${path}/linked/secret.txt`, 100), { code: 'SKILL_SOURCE_LINK' })
  await link(join(outside, 'secret.txt'), join(root, path, 'alias.txt'))
  await assert.rejects(io.readResourceBytes(`${path}/alias.txt`, 100), { code: 'SKILL_SOURCE_LINK' })
  assert.deepEqual(calls, [])
})

// TEST_ONLY injected policy seam, not evidence of installed SDK behavior.
// Real policy allow/deny is asserted by installed-host-smoke.mjs.
async function writerFixture() {
  const { root, path, calls } = await fixture()
  const controller = new AbortController(), state = { mode: 'workspace-write', fences: 0 }
  const host: any = { fs: {
    resolve: async (path: string) => ({ path: await realpath(path).catch(() => resolve(path)) }),
    processPath: (target: any) => target.path,
    contains: (base: any, target: any) => { const rel = relative(base.path, target.path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') },
    stat: async (target: any) => { const info = await stat(target.path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error });
      return info && { type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size, version: `${info.ino}:${info.mtimeMs}:${info.size}` } },
    readBytes: async (target: any, _signal: AbortSignal, cap: number) => { calls.push(target.path); const bytes = await readFile(target.path); assert.ok(bytes.length <= cap); return bytes },
    checkedTarget: async (target: any, policy: any) => { state.fences++; assert.equal(policy.workspaceRoot, root); if (policy.mode === 'read-only') throw new ScholarError('FS_SANDBOX_DENIED', 'TEST_ONLY policy denial'); return target },
    writeText: async (target: any, text: string, expected: any, _signal: AbortSignal, policy: any) => {
      await host.fs.checkedTarget(target, policy)
      const current = await host.fs.stat(target)
      if (expected?.kind === 'replaceIfVersion') assert.equal(current?.version, expected.version)
      else assert.equal(current, undefined)
      await mkdir(resolve(target.path, '..'), { recursive: true }); await writeFile(target.path, text)
      return { version: (await host.fs.stat(target)).version }
    },
  }, sessionController: { resolveAgent: async () => ({ agent: { session: { header: { cwd: root } } } }) },
  sandboxPolicy: { resolve: () => ({ mode: state.mode, workspaceRoot: root }) } }
  const io = new HostFileStore(host, { canonicalRoot: root, manuscriptDir: 'manuscript', sessionId: 'ses_TEST_ONLY', revalidate: async () => {} }, controller.signal)
  return { root, path, io, host, state, controller }
}
test('create-only resource gateway requires lock and policy fence, preserves binary bytes and refuses existing content', async () => {
  const { root, path, io, state } = await writerFixture(), bytes = new Uint8Array([0, 255, 128, 13, 10])
  await assert.rejects(io.createResourceBytes(`${path}/binary.bin`, bytes), { code: 'PROJECT_READONLY' })
  await io.lock(() => io.createResourceBytes(`${path}/assets/binary.bin`, bytes))
  assert.ok(state.fences > 2)
  assert.deepEqual(new Uint8Array(await readFile(join(root, path, 'assets/binary.bin'))), bytes)
  await assert.rejects(io.lock(() => io.createResourceBytes(`${path}/assets/binary.bin`, new Uint8Array([1]))), { code: 'EEXIST' })
  assert.deepEqual(new Uint8Array(await readFile(join(root, path, 'assets/binary.bin'))), bytes)
})
test('resource creation refuses missing policy capability, sandbox downgrade, abort and arbitrary metadata paths', async () => {
  const { root, path, io, host, state } = await writerFixture(), bytes = new Uint8Array([1])
  const fence = host.fs.checkedTarget
  await io.lock(async () => {
    delete host.fs.checkedTarget
    await assert.rejects(io.createResourceBytes(`${path}/no-capability/file.bin`, bytes), { code: 'SKILL_RESOURCE_WRITE_UNAVAILABLE' })
    host.fs.checkedTarget = fence
    state.mode = 'read-only'
    await assert.rejects(io.createResourceBytes(`${path}/denied/file.bin`, bytes), { code: 'FS_SANDBOX_DENIED' })
    state.mode = 'workspace-write'
    for (const target of ['unselected.txt', '.scholarflow/project.yaml', '.scholarflow/skills/current-stage.json', `${path}/.credentials.yaml`, `${path}/../outside.bin`])
      await assert.rejects(io.createResourceBytes(target, bytes))
  })
  await assert.rejects(stat(join(root, path, 'no-capability')), { code: 'ENOENT' })
  await assert.rejects(stat(join(root, path, 'denied')), { code: 'ENOENT' })
  const aborted = await writerFixture()
  await aborted.io.lock(async () => { aborted.controller.abort(); await assert.rejects(aborted.io.createResourceBytes(`${aborted.path}/aborted/file.bin`, bytes), { name: 'AbortError' }) })
  await assert.rejects(stat(join(aborted.root, aborted.path, 'aborted')), { code: 'ENOENT' })
})
test('resource creation rejects directory junctions and existing hardlinks without changing their targets', async () => {
  const { root, path, io } = await writerFixture(), outside = join(root, 'TEST_ONLY-original'), original = new Uint8Array([255, 0, 11])
  await mkdir(outside); await writeFile(join(outside, 'source.bin'), original)
  await symlink(outside, join(root, path, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await link(join(outside, 'source.bin'), join(root, path, 'alias.bin'))
  await assert.rejects(io.lock(() => io.createResourceBytes(`${path}/linked/new.bin`, original)), { code: 'SKILL_SOURCE_LINK' })
  await assert.rejects(io.lock(() => io.createResourceBytes(`${path}/alias.bin`, new Uint8Array([1]))), { code: 'SKILL_SOURCE_LINK' })
  assert.deepEqual(new Uint8Array(await readFile(join(outside, 'source.bin'))), original)
  await assert.rejects(stat(join(outside, 'new.bin')), { code: 'ENOENT' })
})
