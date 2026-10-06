import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { digest } from '../../core/store/files.ts'
import { sensitivePath } from '../../core/materials/materials.ts'
import { invariant } from '../../shared/errors.ts'

const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const excluded = (path: string) => sensitivePath(path) || path.split('/').some(part => ['.git', '.hg', '.svn', 'node_modules'].includes(part.toLowerCase()))
const contained = (root: string, path: string) => { const subpath = relative(root, path); return subpath !== '..' && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath) }

/** Members one external source may offer, and how deep a chosen folder is walked. */
export const MAX_EXTERNAL_MEMBERS = 200
const MAX_EXTERNAL_DEPTH = 8
const MAX_EXTERNAL_ENTRIES = 2000
/** Bytes one external member may contribute, matching the workspace read cap. */
export const MAX_EXTERNAL_BYTES = 50 * 1024 * 1024
/** A handle is a session-scoped grant; re-selection is required once it lapses (SPEC v1.1 §7.2). */
export const EXTERNAL_HANDLE_TTL_MS = 30 * 60 * 1000

/**
 * What a member looks like to the client, matching `requirementSourceMember`. `name` is
 * relative to the chosen root, never an absolute path: the host keeps the absolute root and
 * the client only ever sees these names. The client derives readable/image/unsupported from
 * the extension, exactly as it does for workspace members.
 */
export type ExternalMember = { name: string; size: number }

/** Decided by extension only, exactly like a workspace requirement source. */
export function externalMemberKind(name: string): 'readable' | 'image' | 'unsupported' {
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return 'image'
  if (/\.(pdf|docx|md|markdown|txt|html?)$/i.test(name)) return 'readable'
  return 'unsupported'
}

/**
 * A requirement source the operator chose outside the workspace, read on their own
 * authority and never written to. The shape follows `LocalSkillSource`: the operator's
 * pick is the whole authorisation, the canonical root is captured once, and every later
 * access re-checks containment, refuses links, and stays inside a bounded walk.
 *
 * The absolute root stays on this side. Callers receive `resourceId` and `handle` only,
 * so no project field, log line or model prompt ever carries where the file lives.
 */
export class ExternalRequirementSource {
  readonly root: string
  readonly kind: 'file' | 'folder'
  readonly fingerprint: string
  private constructor(root: string, kind: 'file' | 'folder', fingerprint: string) {
    this.root = root
    this.kind = kind
    this.fingerprint = fingerprint
  }

  static async open(path: string, kind: 'file' | 'folder') {
    invariant(typeof path === 'string' && path.length <= 4000 && isAbsolute(path) && !path.includes('\0'),
      'EXTERNAL_SOURCE_INVALID', '请选择 Host 上的绝对路径。')
    const selected = resolve(path)
    const info = await lstat(selected)
    invariant(!info.isSymbolicLink(), 'EXTERNAL_SOURCE_LINK', '外部来源不能是链接，未读取链接目标。')
    invariant(kind === 'folder' ? info.isDirectory() : info.isFile() && info.nlink === 1,
      'EXTERNAL_SOURCE_INVALID', kind === 'folder' ? '外部来源必须是普通文件夹。' : '外部来源必须是普通文件。')
    const root = await realpath(selected)
    return new ExternalRequirementSource(root, kind, digest(process.platform === 'win32' ? root.toLowerCase() : root))
  }

  private async checked(path: string, kind: 'file' | 'directory') {
    invariant(contained(this.root, path), 'EXTERNAL_SOURCE_INVALID', '外部来源路径超出所选范围。')
    const info = await lstat(path)
    invariant(!info.isSymbolicLink(), 'EXTERNAL_SOURCE_LINK', '外部来源含链接，未读取链接目标。')
    invariant(kind === 'file' ? info.isFile() && info.nlink === 1 : info.isDirectory(),
      'EXTERNAL_SOURCE_INVALID', kind === 'file' ? '外部来源成员必须是普通文件。' : '外部来源成员必须是普通文件夹。')
    // A path that resolves elsewhere is a link in disguise, whatever lstat reported.
    invariant(same(await realpath(path), path), 'EXTERNAL_SOURCE_LINK', '外部来源路径经由链接指向别处，未读取。')
    return info
  }

