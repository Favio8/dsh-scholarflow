/**
 * Path containment policy - Core layer, ZERO host dependencies.
 *
 * WHY THIS EXISTS (measured, docs/integration-verification.md G0-07.2):
 * the host's `ctx.fs.resolve()` is a pure path normalizer that performs NO
 * authorization. It happily resolved `..\..\Windows\win.ini`, an absolute
 * `C:\Windows\win.ini`, the reserved device name `CON`, and a sibling directory
 * whose name merely shares a prefix with the workspace root. Therefore SPEC 8.1
 * ("path checks must be based on the canonical root and real path relations,
 * not a startsWith() string comparison") must be implemented here.
 *
 * Contract of this module:
 *   - Inputs are ALREADY CANONICAL: the caller must have passed the root through
 *     the host's realpath-equivalent resolution first. This module never touches
 *     the filesystem, so it can be unit-tested offline and never guesses.
 *   - It answers containment and rejects spellings that are unsafe to interpret,
 *     rather than trying to repair them.
 *
 * It deliberately does NOT decide authorization. It answers "is this candidate
 * inside this root", which the FileGateway then combines with the user's
 * explicit output-directory approval.
 */

/** Device names Windows reserves in every directory, with or without extension. */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

/** Long-path and device-namespace prefixes that change how a path is interpreted. */
const DEVICE_PREFIXES = ['\\\\?\\', '\\\\.\\', '\\??\\']

/** @param {string} value */
function isWindowsAbsolute(value) {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value)
}

/**
 * Split a path into meaningful segments.
 * Returns `null` for spellings this policy refuses to interpret.
 *
 * @param {string} value
 * @returns {{ segments: string[], absolute: boolean, caseInsensitive: boolean } | { error: string }}
 */
export function splitPath(value) {
  if (typeof value !== 'string') return { error: 'PATH_NOT_A_STRING' }
  if (value.length === 0) return { error: 'PATH_EMPTY' }
  if (value.includes('\0')) return { error: 'PATH_HAS_NUL' }

  for (const prefix of DEVICE_PREFIXES) {
    if (value.startsWith(prefix)) return { error: 'PATH_DEVICE_NAMESPACE' }
  }

  const absolute = isWindowsAbsolute(value)
  const caseInsensitive = isWindowsAbsolute(value) || value.includes('\\')

  // Both separators are accepted because a mixed spelling appears in real
  // configuration; anything else is preserved verbatim.
  const rawSegments = value.split(/[\\/]+/)
  const segments = []
  for (const segment of rawSegments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) {
        // A traversal above the root cannot be interpreted safely.
        if (absolute) return { error: 'PATH_ESCAPES_ROOT' }
        return { error: 'PATH_RELATIVE_PARENT' }
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return { segments, absolute, caseInsensitive }
}

/**
 * True when `candidate` is the same path as, or lies strictly inside, `root`.
 *
 * Comparison is segment-wise, so `/a/b` does NOT contain `/a/b-other`.
 * Relative roots are refused because containment against a relative root would
 * depend on an unstated working directory.
 *
 * @param {string} root
 * @param {string} candidate
 * @param {{ caseInsensitive?: boolean }} [options]
 */
export function isInsideRoot(root, candidate, options = {}) {
  const rootParts = splitPath(root)
  const candidateParts = splitPath(candidate)
  if ('error' in rootParts) return { inside: false, reason: `ROOT_${rootParts.error}` }
  if ('error' in candidateParts) return { inside: false, reason: candidateParts.error }
  if (!rootParts.absolute) return { inside: false, reason: 'ROOT_NOT_ABSOLUTE' }
  if (!candidateParts.absolute) return { inside: false, reason: 'CANDIDATE_NOT_ABSOLUTE' }

  const sensitive = options.caseInsensitive ?? (rootParts.caseInsensitive || candidateParts.caseInsensitive)
  const fold = (segment) => (sensitive ? segment.toLowerCase() : segment)
  const rootKey = rootParts.segments.map(fold)
  const candidateKey = candidateParts.segments.map(fold)

  if (rootKey.length === 0) return { inside: false, reason: 'ROOT_HAS_NO_SEGMENTS' }
  if (candidateKey.length < rootKey.length) {
    return { inside: false, reason: 'CANDIDATE_OUTSIDE_ROOT' }
  }
  for (let index = 0; index < rootKey.length; index += 1) {
    if (rootKey[index] !== candidateKey[index]) {
      return { inside: false, reason: 'CANDIDATE_OUTSIDE_ROOT' }
    }
  }
  return {
    inside: true,
    reason: candidateKey.length === rootKey.length ? 'CANDIDATE_IS_ROOT' : 'CANDIDATE_INSIDE_ROOT',
    relativeSegments: candidateParts.segments.slice(rootParts.segments.length),
  }
}

/**
 * Validate a path a caller wants to create or write, relative to `root`.
 *
 * This is the gate the FileGateway uses for `manuscript/` and `.scholarflow/`
 * writes: the path must stay inside the canonical root and must not use a
 * spelling that Windows would reinterpret.
 *
 * @param {string} root canonical, absolute
 * @param {string} candidate
 * @param {{ caseInsensitive?: boolean, allowReservedDeviceNames?: boolean }} [options]
 */
export function checkWritablePath(root, candidate, options = {}) {
  const containment = isInsideRoot(root, candidate, options)
  if (!containment.inside) return { allowed: false, code: 'PATH_OUTSIDE_ALLOWED_ROOT', ...containment }

  if (options.allowReservedDeviceNames !== true) {
    for (const segment of containment.relativeSegments) {
      const bare = segment.split('.')[0]
      if (RESERVED_DEVICE_NAMES.has(bare.toLowerCase())) {
        return { allowed: false, code: 'PATH_RESERVED_DEVICE_NAME', segment }
      }
      // Windows silently strips trailing dots and spaces, which makes two
      // different-looking paths address the same file.
      if (/[ .]$/.test(segment)) {
        return { allowed: false, code: 'PATH_TRAILING_DOT_OR_SPACE', segment }
      }
    }
  }

  if (containment.relativeSegments.length === 0) {
    return { allowed: false, code: 'PATH_IS_ROOT_ITSELF' }
  }

  return { allowed: true, code: 'PATH_ALLOWED', relativeSegments: containment.relativeSegments }
}
