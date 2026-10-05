import { proposalRevisionRequest } from '../../shared/document-api.ts'
import { proposalSchema } from '../../shared/editing.ts'
import { invariant } from '../../shared/errors.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { snapshot } from '../project/project.ts'
import { buildProposal, proposalImage, storeProposal } from './proposals.ts'
import { reviewInput } from '../review/review.ts'
import { MAX_MATERIAL_BYTES, sensitivePath } from '../materials/materials.ts'
import { citationKeys } from './markdown.ts'

export async function prepareProposalRevision(io: FileStore, request: unknown) {
  const input = proposalRevisionRequest.parse(request), current = await snapshot(io), original = await proposalImage(io, input.proposalId)
  invariant(current.ledger.projectId === input.context.projectId && current.ledger.revision === input.context.expectedLedgerRevision,
    'STALE_LEDGER_REVISION', '编辑候选需要当前项目和数据版本。')
  invariant(original.contentHash === input.proposalHash && original.proposal.projectId === current.ledger.projectId && current.ledger.proposalStates[input.proposalId]?.state === 'pending',
    'PROPOSAL_CHANGED', '原建议改变、不可用或不再待审阅；不修改历史候选。')
  invariant(original.proposal.baseDocumentHash === current.document.contentHash && original.proposal.baseRevisionId === current.document.revisionId && !current.document.externalChange,
    'STALE_DOCUMENT_VERSION', '原建议不属于当前稿件版本，不能靠编辑旧候选覆盖新稿。')
  invariant(original.proposal.edits.length === 1 && input.replacementText.isWellFormed() && input.replacementText.trim(), 'PROPOSAL_RANGE_INVALID', '当前候选编辑只支持完整单条修改，内容不能为空或切断 Unicode。')
  invariant(original.proposal.section || !input.paragraphClaims, 'SECTION_CLAIM_MAPPING_INVALID', '非章节候选不能附加章节论点映射。')
  await verifyEvidence(io, current, original.proposal.dependentEvidenceIds)
  const evidenceKeys = original.proposal.dependentEvidenceIds.map(id => current.ledger.sources[current.ledger.evidence[id].sourceId].citeKey)
  const allowedKeys = new Set([...citationKeys(original.proposal.edits[0].replacementText), ...citationKeys(original.proposal.edits[0].expectedText), ...evidenceKeys])
  const editedKeys = citationKeys(input.replacementText)
  invariant(editedKeys.every(key => allowedKeys.has(key)), 'CITATION_SCOPE_INVALID', '编辑不能加入原候选及依赖证据之外的来源；请单独核验证据并生成新计划。')
  invariant(original.proposal.selection || !evidenceKeys.length || editedKeys.some(key => evidenceKeys.includes(key)), 'CITATION_SCOPE_INVALID', '编辑不能移除候选所依赖证据的全部引用。')
  const candidate = buildProposal(current, { runId: original.proposal.runId, instruction: original.proposal.instruction,
    replacementText: input.replacementText, selection: original.proposal.selection, dependentEvidenceIds: original.proposal.dependentEvidenceIds,
    ...(original.proposal.reviewIssue && { reviewIssueId: original.proposal.reviewIssue.issueId }),
    ...(original.proposal.section && { section: { ...original.proposal.section, body: input.replacementText, paragraphClaims: input.paragraphClaims ?? original.proposal.section.paragraphClaims } }) })
  const proposal = proposalSchema.parse({ ...candidate, derivedFrom: { proposalId: original.proposal.id, proposalHash: original.contentHash, origin: 'operator-edit' } })
  const body = { id: newId('editplan'), projectId: current.ledger.projectId, input, proposal, configHash: current.configHash, ledgerHash: current.ledgerHash,
    documentHash: current.document.contentHash, dependencyHash: (await reviewInput(io)).dependencyHash }
  return { ...body, contentHash: digest(json(body)) }
}
export type ProposalRevisionPlan = Awaited<ReturnType<typeof prepareProposalRevision>>
async function verifyEvidence(io: FileStore, current: Awaited<ReturnType<typeof snapshot>>, evidenceIds: string[]) {
  for (const evidenceId of evidenceIds) {
    const evidence = current.ledger.evidence[evidenceId], source = current.ledger.sources[evidence?.sourceId], material = current.ledger.materials[source?.materialId ?? '']
    invariant(evidence?.validation === 'located' && source?.contentHash === evidence.sourceContentHash && material && current.config.materials.include.includes(material.projectRelativePath) &&
      !sensitivePath(material.projectRelativePath), 'EVIDENCE_NOT_CURRENT', '候选依赖的证据已过期或被移除。')
    invariant(digest(await io.readBytes(material.projectRelativePath, MAX_MATERIAL_BYTES)) === evidence.sourceContentHash, 'STALE_MATERIAL_VERSION', '编辑候选前原始资料已改变，请先更新证据。')
  }
}
export async function publishProposalRevision(io: FileStore, plan: ProposalRevisionPlan, operatorSessionId: string) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash && operatorSessionId === plan.input.context.sessionId, 'INVALID_APPROVAL', '候选编辑确认或用户会话不符。')
  const actual = await prepareProposalRevision(io, plan.input)
  invariant(actual.configHash === plan.configHash && actual.ledgerHash === plan.ledgerHash && actual.dependencyHash === plan.dependencyHash && actual.documentHash === plan.documentHash,
    'PROPOSAL_CHANGED', '预览后项目输入改变，请重新校验编辑。')
  const expected = proposalSchema.parse({ ...actual.proposal, id: plan.proposal.id, createdAt: plan.proposal.createdAt })
  invariant(json(expected) === json(proposalSchema.parse(plan.proposal)), 'INVALID_APPROVAL', '确认候选与重新校验结果不一致。')
  return storeProposal(io, plan.proposal, plan.input.context.expectedLedgerRevision!, [{ path: `.scholarflow/proposals/edits/${plan.proposal.id}.json`, before: undefined,
    after: json({ schemaVersion: 1, projectId: plan.projectId, originalProposalId: plan.input.proposalId, originalProposalHash: plan.input.proposalHash,
      proposalId: plan.proposal.id, proposalHash: digest(json(plan.proposal)), reason: plan.input.reason, approvedPlanHash: contentHash, operatorSessionId, confirmedAt: new Date().toISOString() }) }], async current => {
      invariant(current.ledgerHash === plan.ledgerHash && current.configHash === plan.configHash, 'PROPOSAL_CHANGED', '保存前项目输入改变。')
      const parent = await proposalImage(io, plan.input.proposalId)
      invariant(parent.contentHash === plan.input.proposalHash && current.ledger.proposalStates[parent.proposal.id]?.state === 'pending', 'PROPOSAL_CHANGED', '保存前原建议状态改变。')
      await verifyEvidence(io, current, plan.proposal.dependentEvidenceIds)
      invariant((await reviewInput(io)).dependencyHash === plan.dependencyHash, 'PROPOSAL_CHANGED', '保存前材料、Profile 或确认记忆改变。')
    })
}
