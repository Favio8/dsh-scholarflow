import { digest } from '../store/files.ts'
import type { CreationSpec, RequirementSource } from '../../shared/writing-task.ts'

// Read-time compatibility for stored projects (SPEC v1.1 §13). Nothing here writes:
// opening an old project must not migrate it. The new fields win when present; a
// project that only carries the old single assignment file is interpreted in memory.

/** New sources when present; otherwise the old single assignment file becomes one source. */
export function readRequirementSources(spec: CreationSpec): RequirementSource[] {
  if (spec.requirementSources.length) return spec.requirementSources
  if (!spec.assignmentPath) return []
  return [{ resourceId: `req_${digest(spec.assignmentPath).slice(7, 23)}`, origin: 'workspace', kind: 'file',
    path: spec.assignmentPath, members: [], role: 'assignment', state: 'selected' }]
}

/**
 * What this run may read: the union of the requirement sources the user added and the
 * reference materials they ticked. The two are independent — neither implies the other.
 */
export function readApproval(spec: CreationSpec) {
  const sources = readRequirementSources(spec)
  const paths = new Set<string>(spec.materials)
  for (const source of sources) {
    if (source.origin !== 'workspace') continue
    if (source.path) paths.add(source.path)
    if (source.kind === 'folder') for (const member of source.members) paths.add(member.name)
  }
  return { sources, materials: [...spec.materials], paths: [...paths] }
}

/** Files a folder source contributes, in the order they were confirmed. */
export function folderMembers(spec: CreationSpec) {
  return readRequirementSources(spec).filter(source => source.kind === 'folder')
    .flatMap(source => source.members.map(member => member.name))
}

/** The length unit follows the paper's language unless the user chose otherwise. */
export function countingUnit(spec: CreationSpec) { return spec.countingPolicy.unit ?? spec.language }

/** True when the project still relies on the pre-requirementSources shape. */
export function usesLegacyAssignment(spec: CreationSpec) {
  return spec.requirementSources.length === 0 && !!spec.assignmentPath
}
