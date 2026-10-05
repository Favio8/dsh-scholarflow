import { join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { relativePath } from '../../shared/schema.ts'
import { sensitivePath } from '../../core/materials/materials.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { type FileStore, type FileImage, type FileEntry, json } from '../../core/store/files.ts'

const bootInstance = randomUUID()
const queues = new Map<string, Promise<unknown>>()
type Host = any
export interface GatewayBinding {
  canonicalRoot: string
  manuscriptDir: string
  sessionId: string
  revalidate: () => Promise<void>
  readOnly?: boolean
}

export class HostFileStore implements FileStore {
  private ctx: Host
  private binding: GatewayBinding
  private signal: AbortSignal
  private insideLock = false
  constructor(ctx: Host, binding: GatewayBinding, signal: AbortSignal) { this.ctx = ctx; this.binding = binding; this.signal = signal }
  private async target(path: string, write = false) {
    if (path !== '') relativePath.parse(path)
    if (write) invariant(path.startsWith('.scholarflow/') || path.startsWith(this.binding.manuscriptDir + '/'), 'PATH_OUTSIDE_ALLOWED_ROOT', '写入范围必须是项目专属目录。')
    this.signal.throwIfAborted()
    const fs = this.ctx.fs
    const root = await fs.resolve(this.binding.canonicalRoot, { signal: this.signal })
    invariant(fs.processPath(root) === this.binding.canonicalRoot, 'SESSION_BINDING_CHANGED', '工作区的真实路径已改变。')
    const target = await fs.resolve(join(this.binding.canonicalRoot, path), { signal: this.signal })
    invariant(fs.contains(root, target), 'PATH_OUTSIDE_ALLOWED_ROOT', '符号链接或路径超出当前项目。')
    if (write) {
      // Canonical path must be inside the OWNED subdirectory as well as the root.
      const canonical = relative(fs.processPath(root), fs.processPath(target)).split(sep).join('/')
      invariant(canonical.startsWith('.scholarflow/') || canonical.startsWith(this.binding.manuscriptDir + '/'), 'PATH_OUTSIDE_ALLOWED_ROOT', '专属目录不能通过链接指向原始资料。')
    }
    return target
  }
  async read(path: string): Promise<FileImage | undefined> {
    if (!this.insideLock) await queues.get(this.binding.canonicalRoot)?.catch(() => undefined)
    const target = await this.target(path)
    const before = await this.ctx.fs.stat(target, this.signal)
    if (!before) return undefined
    invariant(before.type === 'file', 'FILE_NOT_REGULAR', '需要普通文件。')
    invariant(before.size <= 32 * 1024 * 1024, 'CONTENT_TOO_LARGE', '文件超过当前读取限额。')
    const bytes = await this.ctx.fs.readBytes(target, this.signal, 32 * 1024 * 1024)
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const after = await this.ctx.fs.stat(target, this.signal)
    invariant(before.version === after?.version, 'STALE_DOCUMENT_VERSION', '读取期间文件发生变化，请重试。')
    return { text, version: after.version }
  }
  async readBytes(path: string, maxBytes: number) {
    const target = await this.target(path)
    const canonical = relative(this.binding.canonicalRoot, this.ctx.fs.processPath(target)).split(sep).join('/')
    invariant(!sensitivePath(canonical) && !canonical.startsWith('.scholarflow/') && !canonical.startsWith(this.binding.manuscriptDir + '/'), 'MATERIAL_ACCESS_DENIED', '资料链接不能指向凭据、项目元数据或输出稿件。')
    const before = await this.ctx.fs.stat(target, this.signal)
    invariant(before?.type === 'file', 'FILE_NOT_REGULAR', '需要普通资料文件。')
    const bytes = await this.ctx.fs.readBytes(target, this.signal, maxBytes)
    invariant(before.version === (await this.ctx.fs.stat(target, this.signal))?.version, 'STALE_MATERIAL_VERSION', '读取期间原始资料发生变化。')
    return bytes
  }
  private async resourceTarget(path: string) {
    this.signal.throwIfAborted()
    relativePath.parse(path)
    invariant(path === '.scholarflow/skills' || path.startsWith('.scholarflow/skills/'), 'SKILL_RESOURCE_PATH_INVALID', '资源读取仅限本项目的私有 Skill 子树。')
    invariant(!sensitivePath(path), 'SKILL_RESOURCE_PATH_INVALID', '私有资源不能包含敏感路径。')
    let parent = this.binding.canonicalRoot
    // Read native inode/link metadata only: the installed SDK lstat contract
    // omits nlink. Actual content IO still uses the Host service and byte cap.
    for (const part of path.split('/')) {
      this.signal.throwIfAborted()
      parent = join(parent, part)
      let info
      try { info = await lstat(parent) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
      invariant(!info.isSymbolicLink() && (info.isDirectory() || info.isFile() && info.nlink === 1), 'SKILL_SOURCE_LINK', '项目资源包含链接、硬链接或特殊文件，未读取目标。')
    }
    const target = await this.target(path)
    const actual = this.ctx.fs.processPath(target), expected = join(this.binding.canonicalRoot, path)
    invariant(process.platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected, 'SKILL_SOURCE_LINK', '项目资源真实位置与专属子树路径不同。')
    return target
  }
  async resourceStat(path: string): Promise<FileEntry | undefined> {
    if (!this.insideLock) await queues.get(this.binding.canonicalRoot)?.catch(() => undefined)
    const target = await this.resourceTarget(path)
    if (!target) return undefined
    const row = await this.ctx.fs.stat(target, this.signal)
    return row ? { path, type: row.type === 'file' || row.type === 'directory' ? row.type : 'other', size: row.size } : undefined
  }
  async readResourceBytes(path: string, maxBytes: number) {
    if (!this.insideLock) await queues.get(this.binding.canonicalRoot)?.catch(() => undefined)
    invariant(path.split('/').length >= 5 && path.startsWith('.scholarflow/skills/'), 'SKILL_RESOURCE_PATH_INVALID', '资源内容必须位于命名空间与具体 Skill 目录下，不能读取阶段控制文件。')
    invariant(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 20 * 1024 * 1024, 'CONTENT_TOO_LARGE', '资源读取最多 20 MiB。')
    const target = await this.resourceTarget(path)
    invariant(target, 'SKILL_RESOURCE_MISSING', '项目固定资源缺失。')
    const before = await this.ctx.fs.stat(target, this.signal)
    invariant(before?.type === 'file' && before.size <= maxBytes, 'SKILL_RESOURCE_UNAVAILABLE', '项目资源不是限额内的普通文件。')
    const bytes = await this.ctx.fs.readBytes(target, this.signal, maxBytes)
    const final = await this.resourceTarget(path)
    invariant(final && before.version === (await this.ctx.fs.stat(final, this.signal))?.version && bytes.byteLength === before.size,
      'SKILL_SOURCE_CHANGED', '读取期间项目固定资源改变，未返回内容。')
    return bytes
  }
  async stat(path: string): Promise<FileEntry | undefined> {
    if (!this.insideLock) await queues.get(this.binding.canonicalRoot)?.catch(() => undefined)
    const result = await this.ctx.fs.stat(await this.target(path), this.signal)
    return result ? { path, type: result.type === 'file' || result.type === 'directory' ? result.type : 'other', size: result.size } : undefined
  }
  async list(path: string): Promise<FileEntry[]> {
    if (!this.insideLock) await queues.get(this.binding.canonicalRoot)?.catch(() => undefined)
    const entries = await this.ctx.fs.listDir(await this.target(path), this.signal)
    return entries.map((entry: Host) => ({ path: path ? `${path}/${entry.name}` : entry.name,
      type: ['file', 'directory'].includes(entry.type) ? entry.type : 'other', size: entry.size ?? 0 }))
  }
  async write(path: string, text: string, expected: FileImage | undefined): Promise<FileImage> {
    invariant(!this.binding.readOnly, 'PROJECT_READONLY', '诊断读取通道不允许写入。')
    await this.binding.revalidate()
    const target = await this.target(path, true)
    const resolved = await this.ctx.sessionController.resolveAgent(this.binding.sessionId)
    if (resolved.error) throw resolved.error
    const policy = this.ctx.sandboxPolicy.resolve({ session: resolved.agent.session })
    const outcome = await this.ctx.fs.writeText(target, text, expected ? { kind: 'replaceIfVersion', version: expected.version } : { kind: 'createIfAbsent' }, this.signal, policy)
    return { text, version: outcome.version }
  }
  async lock<T>(operation: () => Promise<T>): Promise<T> {
    invariant(!this.binding.readOnly, 'PROJECT_READONLY', '诊断读取通道不创建写锁或恢复元数据。')
    const key = this.binding.canonicalRoot
    const previous = queues.get(key) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(async () => {
      this.insideLock = true
      try {
      await this.binding.revalidate()
      const anchorPath = '.scholarflow/tmp/writer-owner.json'
      // Host filesystem authorization gates creation BEFORE native lock metadata.
      // No manuscript / ledger write is ever performed through node:fs.
      if (!await this.read(anchorPath)) {
        try { await this.write(anchorPath, json({ schemaVersion: 1, owner: process.pid, bootInstance, token: randomUUID() }), undefined) }
        catch (error) { if (!['FS_NOT_OBSERVED', 'FS_EXISTS'].includes((error as { code?: string }).code ?? '')) throw error }
      }
      const anchor = await this.target(anchorPath, true)
      const resolved = await this.ctx.sessionController.resolveAgent(this.binding.sessionId)
      if (resolved.error) throw resolved.error
      const policy = this.ctx.sandboxPolicy.resolve({ session: resolved.agent.session })
      invariant(policy.mode !== 'read-only', 'FS_SANDBOX_DENIED', '当前会话为只读，不能提交项目变更。')
      invariant(policy.workspaceRoot === this.binding.canonicalRoot || policy.mode === 'danger-full-access', 'PATH_OUTSIDE_ALLOWED_ROOT', '沙箱根与绑定工作区不一致。')
      try {
        return await withFileLock(this.ctx.fs.processPath(anchor), async () => {
          await this.binding.revalidate()
          const previousOwner = await this.read(anchorPath)
          await this.write(anchorPath, json({ schemaVersion: 1, owner: process.pid, bootInstance, token: randomUUID(), acquiredAt: new Date().toISOString() }), previousOwner)
          return operation()
        }, { waitMs: 2000 })
      } catch (error) {
        if ((error as Error).message.includes('timed out waiting')) throw new ScholarError('PROJECT_LOCKED', '其他进程持有项目写锁；未按时间戳抢占。')
        throw error
      }
      } finally { this.insideLock = false }
    })
    queues.set(key, pending)
    try { return await pending } finally { if (queues.get(key) === pending) queues.delete(key) }
  }
}