  /**
   * The members this source offers. A chosen file offers itself; a chosen folder is walked
   * to a bounded depth so a folder of assignment files works without exposing a whole disk.
   * Excluded and linked entries are skipped with a diagnostic rather than silently dropped.
   */
  async list(signal: AbortSignal): Promise<{ members: ExternalMember[]; truncated: boolean; diagnostics: string[] }> {
    if (this.kind === 'file') {
      const info = await this.checked(this.root, 'file')
      return { members: [{ name: basename(this.root), size: info.size }], truncated: false, diagnostics: [] }
    }
    await this.checked(this.root, 'directory')
    const members: ExternalMember[] = [], diagnostics: string[] = []
    let entries = 0, truncated = false
    const walk = async (directory: string, prefix: string, depth: number) => {
      signal.throwIfAborted()
      if (truncated) return
      await this.checked(directory, 'directory')
      const rows = await readdir(directory, { withFileTypes: true })
      for (const entry of rows) {
        signal.throwIfAborted()
        if (members.length >= MAX_EXTERNAL_MEMBERS || ++entries > MAX_EXTERNAL_ENTRIES) { truncated = true; return }
        const name = prefix ? `${prefix}/${entry.name}` : entry.name
        if (excluded(name)) { diagnostics.push('已跳过敏感文件或版本控制、依赖目录。'); continue }
        if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) { diagnostics.push('已跳过链接或特殊文件。'); continue }
        if (entry.isDirectory()) {
          if (depth + 1 > MAX_EXTERNAL_DEPTH) { diagnostics.push('目录层级过深，未继续展开。'); continue }
          await walk(join(directory, entry.name), name, depth + 1)
          continue
        }
        const info = await this.checked(join(directory, entry.name), 'file')
        members.push({ name, size: info.size })
      }
    }
    await walk(this.root, '', 0)
    return { members, truncated, diagnostics: [...new Set(diagnostics)] }
  }

  /**
   * Read one member, bounded and re-checked around the read so a file swapped mid-read is
   * refused instead of contributing bytes that no longer match what was confirmed.
   */
  async read(name: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const parts = name.split('/')
    invariant(parts.length > 0 && parts.length <= MAX_EXTERNAL_DEPTH + 1 && parts.every(part => part && part !== '.' && part !== '..'),
      'EXTERNAL_SOURCE_INVALID', '外部来源成员名不合法。')
    // Listing already skips these, and a caller that names one anyway is refused here too: the
    // confirmed member list is the contract, not the only place a name can come from.
    invariant(!excluded(name), 'EXTERNAL_SOURCE_INVALID', '敏感文件或依赖目录不读取。')
    // A file source is its own member: the name must be that file, never a path below it.
    if (this.kind === 'file') {
      invariant(parts.length === 1 && same(parts[0], basename(this.root)), 'EXTERNAL_SOURCE_INVALID', '外部来源成员名不合法。')
      return this.readAt(this.root, signal)
    }
    let path = this.root
    // Every segment is re-checked on the way down, so a link swapped in below the chosen root
    // is refused before its target is opened; only the last segment is the file itself.
    for (const [index, part] of parts.entries()) {
      path = join(path, part)
      await this.checked(path, index === parts.length - 1 ? 'file' : 'directory')
    }
    return this.readAt(path, signal)
  }

  private async readAt(path: string, signal: AbortSignal) {
    const before = await this.checked(path, 'file')
    invariant(before.size <= MAX_EXTERNAL_BYTES, 'EXTERNAL_SOURCE_TOO_LARGE', '外部来源文件超出 50 MiB 上限。')
    const bytes = new Uint8Array(await readFile(path))
    signal.throwIfAborted()
    const after = await this.checked(path, 'file')
    invariant(bytes.byteLength === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino,
      'EXTERNAL_SOURCE_CHANGED', '读取期间外部来源发生变化，请重新选择后再整理要求。')
    return bytes
  }
}
