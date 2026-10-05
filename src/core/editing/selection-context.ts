import { selectionSchema } from '../../shared/editing.ts'
import { invariant } from '../../shared/errors.ts'
import { snapshot } from '../project/project.ts'
import type { FileStore } from '../store/files.ts'
import { validateSelection, unicodeBoundary, parseMarkdown, textOf } from './markdown.ts'

// This is readonly context, never a Proposal or an execution authorization.
// Host owns workspace/session binding; Core owns document and AST verification.
export async function selectionContext(io: FileStore, request: unknown) {
  const selection = selectionSchema.parse(request), current = await snapshot(io)
  invariant(selection.projectId === current.ledger.projectId && selection.documentId === 'paper' &&
    selection.documentHash === current.document.contentHash && selection.revisionId === current.document.revisionId && !current.document.externalChange,
    'STALE_DOCUMENT_VERSION', '选区不属于当前已保存稿件版本，原文和输入保留，请重新选择。')
  validateSelection(current.document.text, selection)
  invariant(Buffer.byteLength(selection.sourceText) + Buffer.byteLength(selection.renderedText) <= 65536 &&
    selection.claimIds.length <= 100 && new Set(selection.claimIds).size === selection.claimIds.length && selection.claimIds.every(id => current.ledger.claims[id]),
    'SELECTION_CONTEXT_INVALID', '选区上下文超过 64 KiB，或包含本项目之外／重复的论点。')
  const { startUtf16, endUtf16 } = selection.sourceRange
  let before = Math.max(0, startUtf16 - 200), after = Math.min(current.document.text.length, endUtf16 + 200)
  if (!unicodeBoundary(current.document.text, before)) before++
  if (!unicodeBoundary(current.document.text, after)) after--
  const headings: { depth: number; title: string }[] = []
  for (const node of parseMarkdown(current.document.text).children ?? []) {
    if ((node.position?.start.offset ?? Infinity) >= startUtf16) break
    if (node.type !== 'heading') continue
    while (headings.length && headings.at(-1)!.depth >= node.depth!) headings.pop()
    headings.push({ depth: node.depth!, title: textOf(node) })
  }
  return { schemaVersion: 1 as const, projectId: current.ledger.projectId, documentId: 'paper' as const,
    documentPath: current.config.paths.mainDocument, chapterPath: headings.map(row => row.title), selectedCharacters: [...selection.renderedText].length,
    documentHash: current.document.contentHash, revisionId: current.document.revisionId, blockIds: selection.blockIds,
    sourceRange: selection.sourceRange, sourceText: selection.sourceText, renderedText: selection.renderedText,
    prefixContext: current.document.text.slice(before, startUtf16), suffixContext: current.document.text.slice(endUtf16, after),
    citations: selection.citationKeys.map(citeKey => {
      const source = Object.values(current.ledger.sources).find(row => row.citeKey === citeKey)
      return { citeKey, ...(source && { sourceId: source.id, title: source.title, identity: source.identity.status }), registered: !!source }
    }), claimIds: [...selection.claimIds], capturedAt: selection.capturedAt,
    limitation: '这只是当前已保存稿件的选区快照，不证明论点支持或全文核验，不授予文件写入或执行权限。' }
}
