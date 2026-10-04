/**
 * FileGateway boundary tests for the Core path-containment policy.
 *
 * Offline and deterministic on purpose: SPEC ADR-002 requires the file-semantics
 * layer to be testable without DSH, React or a model SDK. These cases follow the
 * boundary list in SPEC 28.2 (same-prefix directories, `..`, Windows drive
 * letters, UNC, case, reserved names, symlinks, Chinese filenames, CRLF).
 *
 * Run:  node --test tests/unit
 *
 * NOTE ON SYMLINKS: this policy cannot detect them by design - it never touches
 * the filesystem, so the caller must canonicalize through the host's realpath
 * first. The symlink case here asserts the CONTRACT (a symlink target that
 * escapes the root is rejected once canonicalized), not filesystem behaviour.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkWritablePath, isInsideRoot, splitPath } from '../../src/core/paths/containment.js'

const ROOT = 'D:\\project\\我的课程论文'

test('sibling directory sharing a prefix is NOT inside the root', () => {
  const result = isInsideRoot(ROOT, 'D:\\project\\我的课程论文-other')
  assert.equal(result.inside, false)
  assert.equal(result.reason, 'CANDIDATE_OUTSIDE_ROOT')
})

test('a path built with .. that stays inside is accepted', () => {
  const result = isInsideRoot(ROOT, `${ROOT}\\manuscript\\..\\manuscript\\paper.md`)
  assert.equal(result.inside, true)
  assert.deepEqual(result.relativeSegments, ['manuscript', 'paper.md'])
})

test('a path that escapes the root through .. is rejected', () => {
  const result = isInsideRoot('D:\\project', 'D:\\project\\..\\Windows\\win.ini')
  assert.equal(result.inside, false)
})

test('traversal above a drive root cannot be interpreted', () => {
  const result = splitPath('D:\\..\\..\\secret')
  assert.equal(result.error, 'PATH_ESCAPES_ROOT')
})

test('an absolute path on another drive is rejected', () => {
  const result = isInsideRoot(ROOT, 'C:\\Windows\\win.ini')
  assert.equal(result.inside, false)
})

test('a UNC candidate is not accepted as inside a drive root', () => {
  const result = isInsideRoot(ROOT, '\\\\server\\share\\paper.md')
  assert.equal(result.inside, false)
})

test('the device namespace is refused outright', () => {
  for (const candidate of ['\\\\?\\C:\\Windows\\win.ini', '\\\\.\\PhysicalDrive0']) {
    assert.equal(splitPath(candidate).error, 'PATH_DEVICE_NAMESPACE')
    assert.equal(isInsideRoot(ROOT, candidate).inside, false)
  }
})

test('reserved device names are refused as write targets', () => {
  for (const name of ['CON', 'nul', 'LPT1', 'com9', 'aux.txt']) {
    const result = checkWritablePath(ROOT, `${ROOT}\\manuscript\\${name}`)
    assert.equal(result.allowed, false, `${name} must be refused`)
    assert.equal(result.code, 'PATH_RESERVED_DEVICE_NAME')
  }
})

test('trailing dots and spaces are refused because Windows strips them', () => {
  for (const name of ['paper.md.', 'notes ', 'draft. ']) {
    const result = checkWritablePath(ROOT, `${ROOT}\\manuscript\\${name}`)
    assert.equal(result.allowed, false, `${JSON.stringify(name)} must be refused`)
    assert.equal(result.code, 'PATH_TRAILING_DOT_OR_SPACE')
  }
})

test('Chinese path segments round-trip without loss', () => {
  const result = checkWritablePath(ROOT, `${ROOT}\\manuscript\\初稿 - 副本.md`)
  assert.equal(result.allowed, true)
  assert.deepEqual(result.relativeSegments, ['manuscript', '初稿 - 副本.md'])
})

test('emoji and combining characters are preserved as opaque segments', () => {
  const result = checkWritablePath(ROOT, `${ROOT}\\manuscript\\draft-🧪-e\u0301.md`)
  assert.equal(result.allowed, true)
  assert.equal(result.relativeSegments[1], 'draft-🧪-e\u0301.md')
})

test('case-insensitive comparison applies to Windows spellings', () => {
  const insensitive = isInsideRoot(ROOT, 'd:\\PROJECT\\我的课程论文\\paper.md')
  assert.equal(insensitive.inside, true)

  const sensitive = isInsideRoot(ROOT, 'd:\\PROJECT\\我的课程论文\\paper.md', { caseInsensitive: false })
  assert.equal(sensitive.inside, false)
})

test('a forward-slash spelling of the same path is accepted', () => {
  const result = isInsideRoot(ROOT, `${ROOT.replace(/\\/g, '/')}/manuscript/paper.md`)
  assert.equal(result.inside, true)
})

test('the root itself is inside the root but is not a writable target', () => {
  assert.equal(isInsideRoot(ROOT, ROOT).inside, true)
  assert.equal(isInsideRoot(ROOT, ROOT).reason, 'CANDIDATE_IS_ROOT')
  assert.equal(checkWritablePath(ROOT, ROOT).code, 'PATH_IS_ROOT_ITSELF')
})

test('a relative root is refused rather than resolved against a guessed cwd', () => {
  const result = isInsideRoot('project', 'project\\paper.md')
  assert.equal(result.inside, false)
  assert.equal(result.reason, 'ROOT_NOT_ABSOLUTE')
})

test('a relative candidate is refused', () => {
  const result = isInsideRoot(ROOT, 'manuscript\\paper.md')
  assert.equal(result.inside, false)
  assert.equal(result.reason, 'CANDIDATE_NOT_ABSOLUTE')
})

test('empty, NUL-bearing and non-string inputs are refused, not thrown on', () => {
  assert.equal(splitPath('').error, 'PATH_EMPTY')
  assert.equal(splitPath('a\0b').error, 'PATH_HAS_NUL')
  assert.equal(splitPath(undefined).error, 'PATH_NOT_A_STRING')
  assert.equal(splitPath(42).error, 'PATH_NOT_A_STRING')
})

test('a canonical symlink target that escapes the root is rejected', () => {
  // The gateway canonicalizes first (realpath), so containment is decided on the
  // TARGET path. This is the contract the FileGateway must honour.
  const target = 'D:\\elsewhere\\secret.md'
  const result = checkWritablePath(ROOT, target)
  assert.equal(result.allowed, false)
  assert.equal(result.code, 'PATH_OUTSIDE_ALLOWED_ROOT')
})

test('the intended project writes are allowed', () => {
  const allowed = [
    `${ROOT}\\.scholarflow\\project.yaml`,
    `${ROOT}\\.scholarflow\\data\\ledger.json`,
    `${ROOT}\\manuscript\\paper.md`,
    `${ROOT}\\manuscript\\references.bib`,
    `${ROOT}\\manuscript\\exports\\delivery-01\\paper.md`,
  ]
  for (const candidate of allowed) {
    const result = checkWritablePath(ROOT, candidate)
    assert.equal(result.allowed, true, `${candidate} should be allowed`)
  }
})
