import { writingSourceConflict, type WritingTask } from '../../shared/writing-task.ts'
import { snapshot } from '../project/project.ts'
import { registerSource } from '../evidence/evidence.ts'
import { sourceMatches } from '../research/source-matching.ts'
import { digest, json, type FileStore } from '../store/files.ts'
import { invariant } from '../../shared/errors.ts'

export function evidenceMaterials(current: Awaited<ReturnType<typeof snapshot>>, task: WritingTask) {
  return Object.values(current.ledger.materials).filter(row => current.config.materials.include.includes(row.projectRelativePath)
    && (task.spec.materials.includes(row.projectRelativePath) || row.projectRelativePath.startsWith('.scholarflow/cache/writing-assets/'))
    && (row.parseStatus === 'ready' || row.parseStatus === 'partial'))
}

/** A preview contains identities and relative filenames, never the private material text. */
export async function prepareWritingSourceConflict(io: FileStore, task: WritingTask) {
  if (task.stage !== 'evidence') return undefined
  const current = await snapshot(io), material = evidenceMaterials(current, task)[task.evidenceMaterialIndex]
  if (!material?.contentHash || Object.values(current.ledger.sources).some(row => row.materialId === material.id)) return undefined
  const title = material.projectRelativePath.split('/').at(-1)!
  const matches = sourceMatches({ title, identifiers: {} }, current.ledger.sources)
  if (!matches.length) return undefined
  const body = { materialId: material.id, materialPath: material.projectRelativePath, materialHash: material.contentHash, title,
    configHash: current.configHash, ledgerHash: current.ledgerHash, ledgerRevision: current.ledger.revision,
    matches: matches.map(row => ({ sourceId: row.sourceId, sourceHash: row.sourceHash, title: row.title, citeKey: row.citeKey,
      ...(row.materialId && current.ledger.materials[row.materialId] ? { materialPath: current.ledger.materials[row.materialId].projectRelativePath } : {}),
      ...(row.contentHash ? { contentHash: row.contentHash } : {}) })) }
  return writingSourceConflict.parse({ ...body, previewHash: digest(json(body)) })
}

/** Explicitly keep the selected text separate. Existing citations and evidence are untouched. */
export async function resolveWritingSourceConflict(io: FileStore, task: WritingTask, previewHash: string, reason: string, sessionId: string) {
  const preview = await prepareWritingSourceConflict(io, task)
  invariant(preview && preview.previewHash === previewHash, 'SOURCE_PREVIEW_STALE', '资料或已有来源已改变，请查看更新后的重复来源信息再确认。')
  invariant(reason.trim().length > 0 && reason.length <= 4000, 'SOURCE_DUPLICATE_REVIEW_REQUIRED', '请说明为什么将当前文件与已有记录分别保留。')
  const current = await snapshot(io), material = current.ledger.materials[preview.materialId]
  return registerSource(io, { title: preview.title, authors: [], identifiers: {}, materialId: material.id,
    kind: material.role === 'paper' ? 'paper' : 'other' }, preview.ledgerRevision,
    { decision: 'keep-separate', reason, matches: preview.matches.map(({ sourceId, sourceHash }) => ({ sourceId, sourceHash })) }, sessionId,
    { configHash: preview.configHash, ledgerHash: preview.ledgerHash })
}
