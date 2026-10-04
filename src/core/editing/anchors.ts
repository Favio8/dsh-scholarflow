import { z } from 'zod'
import { anchorUpsertRequest } from '../../shared/editing.ts'
import { snapshot, mutateLedger, invalidateReviews } from '../project/project.ts'
import { digest, newId, type FileStore } from '../store/files.ts'
import { projectMarkdown } from './markdown.ts'
import { invariant } from '../../shared/errors.ts'

export async function upsertAnchor(io: FileStore, raw: Omit<z.infer<typeof anchorUpsertRequest>, 'context'>, revision: number) {
  raw = anchorUpsertRequest.omit({ context: true }).parse(raw)
  const anchorId = raw.anchorId ?? newId('anchor')
  const result = await mutateLedger(io, revision, async ledger => {
    const current = await snapshot(io)
    invariant(!current.document.externalChange && current.document.contentHash === raw.documentHash, 'STALE_DOCUMENT_VERSION', '段落定位基于旧稿，不能保存关联。')
    const block = projectMarkdown(current.document.text).blocks.find(row => row.id === raw.blockId)
    invariant(block && digest(current.document.text.slice(block.start, block.end)) === raw.blockTextHash, 'ANCHOR_TARGET_CHANGED', '目标段落的位置或原文哈希改变，请重新选择。')
    invariant(!raw.anchorId || ledger.claimAnchors[raw.anchorId], 'ANCHOR_NOT_FOUND', '要重新定位的关联不存在。')
    invariant(new Set(raw.claimIds).size === raw.claimIds.length && raw.claimIds.every(id => ledger.claims[id]), 'CLAIM_NOT_FOUND', '关联论点不存在或重复。')
    invariant(raw.anchorId || raw.claimIds.length, 'ANCHOR_CLAIMS_REQUIRED', '新关联至少需要一个已登记论点。')
    invariant(!Object.values(ledger.claimAnchors).some(anchor => anchor.id !== anchorId && anchor.status === 'current' &&
      anchor.documentHash === raw.documentHash && anchor.blockId === raw.blockId), 'ANCHOR_ALREADY_EXISTS', '目标段落已有当前关联，请编辑该关联。')
    if (!raw.claimIds.length) delete ledger.claimAnchors[anchorId]
    else ledger.claimAnchors[anchorId] = { id: anchorId, documentId: 'paper', documentHash: raw.documentHash, blockId: raw.blockId,
      blockTextHash: raw.blockTextHash, claimIds: raw.claimIds, status: 'current' }
    invalidateReviews(ledger, ['evidence', 'logic', 'integrity'])
  })
  return { anchor: result.ledger.claimAnchors[anchorId], removed: !raw.claimIds.length, revision: result.revision }
}
