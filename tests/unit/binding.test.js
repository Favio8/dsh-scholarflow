/**
 * WorkspaceBinding unit tests - Core layer, offline and deterministic.
 *
 * Run:  node --test "tests/unit/binding.test.js"
 * (Pass the FILE path: `node --test tests/unit` fails on this machine's Node 24.15.0.)
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BINDING_SCHEMA_VERSION,
  BindingProblem,
  bindingKey,
  createWorkspaceBinding,
  describeBindingProblem,
  findProjectIdConflicts,
  rootFingerprint,
} from '../../src/core/project/binding.js'

const BASE = {
  workspaceId: 'ws-1',
  projectId: 'prj_1',
  sessionId: 'sess-1',
  canonicalRoot: 'D:\\project\\我的课程论文',
}

test('the binding never carries the canonical root', () => {
  const { binding, hostOnly } = createWorkspaceBinding(BASE)
  assert.equal(hostOnly.canonicalRoot, BASE.canonicalRoot)
  const serialized = JSON.stringify(binding)
  assert.equal(serialized.includes('D:'), false)
  assert.equal(serialized.includes('我的课程论文'), false)
  assert.equal(Object.keys(binding).includes('canonicalRoot'), false)
})

test('a serialized binding contains only the contracted fields', () => {
  const { binding } = createWorkspaceBinding(BASE)
  assert.deepEqual(Object.keys(binding).sort(), [
    'modeId',
    'projectId',
    'rootFingerprint',
    'schemaVersion',
    'sessionId',
    'workspaceId',
  ])
  assert.equal(binding.schemaVersion, BINDING_SCHEMA_VERSION)
  assert.equal(binding.modeId, 'scholarflow')
  assert.match(binding.rootFingerprint, /^sha256:[0-9a-f]{64}$/)
})

test('the fingerprint folds separator style and trailing separators', () => {
  const variants = [
    'D:\\project\\我的课程论文',
    'D:\\project\\我的课程论文\\',
    'D:/project/我的课程论文',
    'd:\\PROJECT\\我的课程论文',
  ]
  const prints = variants.map(rootFingerprint)
  assert.equal(new Set(prints).size, 1, `expected one fingerprint, got ${JSON.stringify(prints)}`)
})

test('different directories produce different fingerprints', () => {
  assert.notEqual(rootFingerprint('D:\\project'), rootFingerprint('D:\\project-other'))
  assert.notEqual(rootFingerprint('D:\\project'), rootFingerprint('C:\\project'))
})

test('an empty or missing root is refused rather than hashed', () => {
  assert.throws(() => rootFingerprint(''), { name: 'TypeError' })
  assert.throws(() => rootFingerprint(undefined), { name: 'TypeError' })
  assert.throws(() => createWorkspaceBinding({ ...BASE, canonicalRoot: '' }), { name: 'TypeError' })
})

test('binding construction refuses empty identity fields', () => {
  for (const field of ['workspaceId', 'projectId', 'sessionId']) {
    assert.throws(() => createWorkspaceBinding({ ...BASE, [field]: '' }), { name: 'TypeError' }, field)
    assert.throws(() => createWorkspaceBinding({ ...BASE, [field]: '   ' }), { name: 'TypeError' }, field)
  }
})

test('only the scholarflow mode is accepted', () => {
  assert.throws(() => createWorkspaceBinding({ ...BASE, modeId: 'standard' }), { name: 'TypeError' })
})

test('an unchanged observation reports no problem', () => {
  const { binding } = createWorkspaceBinding(BASE)
  assert.equal(describeBindingProblem(binding, { ...BASE }), null)
  assert.equal(describeBindingProblem(binding, {}), null)
})

test('each divergent component reports its own problem code', () => {
  const { binding } = createWorkspaceBinding(BASE)
  assert.equal(describeBindingProblem(binding, { workspaceId: 'ws-2' }), BindingProblem.WORKSPACE_CHANGED)
  assert.equal(describeBindingProblem(binding, { sessionId: 'sess-2' }), BindingProblem.SESSION_CHANGED)
  assert.equal(describeBindingProblem(binding, { projectId: 'prj_2' }), BindingProblem.PROJECT_CHANGED)
  assert.equal(describeBindingProblem(binding, { modeId: 'standard' }), BindingProblem.MODE_CHANGED)
  assert.equal(describeBindingProblem(binding, { canonicalRoot: 'D:\\project\\renamed' }), BindingProblem.ROOT_CHANGED)
})

test('a moved folder is caught by the fingerprint, not by the displayed name', () => {
  const { binding } = createWorkspaceBinding(BASE)
  // Same final segment, different parent: the folder was moved.
  const problem = describeBindingProblem(binding, { canonicalRoot: 'E:\\archive\\我的课程论文' })
  assert.equal(problem, BindingProblem.ROOT_CHANGED)
})

test('a missing binding is treated as a changed project rather than trusted', () => {
  assert.equal(describeBindingProblem(undefined, BASE), BindingProblem.PROJECT_CHANGED)
  assert.equal(describeBindingProblem(null, BASE), BindingProblem.PROJECT_CHANGED)
})

test('the binding key distinguishes sessions of one project', () => {
  const a = createWorkspaceBinding({ ...BASE, sessionId: 'sess-a' }).binding
  const b = createWorkspaceBinding({ ...BASE, sessionId: 'sess-b' }).binding
  assert.notEqual(bindingKey(a), bindingKey(b))
  assert.equal(bindingKey(a), 'ws-1::prj_1::sess-a')
})

test('two copies of one project in two workspaces are reported, not merged', () => {
  const original = createWorkspaceBinding({ ...BASE, workspaceId: 'ws-1', sessionId: 's1' }).binding
  const copy = createWorkspaceBinding({ ...BASE, workspaceId: 'ws-2', sessionId: 's2' }).binding
  const unrelated = createWorkspaceBinding({ ...BASE, projectId: 'prj_2', workspaceId: 'ws-3' }).binding

  const conflicts = findProjectIdConflicts([original, copy, unrelated])
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].projectId, 'prj_1')
  assert.deepEqual(conflicts[0].workspaceIds, ['ws-1', 'ws-2'])
  assert.deepEqual(conflicts[0].keys, ['ws-1::prj_1::s1', 'ws-2::prj_1::s2'])
})

test('several sessions of ONE project in one workspace are normal, not a conflict', () => {
  // PRD 5.4: Project -> Session A/B/C/D. This must never be reported as a copy.
  const sessions = ['s1', 's2', 's3', 's4'].map(
    (sessionId) => createWorkspaceBinding({ ...BASE, sessionId }).binding,
  )
  assert.deepEqual(findProjectIdConflicts(sessions), [])
})

test('conflict detection ignores entries without a projectId or workspaceId', () => {
  assert.deepEqual(findProjectIdConflicts([]), [])
  assert.deepEqual(findProjectIdConflicts([undefined, null, {}]), [])
  assert.deepEqual(findProjectIdConflicts([{ projectId: 'prj_1' }]), [])
  assert.deepEqual(findProjectIdConflicts([{ workspaceId: 'ws-1' }]), [])
})
