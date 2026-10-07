import { z } from 'zod'
import { memoryFileSchema, hash, id, type Ledger } from '../../shared/schema.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { invariant, parseStored } from '../../shared/errors.ts'
import { projectMarkdown, textOf, walk } from '../editing/markdown.ts'
import type { Mutation } from '../store/transactions.ts'
import { verifiedIdentityLineage } from './identity.ts'

const kinds = { '.scholarflow/context/decisions.md': 'decision', '.scholarflow/context/terminology.md': 'terminology',
  '.scholarflow/context/writing-memory.md': 'writing-preference' } as const
type MemoryPath = keyof typeof kinds
const historySchema = z.object({ schemaVersion: z.literal(1), id, projectId: id, path: z.enum(Object.keys(kinds) as [MemoryPath, ...MemoryPath[]]),
  source: z.literal('user-operation'), sourceSessionId: id.optional(), confirmedAt: z.string(), reason: z.string().min(1).max(4000),
  previousText: z.string(), previousHash: hash, text: z.string(), contentHash: hash,
  previousMetadata: memoryFileSchema.optional(), metadata: memoryFileSchema,
  supersededEntryIds: z.array(id).max(2000) }).strict()
function parts(text: string) {
  const projection = projectMarkdown(text), headings: { depth: number; title: string; start: number }[] = [], opaque: { start: number; end: number }[] = []
  for (const node of projection.tree.children ?? []) if (node.type === 'heading') headings.push({ depth: node.depth!, title: textOf(node), start: node.position!.start.offset! })
  walk(projection.tree, node => {
    if (['code', 'html', 'table', 'math', 'definition', 'footnoteDefinition'].includes(node.type) && node.position)
      opaque.push({ start: node.position.start.offset!, end: node.position.end.offset! })
  })
  const ranges = [...projection.blocks.filter(block => !opaque.some(range => block.start >= range.start && block.end <= range.end))
    .map(block => ({ start: block.start, end: block.end, representation: 'paragraph' as const })),
    ...opaque.filter(range => !opaque.some(other => other !== range && other.start <= range.start && other.end >= range.end))
      .map(range => ({ ...range, representation: 'opaque' as const }))].sort((a, b) => a.start - b.start)
  if (!ranges.length && text.trim() && projection.tree.children?.some(node => node.type !== 'heading' && node.type !== 'thematicBreak'))
    ranges.push({ start: 0, end: text.length, representation: 'opaque' })
  invariant(ranges.length <= 2000, 'MEMORY_ENTRY_LIMIT', '记忆超过 2000 条读取／追踪限额；没有丢弃内容后继续保存。')
  return ranges.map(range => {
    const context: { depth: number; title: string }[] = []
    for (const heading of headings.filter(heading => heading.start < range.start)) {
      while (context.length && context.at(-1)!.depth >= heading.depth) context.pop()
      context.push({ depth: heading.depth, title: heading.title })
    }
    return { startUtf16: range.start, endUtf16: range.end, representation: range.representation,
      textHash: digest(text.slice(range.start, range.end)), contextHash: digest(json(context)) }
  })
}
// Markdown is the only editable content authority. Ledger entries are guarded
// projections, never another freely editable copy of memory text.
export function memoryEntryMutations(ledger: Ledger, path: string, previousText: string, text: string, sourceSessionId?: string,
  reason = '用户明确确认项目记忆文本及本次更正。', retainVerifiedOrigins = true): Mutation[] {
  invariant(path in kinds && text.isWellFormed(), 'MEMORY_INVALID', '记忆路径或 Unicode 无效。')
  invariant(reason.trim().length && reason.length <= 4000, 'MEMORY_INVALID', '记忆更正理由无效。')
  const name = path as MemoryPath, previousMetadata = ledger.memoryFiles?.[name], operationId = newId('memory_change'), confirmedAt = new Date().toISOString()
  const currentParts = parts(text), originalParts = parts(previousText), signature = (entry: { textHash: string; contextHash: string }) => `${entry.textHash}/${entry.contextHash}`
  const currentCounts = new Map<string, number>(), originalCounts = new Map<string, number>()
  for (const entry of currentParts) currentCounts.set(signature(entry), (currentCounts.get(signature(entry)) ?? 0) + 1)
  for (const entry of originalParts) originalCounts.set(signature(entry), (originalCounts.get(signature(entry)) ?? 0) + 1)
  const originalValid = retainVerifiedOrigins && previousMetadata?.contentHash === digest(previousText) && previousMetadata.entries.length === originalParts.length &&
    previousMetadata.entries.every((entry, index) => json({ startUtf16: entry.startUtf16, endUtf16: entry.endUtf16, representation: entry.representation,
      textHash: entry.textHash, contextHash: entry.contextHash }) === json(originalParts[index]))
  const metadata = memoryFileSchema.parse({ contentHash: digest(text), operationId, confirmedAt, entries: currentParts.map(part => {
    const key = signature(part), previous = originalValid && currentCounts.get(key) === 1 && originalCounts.get(key) === 1
      ? previousMetadata!.entries.find(entry => signature(entry) === key) : undefined
    return previous ? { ...previous, ...part } : { ...part, id: newId('memory_entry'), kind: kinds[name], state: 'confirmed', source: 'user-operation',
      sourceOperationId: operationId, ...(sourceSessionId && { sourceSessionId }), originContentHash: digest(text), confirmedAt }
  }) })
  const activeIds = new Set(metadata.entries.map(entry => entry.id))
  const history = historySchema.parse({ schemaVersion: 1, id: operationId, projectId: ledger.projectId, path: name, source: 'user-operation',
    ...(sourceSessionId && { sourceSessionId }), confirmedAt, reason: reason.trim(), previousText, previousHash: digest(previousText), text, contentHash: digest(text),
    ...(previousMetadata && { previousMetadata }), metadata, supersededEntryIds: previousMetadata?.entries.filter(entry => !activeIds.has(entry.id)).map(entry => entry.id) ?? [] })
  ledger.memoryFiles ??= {}; ledger.memoryFiles[name] = metadata
  const historyText = json(history)
  invariant(Buffer.byteLength(historyText) <= 4 * 1024 * 1024, 'MEMORY_HISTORY_LIMIT', '更正历史超过 4 MiB 限额，没有丢弃原始内容后继续保存。')
  return [{ path: `.scholarflow/context/history/${operationId}.json`, before: undefined, after: historyText }]
}
export function memoryEntryProjection(ledger: Ledger, path: string, text: string) {
  const metadata = ledger.memoryFiles?.[path as MemoryPath], contentHash = digest(text), currentParts = path in kinds ? parts(text) : []
  const current = !!metadata && metadata.contentHash === contentHash && metadata.entries.length === currentParts.length &&
    metadata.entries.every((entry, index) => entry.startUtf16 === currentParts[index].startUtf16 && entry.endUtf16 === currentParts[index].endUtf16 &&
      entry.textHash === currentParts[index].textHash && entry.contextHash === currentParts[index].contextHash && entry.kind === kinds[path as MemoryPath])
  return { current, entries: current ? metadata.entries.map(entry => ({ ...entry, text: text.slice(entry.startUtf16, entry.endUtf16) })) : [],
    diagnostics: current ? [] : ['当前文本尚无可校验的条目来源记录；作为原始文本显示，不猜测旧条目的作者或确认时间。明确确认后记录本次用户操作。'] }
}
export async function memoryHistory(io: FileStore, projectId: string, path: string) {
  invariant(path in kinds, 'MEMORY_INVALID', '只能读取当前项目的三类记忆历史。')
  const root = '.scholarflow/context/history'
  if (!await io.stat(root)) return { operations: [] }
  const rows = await io.list(root)
  invariant(rows.length <= 1000, 'MEMORY_HISTORY_LIMIT', '记忆历史超过读取限额；原记录保留。')
  const operations = [], lineage = await verifiedIdentityLineage(io, projectId)
  for (const row of rows) {
    invariant(row.type === 'file' && /^memory_change_[\w]+\.json$/.test(row.path.split('/').at(-1)!), 'MEMORY_HISTORY_INVALID', '记忆历史含未知记录，未猜测来源。')
    const file = await io.read(row.path)
    invariant(file && Buffer.byteLength(file.text) <= 4 * 1024 * 1024, 'MEMORY_HISTORY_LIMIT', '记忆更正记录缺失或超过读取限额。')
    const operation = parseStored(historySchema, file.text, 'MEMORY_HISTORY_INVALID', 'project.memoryHistory')
    invariant(lineage.projectIds.includes(operation.projectId) && `${operation.id}.json` === row.path.split('/').at(-1) &&
      digest(operation.previousText) === operation.previousHash && digest(operation.text) === operation.contentHash && operation.metadata.contentHash === operation.contentHash &&
      operation.metadata.operationId === operation.id, 'MEMORY_HISTORY_INVALID', '记忆更正身份或原文摘要不一致，原记录保留。')
    if (operation.path === path) operations.push(operation)
  }
  return { operations: operations.sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)).slice(0, 100),
    limitation: '仅展示当前所选记忆文件最近 100 次操作；其余完整记录仍在项目中。' }
}
export async function verifiedMemoryProjection(io: FileStore, ledger: Ledger, path: string, text: string) {
  const projection = memoryEntryProjection(ledger, path, text)
  if (!projection.current) return projection
  const sourceIds = [...new Set(projection.entries.map(entry => entry.sourceOperationId))]
  if (sourceIds.length > 64) return { current: false, entries: [], diagnostics: ['条目来源超过单次 64 个操作的校验限额；保留原文与全部历史，可以重新明确确认本次用户操作，不猜测旧来源。'] }
  try {
    const lineage = await verifiedIdentityLineage(io, ledger.projectId)
    for (const operationId of sourceIds) {
      const file = await io.read(`.scholarflow/context/history/${operationId}.json`)
      invariant(file && Buffer.byteLength(file.text) <= 4 * 1024 * 1024, 'MEMORY_HISTORY_INVALID', '条目来源快照缺失或超限。')
      const source = parseStored(historySchema, file.text, 'MEMORY_HISTORY_INVALID', 'project.memoryHistory')
      invariant(source.id === operationId && lineage.projectIds.includes(source.projectId) && source.path === path &&
        digest(source.text) === source.contentHash && digest(source.previousText) === source.previousHash && source.metadata.contentHash === source.contentHash &&
        source.metadata.operationId === operationId, 'MEMORY_HISTORY_INVALID', '条目来源的身份或原文摘要改变。')
      for (const entry of projection.entries.filter(entry => entry.sourceOperationId === operationId)) {
        const original = source.metadata.entries.find(row => row.id === entry.id)
        invariant(original && original.sourceOperationId === operationId && original.textHash === entry.textHash && original.contextHash === entry.contextHash &&
          original.kind === entry.kind && original.confirmedAt === entry.confirmedAt && original.sourceSessionId === entry.sourceSessionId &&
          entry.originContentHash === source.contentHash && digest(source.text.slice(original.startUtf16, original.endUtf16)) === entry.textHash,
          'MEMORY_HISTORY_INVALID', '条目来源链与原始确认不一致。')
      }
    }
    return projection
  } catch {
    return { current: false, entries: [], diagnostics: ['条目来源操作快照缺失、改变或无法校验；保留原文与旧历史。重新明确确认会记录本次用户操作，不伪造旧作者或时间。'] }
  }
}
