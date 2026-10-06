// TEST_ONLY: fault-injectable filesystem. This is never a live project / source.
import { ScholarError } from '../../src/shared/errors.ts'
import { type FileStore, type FileImage, type FileEntry } from '../../src/core/store/files.ts'
export class MemoryStore implements FileStore {
  files = new Map<string, FileImage>()
  writes = 0
  private tail: Promise<unknown> = Promise.resolve()
  constructor(initial: Record<string, string> = {}) {
    for (const [path, text] of Object.entries(initial)) this.files.set(path, { text, version: `initial-${path}` })
  }
  async read(path: string) { const image = this.files.get(path); return image && { ...image } }
  async readBytes(path: string, maxBytes: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const image = this.files.get(path)
    if (!image) throw new ScholarError('FILE_NOT_FOUND', 'TEST_ONLY missing file')
    const bytes = new TextEncoder().encode(image.text)
    if (bytes.length > maxBytes) throw new ScholarError('CONTENT_TOO_LARGE', 'TEST_ONLY too large')
    return bytes
  }
  async stat(path: string): Promise<FileEntry | undefined> {
    const file = this.files.get(path)
    if (file) return { path, type: 'file', size: Buffer.byteLength(file.text) }
    if (!path || [...this.files.keys()].some(key => key.startsWith(path + '/'))) return { path, type: 'directory', size: 0 }
  }
  async list(path: string): Promise<FileEntry[]> {
    const prefix = path ? path + '/' : ''
    const names = [...new Set([...this.files.keys()].filter(key => key.startsWith(prefix)).map(key => prefix + key.slice(prefix.length).split('/')[0]))]
    return Promise.all(names.map(async name => (await this.stat(name))!))
  }
  async write(path: string, text: string, expected: FileImage | undefined) {
    const current = this.files.get(path)
    if (current?.version !== expected?.version || current?.text !== expected?.text) throw new ScholarError('STALE_DOCUMENT_VERSION', 'TEST_ONLY stale write')
    const image = { text, version: `write-${++this.writes}` }
    this.files.set(path, image); return { ...image }
  }
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(fn)
    this.tail = result
    return result
  }
  // Create-only binary delivery, mirroring the gateway: bytes are never replaced, and the
  // same size ceiling applies. Kept apart from `files` so text assertions stay readable.
  binaries = new Map<string, { bytes: Uint8Array; version: string }>()
  async readExportBytes(path: string) {
    const row = this.binaries.get(path)
    return row && { bytes: row.bytes, version: row.version }
  }
  async createExportBytes(path: string, bytes: Uint8Array) {
    if (this.binaries.has(path)) throw new ScholarError('EXPORT_TARGET_EXISTS', 'TEST_ONLY create-only target already exists')
    if (bytes.byteLength > 32 * 1024 * 1024) throw new ScholarError('CONTENT_TOO_LARGE', 'TEST_ONLY delivery exceeds 32 MiB')
    const version = `export-${++this.writes}`
    this.binaries.set(path, { bytes, version }); return { version }
  }
  // Simulates a separate editor ignoring the plugin lock.
  externalEdit(path: string, text: string) { this.files.set(path, { text, version: `external-${++this.writes}` }) }
}
