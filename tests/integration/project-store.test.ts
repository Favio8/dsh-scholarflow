import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { prepareInit, initialize, snapshot, parseConfig, parseConfigWithWarnings, parseLedger, mutateLedger, updateProjectText } from '../../src/core/project/project.ts'
import { digest } from '../../src/core/store/files.ts'
import { resolveInitDefaults } from '../../src/shared/project-defaults.ts'

test('AT-01: inspect and cancelled initialization plans leave original bytes unchanged', async () => {
  const io = new MemoryStore({ '零散笔记.md': '用户原始资料', 'old/thesis.txt': '保留稿件' })
  const before = [...io.files.entries()]
  const plan = await prepareInit(io, { title: 'TEST_ONLY 课程项目', type: 'course-paper' })
  assert.ok(plan.files.length > 0)
  assert.deepEqual([...io.files.entries()], before)
  assert.equal(io.writes, 0)
})

test('AT-02: a pre-existing manuscript or metadata directory is never overwritten', async () => {
  for (const path of ['manuscript/人工稿.md', '.scholarflow/private.txt']) {
    const io = new MemoryStore({ [path]: '原稿不可覆盖' })
    await assert.rejects(prepareInit(io, { title: 'TEST_ONLY', type: 'course-paper' }), { code: 'OUTPUT_PATH_CONFLICT' })
    assert.equal(io.writes, 0); assert.equal((await io.read(path))!.text, '原稿不可覆盖')
  }
})

test('initialization is complete, JSON/YAML validated, and recoverable from disk alone', async () => {
  const io = new MemoryStore({ '资料/研究.md': '原始资料保持只读' })
  const plan = await prepareInit(io, { title: 'TEST_ONLY 文献综述', type: 'literature-review', manuscriptDir: '写作成果' })
  await initialize(io, plan)
  const reopened = await snapshot(new MemoryStore(Object.fromEntries([...io.files].map(([path, file]) => [path, file.text]))))
  assert.equal(reopened.config.project.type, 'literature-review')
  assert.equal(reopened.document.relativePath, '写作成果/paper.md')
  assert.equal(reopened.document.externalChange, false)
  assert.equal((await io.read('资料/研究.md'))!.text, '原始资料保持只读')
  assert.equal(reopened.config.project.id, reopened.ledger.projectId)
})

test('confirmation detects files created after planning instead of covering them', async () => {
  const io = new MemoryStore()
  const plan = await prepareInit(io, { title: 'TEST_ONLY', type: 'course-paper' })
  io.externalEdit('manuscript/new.md', '外部编辑器的新稿')
  const before = [...io.files.entries()]
  await assert.rejects(initialize(io, plan), { code: 'OUTPUT_PATH_CONFLICT' })
  assert.deepEqual([...io.files.entries()], before)
})

test('invalid or newer schemas fail closed, without resetting persistent data', () => {
  assert.throws(() => parseConfig('schemaVersion: 99'), { code: 'PROJECT_SCHEMA_TOO_NEW' })
  assert.throws(() => parseConfig('schemaVersion: 1\nproject: ['), { code: 'PROJECT_CONFIG_INVALID' })
  assert.throws(() => parseLedger('{broken'), { code: 'PROJECT_LEDGER_INVALID' })
  assert.throws(() => parseLedger('{}'), { code: 'PROJECT_LEDGER_INVALID' })
})

test('configuration defaults preserve identity, custom output, and report unknown policies', () => {
  const original = 'schemaVersion: 1\nproject:\n  id: prj_TEST_ONLY\n  type: research-paper\npaths:\n  manuscriptDir: 写作成果\nprivacy:\n  allow_fabricated_results: true\n'
  const { config, warnings } = parseConfigWithWarnings(original)
  assert.equal(config.paths.mainDocument, '写作成果/paper.md')
  assert.equal(config.writing.preset, 'builtin:research-paper-zh')
  assert.equal(config.workflow.budget.maxModelCalls, 40)
  assert.deepEqual(warnings, ['privacy.allow_fabricated_results'])
  assert.equal(config.privacy.sendSelectedContentOnly, true)
  assert.throws(() => parseConfig('schemaVersion: 1\nproject: {}'), { code: 'PROJECT_CONFIG_INVALID' })
  assert.throws(() => parseConfig(original.replace('privacy:', 'workflow:\n  budget:\n    maxModelCalls: 999\nprivacy:')), { code: 'PROJECT_CONFIG_INVALID' })
})

test('AT-24: two writers using the same revision cannot silently overwrite one another', async () => {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY', type: 'course-paper' }))
  const outcomes = await Promise.allSettled([
    mutateLedger(io, 0, ledger => { ledger.outline.title = '会话 A 的编辑' }),
    mutateLedger(io, 0, ledger => { ledger.outline.title = '会话 B 的编辑' }),
  ])
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'STALE_LEDGER_REVISION')
  assert.equal((await snapshot(io)).ledger.revision, 1)
})

test('project text edits are limited, version guarded, and preserve external changes', async () => {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY', type: 'course-paper' }))
  const path = '.scholarflow/context/terminology.md'
  const before = (await io.read(path))!.text
  io.externalEdit(path, '人工更正术语')
  await assert.rejects(updateProjectText(io, path, '不应覆盖', digest(before), 0), { code: 'STALE_DOCUMENT_VERSION' })
  assert.equal((await io.read(path))!.text, '人工更正术语')
  await assert.rejects(updateProjectText(io, 'raw-material.md', '不应写入', digest(before), 0), { code: 'PATH_OUTSIDE_ALLOWED_ROOT' })
})

test('external manuscript bytes are detected and retained', async () => {
  const io = new MemoryStore()
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY', type: 'research-paper' }))
  io.externalEdit('manuscript/paper.md', '# 外部人工稿\n')
  const current = await snapshot(io)
  assert.equal(current.document.externalChange, true)
  assert.equal(current.document.text, '# 外部人工稿\n')
})

test('new project defaults are frozen in the approved plan and never reset an existing project', async () => {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY immutable material' })
  const defaults = { defaultProjectType: 'literature-review' as const, language: 'en' as const, maxModelCalls: 7 }
  const plan = await prepareInit(io, resolveInitDefaults({ title: 'TEST_ONLY English review' }, defaults))
  assert.equal(io.writes, 0)
  assert.equal(plan.config.project.type, 'literature-review'); assert.equal(plan.config.project.language, 'en')
  assert.equal(plan.config.writing.preset, 'builtin:literature-review-en'); assert.equal(plan.config.workflow.budget.maxModelCalls, 7)
  defaults.maxModelCalls = 3
  await initialize(io, plan)
  assert.equal((await snapshot(io)).config.workflow.budget.maxModelCalls, 7)
  const before = [...io.files.entries()]
  await assert.rejects(prepareInit(io, resolveInitDefaults({ title: 'TEST_ONLY later' }, defaults)), { code: 'OUTPUT_PATH_CONFLICT' })
  assert.deepEqual([...io.files.entries()], before)
  assert.deepEqual(resolveInitDefaults({ title: 'TEST_ONLY overrides', type: 'research-paper', language: 'zh-CN', maxModelCalls: 12 }, defaults),
    { title: 'TEST_ONLY overrides', type: 'research-paper', language: 'zh-CN', maxModelCalls: 12 })
  for (const maxModelCalls of [0, 41, 1.5, NaN]) assert.throws(() => resolveInitDefaults({ title: 'TEST_ONLY', maxModelCalls }, defaults))
  assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY immutable material')
})
