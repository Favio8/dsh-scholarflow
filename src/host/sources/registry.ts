import { newId } from '../../core/store/files.ts'
import { invariant } from '../../shared/errors.ts'
import { ExternalRequirementSource, externalMemberKind, EXTERNAL_HANDLE_TTL_MS, type ExternalMember } from './external.ts'

/** The picker capability the host serves; only the native chooser can reach outside a workspace. */
export type NativePicker = { kind: 'native'; pick(signal: AbortSignal): Promise<string | null> }

export type PickedExternal = { cancelled: false; handle: string; resourceId: string; kind: 'file' | 'folder'
  members: ExternalMember[]; readableCount: number; truncated: boolean; diagnostics: string[]; expiresAt: string }
export type PickResult = PickedExternal | { cancelled: true }

/**
 * Session-scoped read grants for folders the operator chose outside the workspace.
 *
 * The registry is the only place the absolute root is held. Callers get an opaque handle and
 * member names, so no project field, log line or model prompt carries the location, and a
 * grant can be withdrawn by dropping it. Grants belong to the operator who made them and
 * lapse on their own, which is what makes "reconnect" a normal state rather than an error.
 */
export class ExternalSourceRegistry {
  private rows = new Map<string, { source: ExternalRequirementSource; operator: string; expires: number }>()

  private prune() { const now = Date.now(); for (const [handle, row] of this.rows) if (row.expires <= now) this.rows.delete(handle) }

  clear() { this.rows.clear() }

  /**
   * One explicit operator action is the whole authorisation: the OS chooser decides the scope,
   * and this folder becomes readable — nothing above it, and nothing written.
   */
  async pick(picker: NativePicker | undefined, operator: string, signal: AbortSignal): Promise<PickResult> {
    this.prune()
    invariant(picker?.kind === 'native', 'EXTERNAL_PICKER_UNAVAILABLE', '当前 Host 没有原生目录选择器；外部来源需要在本机桌面版选择。')
    const picked = await picker.pick(signal)
    if (!picked) return { cancelled: true }
    const source = await ExternalRequirementSource.open(picked, 'folder')
    const listing = await source.list(signal)
    // A folder nothing can parse would read as success and then contribute nothing, so it is
    // refused with the reason instead of becoming an empty source the user has to debug.
    const readableCount = listing.members.filter(member => externalMemberKind(member.name) !== 'unsupported').length
    invariant(listing.members.length > 0, 'EXTERNAL_SOURCE_EMPTY', '所选文件夹里没有文件。')
    invariant(readableCount > 0, 'EXTERNAL_SOURCE_UNREADABLE', '所选文件夹里没有可读取的要求文件（支持 pdf/docx/md/txt/html 与图片）。')
    invariant(this.rows.size < 8, 'TOO_MANY_PENDING_PLANS', '请先移除已有的外部来源再添加。')
    const handle = newId('external_source'), expires = Date.now() + EXTERNAL_HANDLE_TTL_MS
    this.rows.set(handle, { source, operator, expires })
    return { cancelled: false, handle, resourceId: `req_${source.fingerprint.slice(7, 23)}`, kind: source.kind,
      members: listing.members, readableCount, truncated: listing.truncated, diagnostics: listing.diagnostics,
      expiresAt: new Date(expires).toISOString() }
  }

  /** The live grant for this handle and operator, or undefined when it lapsed or was never theirs. */
  resolve(handle: string, operator: string) {
    this.prune()
    const row = this.rows.get(handle)
    return row && row.operator === operator ? row.source : undefined
  }

  /** Which restored handles are still live, so the wizard can say "需重连" instead of guessing. */
  status(handles: string[], operator: string) {
    this.prune()
    return { live: handles.filter(handle => this.resolve(handle, operator)) }
  }
}
