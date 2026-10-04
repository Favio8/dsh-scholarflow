import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, realpath, symlink, link } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { HostFileStore } from '../../src/host/gateway/file-store.ts'

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
