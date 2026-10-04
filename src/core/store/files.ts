import { createHash, randomUUID } from 'node:crypto'

export const digest = (bytes: string | Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`
export const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'
export interface FileImage { text: string; version: string }
export interface FileEntry { path: string; type: 'file' | 'directory' | 'other'; size: number }
export interface FileStore {
  read(path: string): Promise<FileImage | undefined>
  readBytes(path: string, maxBytes: number): Promise<Uint8Array>
  stat(path: string): Promise<FileEntry | undefined>
  list(path: string): Promise<FileEntry[]>
  write(path: string, text: string, expected: FileImage | undefined): Promise<FileImage>
  lock<T>(operation: () => Promise<T>): Promise<T>
}
