export interface ScratchEdit { text: string; baseHash: string }
export interface ScratchStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

// Browser copies are uncommitted user drafts. They never authorize a manuscript
// or memory write and contain no filesystem paths, credentials or model input.
export function scratchKey(binding: { rootFingerprint: string; projectId: string; sessionId: string }, documentId: string) {
  return `sf-scratch:v1:${binding.rootFingerprint}:${binding.projectId}:${binding.sessionId}:${documentId}`
}
export function readScratch(storage: ScratchStorage, key: string, maxBytes: number): ScratchEdit | undefined {
  const raw = storage.getItem(key)
  if (!raw || raw.length > maxBytes * 6 + 1024) return
  const row = JSON.parse(raw)
  if (row?.schemaVersion !== 1 || row.scopeKey !== key || typeof row.text !== 'string' || !row.text.isWellFormed() ||
    new TextEncoder().encode(row.text).byteLength > maxBytes || !/^sha256:[a-f0-9]{64}$/u.test(row.baseHash)) return
  return { text: row.text, baseHash: row.baseHash }
}
export function writeScratch(storage: ScratchStorage, key: string, value: ScratchEdit | undefined, maxBytes: number) {
  if (!value) { storage.removeItem(key); return }
  if (!value.text.isWellFormed() || new TextEncoder().encode(value.text).byteLength > maxBytes || !/^sha256:[a-f0-9]{64}$/u.test(value.baseHash))
    throw new Error('未提交编辑超过备份限额或包含未完成的 Unicode 字符。')
  storage.setItem(key, JSON.stringify({ schemaVersion: 1, scopeKey: key, ...value }))
}

// One request in flight, one latest pending edit. A failed/ambiguous response
// stops dispatch; only an explicit reread can establish a new CAS preimage.
export class ScratchQueue<T> {
  private pending?: T
  private working = false
  private task = Promise.resolve()
  blocked = false
  private write: (value: T) => Promise<void>
  private failed: (error: unknown) => void
  constructor(write: (value: T) => Promise<void>, failed: (error: unknown) => void) { this.write = write; this.failed = failed }
  enqueue(value: T) { this.pending = value; if (!this.working && !this.blocked) this.task = this.drain() }
  private async drain() {
    this.working = true
    try {
      while (this.pending !== undefined && !this.blocked) {
        const value = this.pending; this.pending = undefined
        await this.write(value)
      }
    } catch (error) { this.blocked = true; this.failed(error) }
    finally { this.working = false }
  }
  // Reread does not submit the old pending edit automatically.
  reset() { if (this.working) throw new Error('先等待正在进行的暂存请求结束。'); this.pending = undefined; this.blocked = false }
  async flush() { await this.task; if (this.blocked) throw new Error('暂存请求未确认完成，请先重读并比较宿主缓冲。') }
  get busy() { return this.working }
}
