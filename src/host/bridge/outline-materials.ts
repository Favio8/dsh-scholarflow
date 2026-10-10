import type { FileStore } from '../../core/store/files.ts'
import { digest } from '../../core/store/files.ts'
import { sensitivePath, mediaType } from '../../core/materials/materials.ts'
import { parseMaterialBytes } from '../parsers/parse.ts'

/** Explicitly selected files only, with bounded excerpts and visible omissions. */
export async function outlineMaterials(io: FileStore, paths: string[], signal: AbortSignal) {
  const materials: { path: string; text: string; truncated: boolean }[] = []
  const notes: string[] = [], hashes: Record<string, string> = {}
  let remaining = 24000
  for (const path of [...new Set(paths)]) {
    signal.throwIfAborted()
    if (!remaining || materials.length >= 12) { notes.push(`${path}：本次上下文限额内未读取，不能据此推断内容。`); continue }
    if (sensitivePath(path) || !/\.(pdf|docx|md|markdown|txt|html?)$/i.test(path)) {
      notes.push(`${path}：本次大纲生成不支持读取此文件。`); continue
    }
    try {
      const bytes = await io.readBytes(path, 50 * 1024 * 1024, signal)
      hashes[path] = digest(bytes)
      const parsed = await parseMaterialBytes(bytes, mediaType(path), signal)
      const text = parsed.blocks.map(block => block.text).join('\n')
      if (!text.trim()) { notes.push(`${path}：未提取到可读文字。`); continue }
      const excerpt = text.slice(0, Math.min(6000, remaining))
      remaining -= excerpt.length
      materials.push({ path, text: excerpt, truncated: excerpt.length < text.length })
      notes.push(`${path}：本次仅提供提取文字中的 ${excerpt.length} 字片段，不代表已核验全文。`)
    } catch (error) {
      signal.throwIfAborted()
      notes.push(`${path}：本次未能读取或解析，请检查文件；大纲不能声称读过它。`)
    }
  }
  return { materials, notes, hashes }
}
