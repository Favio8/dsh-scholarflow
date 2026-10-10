import { firstDraftApproval, type WritingTask, type CreationSpec } from '../../shared/writing-task.ts'
import { digest, newId, type FileStore } from '../store/files.ts'
import { snapshot } from '../project/project.ts'
import { buildProposal, storeProposal, applyProposal } from '../editing/proposals.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { dirtyWritingBuffers, noteTask } from './writing-task-store.ts'
import { sensitivePath, MAX_MATERIAL_BYTES } from '../materials/materials.ts'

export async function approveFirstDraft(io: FileStore, spec: CreationSpec, sessionId: string) {
  const materialHashes: Record<string, string> = {}
  for (const path of spec.materials) {
    invariant(!sensitivePath(path), 'MATERIAL_ACCESS_DENIED', '不能授权敏感文件作为写作资料。')
    try { materialHashes[path] = digest(await io.readBytes(path, MAX_MATERIAL_BYTES)) }
    catch (error) {
      if (!(error instanceof ScholarError && ['FILE_NOT_FOUND', 'FILE_NOT_REGULAR', 'CONTENT_TOO_LARGE'].includes(error.code)) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return firstDraftApproval.parse({ sessionId, confirmedAt: new Date().toISOString(), paths: spec.materials, materialHashes, policy: 'keep-selected-separate' })
}
export function deferDraftIssue(task: WritingTask, kind: WritingTask['deferredIssues'][number]['kind'], message: string, sectionId?: string) {
  if (!task.deferredIssues.some(row => row.kind === kind && row.message === message && row.sectionId === sectionId)) {
    if (task.deferredIssues.length < 200) task.deferredIssues.push({ kind, message: message.slice(0, 4000), ...(sectionId && { sectionId }) })
    noteTask(task, `${sectionId ? task.spec.sections.find(row => row.id === sectionId)?.title ?? sectionId : '首稿待处理'}：${message}`)
  }
}
export function recoverableDraftOutput(error: unknown) {
  return error instanceof ScholarError && (/^MODEL_CITATION_/u.test(error.code) || ['SECTION_OUTPUT_INVALID','SECTION_CLAIM_MAPPING_INVALID','INVALID_MODEL_OUTPUT', 'MODEL_OUTPUT_INVALID', 'MODEL_OUTPUT_INCOMPLETE', 'MODEL_OUTPUT_LIMIT_REACHED','MODEL_OUTPUT_TOO_LARGE'].includes(error.code))
}
export async function saveDraftGap(io: FileStore, task: WritingTask, sectionId: string, reason: string) {
  const current = await snapshot(io)
  invariant(current.document.contentHash === task.expectedDocumentHash && !await dirtyWritingBuffers(io), 'STALE_DOCUMENT_VERSION', '正文已被修改，待补内容未覆盖人工稿。')
  const proposal = buildProposal(current, { runId: newId('run'), instruction: '首稿保留实际缺口', replacementText: '', dependentEvidenceIds: [],
    section: { sectionId, outlineVersion: current.ledger.outline.version, body: `[待补：${reason.replace(/[\[\]\r\n]/g, ' ').slice(0, 500)}]`,
      paragraphClaims: [{ paragraphIndex: 0, claimIds: [] }], limitations: [reason] } })
  const stored = await storeProposal(io, proposal, current.ledger.revision)
  await applyProposal(io, proposal.id, (await snapshot(io)).ledger.revision, stored.proposalHash)
  task.expectedDocumentHash = (await snapshot(io)).document.contentHash
}
