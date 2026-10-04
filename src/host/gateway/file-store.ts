import { join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { relativePath } from '../../shared/schema.ts'
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
    return this.ctx.fs.readBytes(await this.target(path), this.signal, maxBytes)
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
    await this.binding.revalidate()
    const target = await this.target(path, true)
    const resolved = await this.ctx.sessionController.resolveAgent(this.binding.sessionId)
    if (resolved.error) throw resolved.error
    const policy = this.ctx.sandboxPolicy.resolve({ session: resolved.agent.session })
    const outcome = await this.ctx.fs.writeText(target, text, expected ? { kind: 'replaceIfVersion', version: expected.version } : { kind: 'createIfAbsent' }, this.signal, policy)
    return { text, version: outcome.version }
  }
  async lock<T>(operation: () => Promise<T>): Promise<T> {
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
