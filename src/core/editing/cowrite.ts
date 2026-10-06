import { cowriteSuggestion } from '../../shared/writing-task.ts'
import { snapshot } from '../project/project.ts'
import { readEditorBuffer } from './buffer.ts'
import { citationKeys, parseMarkdown, unicodeBoundary } from './markdown.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { protectedChanges } from './proposals.ts'
import { invariant } from '../../shared/errors.ts'

export async function currentWritingText(io: FileStore, sessionId: string) {
  const current = await snapshot(io), { buffer } = await readEditorBuffer(io, sessionId)
  const text = buffer?.state === 'dirty' ? buffer.text : current.document.text
  return { text, bufferHash: digest(text), documentHash: current.document.contentHash,
    baseDocumentHash: buffer?.state === 'dirty' ? buffer.baseHash : current.document.contentHash }
}
/**
 * `action` names the transformation the user chose, so the candidate can say what it is
 * (PRD §5.2); `blockId` records which rendered block the range belonged to, so the candidate
 * is shown under the text it would replace instead of in a distant list.
 */
export async function proposeCowrite(io: FileStore, sessionId: string, input: {
  text: string; baseDocumentHash: string; start: number; end: number; replacementText: string; instruction: string
  action?: 'rewrite' | 'polish' | 'shorten' | 'expand' | 'custom'; blockId?: string; baseBufferHash?: string
}) {
  const current = await snapshot(io), before = input.text.slice(input.start, input.end)
  invariant(input.baseDocumentHash === current.document.contentHash && input.start <= input.end && input.end <= input.text.length &&
    unicodeBoundary(input.text, input.start) && unicodeBoundary(input.text, input.end), 'STALE_DOCUMENT_VERSION', '编辑基础或范围已改变。')
  const keys = new Set(Object.values(current.ledger.sources).map(row => row.citeKey))
  invariant(citationKeys(input.replacementText).every(key => keys.has(key) || citationKeys(before).includes(key)), 'MODEL_CITATION_INVALID', '建议包含未登记引用。')
  parseMarkdown(input.text.slice(0, input.start) + input.replacementText + input.text.slice(input.end))
  const now = new Date().toISOString(), suggestion = cowriteSuggestion.parse({ schemaVersion: 1, id: newId('cowrite'),
    projectId: current.ledger.projectId, sessionId, baseBufferHash: input.baseBufferHash ?? digest(input.text), baseDocumentHash: input.baseDocumentHash,
    start: input.start, end: input.end, before, after: input.replacementText, instruction: input.instruction,
    action: input.action ?? 'custom', ...(input.blockId && { blockId: input.blockId }),
    protectedFactChanges: protectedChanges(before, input.replacementText), citationChanges: { added: citationKeys(input.replacementText).filter(key => !citationKeys(before).includes(key)), removed: citationKeys(before).filter(key => !citationKeys(input.replacementText).includes(key)) },
    state: 'pending', createdAt: now, updatedAt: now })
  await io.lock(async () => io.write(`.scholarflow/writing/suggestions/${suggestion.id}.json`, json(suggestion), undefined))
  return suggestion
}
