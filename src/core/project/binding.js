/**
 * Workspace binding - Core layer, zero host dependencies.
 *
 * Implements the `WorkspaceBinding` contract of SPEC 5.2 and the re-verification
 * rules that go with it:
 *
 *   "The server re-verifies sessionId -> workspaceId -> projectId on every write
 *    request. A projectId submitted by the browser is a request field, never an
 *    authorization basis."  (SPEC 5.2)
 *
 * Two properties this module exists to guarantee:
 *
 *   1. `canonicalRoot` NEVER leaves the Host. The exported binding carries only
 *      `rootFingerprint`, so nothing that serializes a binding can leak a user's
 *      absolute path (SPEC 5.1: canonicalRoot "只保留在 Host").
 *   2. Identity is compared by explicit components, so a copied project, a
 *      rebound session and a moved folder are distinguished instead of being
 *      silently treated as the same object.
 */

import { createHash } from 'node:crypto'

export const BINDING_SCHEMA_VERSION = 1

/** Problem codes callers may surface; they map onto SPEC 24.2's error vocabulary. */
export const BindingProblem = Object.freeze({
  WORKSPACE_CHANGED: 'BINDING_WORKSPACE_CHANGED',
  SESSION_CHANGED: 'BINDING_SESSION_CHANGED',
  ROOT_CHANGED: 'BINDING_ROOT_CHANGED',
  PROJECT_CHANGED: 'BINDING_PROJECT_CHANGED',
  MODE_CHANGED: 'BINDING_MODE_CHANGED',
  PROJECT_IS_COPY: 'PROJECT_ID_CONFLICT',
})

/** @param {unknown} value */
function requireNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value
}

/**
 * Fingerprint of a canonical root.
 *
 * The host must pass an already-canonicalized (realpath-resolved) absolute path.
 * Trailing separators and separator style are folded so two spellings of the same
 * directory yield the same fingerprint - deciding whether two paths are the same
 * directory is NOT this function's job (that is `fs.contains` / realpath).
 *
 * @param {string} canonicalRoot
 * @returns {string} `sha256:<64 hex>`
 */
export function rootFingerprint(canonicalRoot) {
  const root = requireNonEmpty(canonicalRoot, 'canonicalRoot')
  const folded = root.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
  return `sha256:${createHash('sha256').update(folded, 'utf8').digest('hex')}`
}

/**
 * Build a binding plus the Host-only companion value.
 *
 * @param {{ workspaceId: string, projectId: string, sessionId: string, canonicalRoot: string, modeId?: string }} input
 * @returns {{ binding: Readonly<{schemaVersion:number, workspaceId:string, projectId:string, sessionId:string, modeId:string, rootFingerprint:string}>, hostOnly: Readonly<{canonicalRoot:string}> }}
 */
export function createWorkspaceBinding(input) {
  const modeId = input.modeId ?? 'scholarflow'
  if (modeId !== 'scholarflow') throw new TypeError('modeId must be scholarflow')

  const binding = Object.freeze({
    schemaVersion: BINDING_SCHEMA_VERSION,
    workspaceId: requireNonEmpty(input.workspaceId, 'workspaceId'),
    projectId: requireNonEmpty(input.projectId, 'projectId'),
    sessionId: requireNonEmpty(input.sessionId, 'sessionId'),
    modeId,
    rootFingerprint: rootFingerprint(input.canonicalRoot),
  })

  // Intentionally NOT part of `binding`: the absolute path stays host-side.
  const hostOnly = Object.freeze({ canonicalRoot: input.canonicalRoot })
  return { binding, hostOnly }
}

/** Stable key for in-process indexing; not an authorization token. */
export function bindingKey(binding) {
  return `${binding.workspaceId}::${binding.projectId}::${binding.sessionId}`
}

/**
 * Re-verify a stored binding against the facts the host just observed.
 *
 * @param {ReturnType<typeof createWorkspaceBinding>['binding']} binding
 * @param {{ workspaceId?: string, sessionId?: string, canonicalRoot?: string, projectId?: string, modeId?: string }} observed
 * @returns {string | null} a `BindingProblem` value, or null when still valid
 */
export function describeBindingProblem(binding, observed = {}) {
  if (!binding || typeof binding !== 'object') return BindingProblem.PROJECT_CHANGED

  if (observed.workspaceId !== undefined && observed.workspaceId !== binding.workspaceId) {
    return BindingProblem.WORKSPACE_CHANGED
  }
  if (observed.sessionId !== undefined && observed.sessionId !== binding.sessionId) {
    return BindingProblem.SESSION_CHANGED
  }
  if (observed.projectId !== undefined && observed.projectId !== binding.projectId) {
    return BindingProblem.PROJECT_CHANGED
  }
  if (observed.modeId !== undefined && observed.modeId !== binding.modeId) {
    return BindingProblem.MODE_CHANGED
  }
  if (observed.canonicalRoot !== undefined && rootFingerprint(observed.canonicalRoot) !== binding.rootFingerprint) {
    return BindingProblem.ROOT_CHANGED
  }
  return null
}

/**
 * Detect two DIFFERENT workspaces claiming the same projectId in one host.
 *
 * SPEC 5.2 requires this to be surfaced as a copy rather than silently merged
 * into one write-lock object. The discriminator is the workspace, not the
 * session: PRD 5.4 has one project legitimately spread across many sessions
 * (Session A/B/C/D), so several sessions of the SAME workspace are normal and
 * must NOT be reported. A copied folder is a different directory, hence a
 * different workspace registration.
 *
 * @param {readonly ReturnType<typeof createWorkspaceBinding>['binding'][]} bindings
 * @returns {Array<{ projectId: string, workspaceIds: string[], keys: string[] }>}
 */
export function findProjectIdConflicts(bindings = []) {
  const byProject = new Map()
  for (const binding of bindings) {
    if (!binding?.projectId || !binding?.workspaceId) continue
    const list = byProject.get(binding.projectId) ?? []
    list.push(binding)
    byProject.set(binding.projectId, list)
  }

  const conflicts = []
  for (const [projectId, group] of byProject.entries()) {
    const workspaceIds = [...new Set(group.map((binding) => binding.workspaceId))]
    if (workspaceIds.length > 1) {
      conflicts.push({
        projectId,
        workspaceIds: workspaceIds.sort(),
        keys: group.map(bindingKey).sort(),
      })
    }
  }
  return conflicts
}
