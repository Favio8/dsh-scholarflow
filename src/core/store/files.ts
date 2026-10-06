import { createHash, randomUUID } from 'node:crypto'

export const digest = (bytes: string | Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`
export const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'
export interface FileImage { text: string; version: string }
export interface FileEntry { path: string; type: 'file' | 'directory' | 'other'; size: number }
export interface FileStore {
  read(path: string): Promise<FileImage | undefined>
  /**
   * Reads raw bytes. `signal` is the caller's own cancellation, distinct from the store's
   * session lifetime: a caller that bounds one step (one requirement member, one retry) must
   * be able to stop that step, and without this the bound cannot reach the file read at all.
   */
  readBytes(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
  // Separate capability for fixed project Skill trees. The raw-material reader
  // continues to deny all metadata and manuscript paths.
  resourceStat?(path: string): Promise<FileEntry | undefined>
  readResourceBytes?(path: string, maxBytes: number): Promise<Uint8Array>
  // Create-only fixed resource publication under the project writer lock.
  // A failed or interrupted copy remains unbound; this never replaces bytes.
  createResourceBytes?(path: string, bytes: Uint8Array): Promise<void>
  // Binary delivery artifacts are create-only and confined to exports/.
  readExportBytes?(path: string): Promise<{ bytes: Uint8Array; version: string } | undefined>
  createExportBytes?(path: string, bytes: Uint8Array): Promise<{ version: string }>
  stat(path: string): Promise<FileEntry | undefined>
  list(path: string): Promise<FileEntry[]>
  write(path: string, text: string, expected: FileImage | undefined): Promise<FileImage>
  lock<T>(operation: () => Promise<T>): Promise<T>
}
