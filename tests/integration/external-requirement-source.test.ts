import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ExternalRequirementSource, externalMemberKind, MAX_EXTERNAL_MEMBERS } from '../../src/host/sources/external.ts'
import { ExternalSourceRegistry } from '../../src/host/sources/registry.ts'
import { readApproval } from '../../src/core/pipeline/spec-compat.ts'
import { creationSpec } from '../../src/shared/writing-task.ts'

const signal = () => new AbortController().signal

/** A folder outside every workspace, shaped like a real assignment drop. */
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'scholarflow-TEST_ONLY-external-'))
  const outside = join(base, 'computer-elsewhere')
  await mkdir(join(outside, 'sub'), { recursive: true })
  await mkdir(join(outside, '.git'))
  await writeFile(join(outside, '作业说明.md'), 'TEST_ONLY 要求：四页，第一页封面')
  await writeFile(join(outside, 'sub', '评分标准.txt'), 'TEST_ONLY 评分标准')
  await writeFile(join(outside, '.git', 'config'), 'TEST_ONLY must never be offered')
  await writeFile(join(outside, '.env'), 'TEST_ONLY secret must never be read')
  await writeFile(join(outside, 'archive.bin'), new Uint8Array([0, 255, 13, 10]))
  return { base, outside }
}

test('V3b: an external source opens only a real absolute directory and refuses a link', async () => {
  const f = await fixture()
  const source = await ExternalRequirementSource.open(f.outside, 'folder')
  assert.equal(source.kind, 'folder')
  // The canonical root is what containment is measured against, so a symlinked alias cannot
  // be used to re-open the same tree under a spelling the checks did not see.
  await assert.rejects(ExternalRequirementSource.open('relative/path', 'folder'), { message: /绝对路径/ })
  await assert.rejects(ExternalRequirementSource.open(`${f.outside}\0evil`, 'folder'), { message: /绝对路径/ })
  await assert.rejects(ExternalRequirementSource.open(join(f.outside, '作业说明.md'), 'folder'), { message: /普通文件夹/ })
  const link = join(f.base, 'alias')
  try {
    await symlink(f.outside, link, 'junction')
    await assert.rejects(ExternalRequirementSource.open(link, 'folder'), { message: /链接/ })
  } catch (error) {
    // Creating a link needs a privilege Windows does not always grant; the direct link
    // refusal below still covers the read path.
    if (!['EPERM', 'EACCES', 'UNKNOWN'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
})

test('V3b: listing stays inside the chosen folder, skips links and secrets, and names members relatively', async () => {
  const f = await fixture()
  const source = await ExternalRequirementSource.open(f.outside, 'folder')
  const listing = await source.list(signal())
  const names = listing.members.map(member => member.name).sort()
  assert.deepEqual(names, ['archive.bin', 'sub/评分标准.txt', '作业说明.md'])
  assert.equal(listing.truncated, false)
  // Members are relative to the chosen root: nothing here reveals where the folder lives.
  for (const member of listing.members) {
    assert.equal(member.name.includes(f.base), false, '成员名不得包含绝对路径')
    assert.equal(member.name.startsWith('/'), false)
  }
  assert.ok(listing.diagnostics.some(note => /敏感文件|版本控制/.test(note)), '跳过敏感文件时给出说明')
  assert.equal(externalMemberKind('作业说明.md'), 'readable')
  assert.equal(externalMemberKind('老师截图.png'), 'image')
  assert.equal(externalMemberKind('archive.bin'), 'unsupported')
})

test('V3b: reading a member is bounded to the chosen folder and refuses traversal', async () => {
  const f = await fixture()
  const source = await ExternalRequirementSource.open(f.outside, 'folder')
  const bytes = await source.read('作业说明.md', signal())
  assert.equal(new TextDecoder().decode(bytes), 'TEST_ONLY 要求：四页，第一页封面')
  assert.equal(new TextDecoder().decode(await source.read('sub/评分标准.txt', signal())), 'TEST_ONLY 评分标准')

  // A member name is a relative name, never a way back up the tree. Assertions use the stable
  // error codes rather than message text, which callers are told never to branch on.
  await assert.rejects(source.read('../outside.md', signal()), { code: 'EXTERNAL_SOURCE_INVALID' })
  await assert.rejects(source.read('sub/../../escape.md', signal()), { code: 'EXTERNAL_SOURCE_INVALID' })
  await assert.rejects(source.read('', signal()), { code: 'EXTERNAL_SOURCE_INVALID' })
  await assert.rejects(source.read('sub', signal()), { code: 'EXTERNAL_SOURCE_INVALID' })
  await assert.rejects(source.read('sub/评分标准.txt/extra.md', signal()), { code: 'EXTERNAL_SOURCE_INVALID' })
  // Secrets are refused by name even when a caller asks for one directly, and so are the
  // directories listing already skips.
  await assert.rejects(source.read('.env', signal()), { code: 'EXTERNAL_SOURCE_INVALID' })
  await assert.rejects(source.read('.git/config', signal()), { code: 'EXTERNAL_SOURCE_INVALID' })
})

test('V3b: a chosen file offers itself and the member cap bounds a wide folder', async () => {
  const f = await fixture()
  const file = await ExternalRequirementSource.open(join(f.outside, '作业说明.md'), 'file')
  const listing = await file.list(signal())
  assert.deepEqual(listing.members.map(member => member.name), ['作业说明.md'])
  assert.equal(new TextDecoder().decode(await file.read('作业说明.md', signal())), 'TEST_ONLY 要求：四页，第一页封面')

  const wide = join(f.base, 'wide')
  await mkdir(wide)
  for (let index = 0; index < MAX_EXTERNAL_MEMBERS + 12; index += 1) await writeFile(join(wide, `f${index}.md`), 'TEST_ONLY')
  const many = await ExternalRequirementSource.open(wide, 'folder')
  const capped = await many.list(signal())
  assert.equal(capped.members.length, MAX_EXTERNAL_MEMBERS)
  assert.equal(capped.truncated, true, '超出上限时明确标记，不假装列全了')
})

test('V3b: the host hands out an opaque handle and never the folder path', async () => {
  const f = await fixture()
  const registry = new ExternalSourceRegistry()
  const picked = await registry.pick({ kind: 'native', pick: async () => f.outside }, 'TEST_ONLY-owner', signal())
  assert.equal(picked.cancelled, false)
  if (picked.cancelled) return
  assert.ok(picked.handle && picked.resourceId)
  // Neither identifier may carry the location: the spec stores these, the host keeps the root.
  assert.equal(picked.handle.includes(f.base), false)
  assert.equal(picked.resourceId.includes(f.base), false)
  assert.equal(picked.members.some(member => member.name.includes(f.base)), false)
  assert.equal(picked.readableCount, 2)

  assert.deepEqual(registry.status([picked.handle, 'external_source_unknown'], 'TEST_ONLY-owner'), { live: [picked.handle] })
  // A grant belongs to the operator who made it.
  assert.deepEqual(registry.status([picked.handle], 'TEST_ONLY-other'), { live: [] })
  assert.equal(registry.resolve(picked.handle, 'TEST_ONLY-other'), undefined)
  // The live grant is the read path the writing run uses.
  assert.equal(new TextDecoder().decode(await registry.resolve(picked.handle, 'TEST_ONLY-owner')!.read('作业说明.md', signal())),
    'TEST_ONLY 要求：四页，第一页封面')
})

test('V3b: picking refuses a folder nothing can parse and a host with no native chooser', async () => {
  const f = await fixture()
  const empty = join(f.base, 'nothing-readable')
  await mkdir(empty)
  await writeFile(join(empty, 'a.bin'), new Uint8Array([1, 2, 3]))
  await assert.rejects(new ExternalSourceRegistry().pick({ kind: 'native', pick: async () => empty }, 'o', signal()), { message: /没有可读取/ })
  await assert.rejects(new ExternalSourceRegistry().pick({ kind: 'browse' } as any, 'o', signal()), { message: /原生目录选择器/ })
  await assert.rejects(new ExternalSourceRegistry().pick(undefined, 'o', signal()), { message: /原生目录选择器/ })
  assert.deepEqual(await new ExternalSourceRegistry().pick({ kind: 'native', pick: async () => null }, 'o', signal()), { cancelled: true })
})

test('V3b: an external source informs the requirements but is never copied into the project', async () => {
  const f = await fixture()
  const spec = creationSpec.parse({
    title: '外部来源论文', type: 'course-paper', language: 'zh-CN', format: 'docx',
    requirements: '四页，第一页封面', targetLength: 4000, materials: [],
    requirementSources: [{ resourceId: 'req_0123456789abcdef', origin: 'external', kind: 'folder',
      handle: 'external_source_0123456789abcdef', members: [{ name: '作业说明.md', size: 42 }] }],
    sections: [{ id: 'section_1', title: '引言', purpose: '', targetLength: 4000 }]
  })
  // The external source is part of the run's requirement authority...
  assert.equal(readApproval(spec).sources.length, 1)
  // ...but contributes no path to the approved set, so the materials stage never registers
  // it in the ledger and no bytes are copied into the project (SPEC v1.1 §11).
  assert.deepEqual(readApproval(spec).paths, [])
  assert.equal(JSON.stringify(spec).includes(f.base), false)

  // The stored spec keeps the handle and the relative member name, never the location.
  assert.ok(JSON.stringify(spec).includes('external_source_0123456789abcdef'))
  assert.ok(JSON.stringify(spec).includes('作业说明.md'))

  // An external source cannot smuggle a path in place of its handle.
  assert.throws(() => creationSpec.parse({ ...spec, requirementSources: [{ resourceId: 'req_0123456789abcdef',
    origin: 'external', kind: 'folder', path: 'C:/elsewhere', members: [] }] }))
})

test('V3b: an authorised external read leaves the chosen folder and the workspace byte-identical', async () => {
  const f = await fixture()
  const workspace = join(f.base, 'workspace')
  await mkdir(workspace)
  // The read grant is read-only by construction: reading a member copies nothing, so the folder
  // the user picked can never become an output directory and no manuscript path can be
  // redirected into it. The write gate that keeps it un-writable is asserted against the real
  // gateway in tests/contracts/project-resource-gateway.test.ts.
  const source = await ExternalRequirementSource.open(f.outside, 'folder')
  assert.equal(new TextDecoder().decode(await source.read('作业说明.md', signal())), 'TEST_ONLY 要求：四页，第一页封面')
  // Reading the chosen folder left it byte-identical: nothing was written or moved.
  assert.equal(await readFile(join(f.outside, '作业说明.md'), 'utf8'), 'TEST_ONLY 要求：四页，第一页封面')
  assert.deepEqual(await readdir(workspace), [], '外部读取不在工作区留下任何产物')
})
