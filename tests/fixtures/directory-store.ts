// TEST_ONLY real files for installed-Host browser tests; never used by the plugin.
import { readFile, writeFile, mkdir, stat, readdir, rename } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { digest, type FileStore, type FileImage, type FileEntry } from '../../src/core/store/files.ts'
import { invariant } from '../../src/shared/errors.ts'

export class DirectoryStore implements FileStore {
  private root: string
  private tail: Promise<unknown> = Promise.resolve()
  constructor(root: string) { this.root = resolve(root) }
  private target(path: string) {
    const target = resolve(this.root, path)
    invariant(target === this.root || target.startsWith(this.root + sep), 'TEST_SCOPE_INVALID', 'TEST_ONLY path outside fixture')
    return target
  }
  async read(path: string) {
    try { const text = await readFile(this.target(path), 'utf8'); return { text, version: digest(text) } }
    catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error }
  }
  async readBytes(path: string, maxBytes: number, signal?: AbortSignal) {
    signal?.throwIfAborted(); const bytes = await readFile(this.target(path))
    invariant(bytes.length <= maxBytes, 'CONTENT_TOO_LARGE', 'TEST_ONLY material exceeds limit'); return bytes
  }
  async stat(path: string): Promise<FileEntry | undefined> {
    try { const info = await stat(this.target(path)); return { path, type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size } }
    catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error }
  }
  async list(path: string) {
    try { return (await Promise.all((await readdir(this.target(path))).map(name => this.stat(path ? path + '/' + name : name)))).filter((row): row is FileEntry => !!row) }
    catch (error: any) { if (error.code === 'ENOENT') return []; throw error }
  }
  async write(path: string, text: string, expected: FileImage | undefined) {
    const current = await this.read(path)
    invariant(current?.version === expected?.version && current?.text === expected?.text, 'STALE_DOCUMENT_VERSION', 'TEST_ONLY stale file write')
    const target = this.target(path); await mkdir(dirname(target), { recursive: true })
    const staging = target + '.test-write'; await writeFile(staging, text); await rename(staging, target)
    return { text, version: digest(text) }
  }
  async lock<T>(work: () => Promise<T>) {
    const result = this.tail.catch(() => undefined).then(work); this.tail = result; return result
  }
}
