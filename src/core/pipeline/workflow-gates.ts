import { workflowGoalSchema, type WorkflowGoal, type WorkflowStageGate } from '../../shared/workflow.ts'
import { invariant } from '../../shared/errors.ts'
import { digest, json, type FileStore } from '../store/files.ts'
import { reviewInput, inspectReview } from '../review/review.ts'
import { sectionTarget } from '../editing/sections.ts'
import { projectMarkdown } from '../editing/markdown.ts'
import { proposalImage, applyEdits } from '../editing/proposals.ts'
import { readDelivery } from '../export/delivery.ts'

// Facts come from saved project artifacts and actual selected bytes. Model text,
// checkbox values and elapsed time cannot assert that a gate passed.
export async function workflowGates(io: FileStore, goal: WorkflowGoal) {
  goal = workflowGoalSchema.parse(goal)
  const input = await reviewInput(io), { current, materialHashes } = input, { ledger, document } = current
  const review = await inspectReview(io, input)
  const requirements = Object.values(ledger.requirements), sources = Object.values(ledger.sources)
  const located = Object.values(ledger.evidence).filter(row => {
    const source = ledger.sources[row.sourceId]
    return row.validation === 'located' && source?.materialId && source.contentHash === row.sourceContentHash && materialHashes[source.materialId] === row.sourceContentHash
  })
  const selectedSources = sources.filter(source => source.materialId && materialHashes[source.materialId] === source.contentHash)
  const unresolved = Object.values(ledger.reviewIssues).filter(row => row.state !== 'resolved')
  const output: WorkflowStageGate[] = []
  const gate = (stage: WorkflowStageGate['stage'], facts: unknown, canComplete: boolean, outcome: WorkflowStageGate['outcome'],
    reasons: string[], artifacts: string[] = [], canSkip = false) => {
    output.push({ stage, state: canComplete ? 'ready' : 'blocked', fingerprint: digest(json({ stage, facts })), canComplete, canSkip, outcome, reasons, artifacts })
  }
  const requirementMaterials = Object.fromEntries(Object.values(ledger.materials).filter(row => requirements.some(requirement => requirement.origin.materialId === row.id))
    .map(row => [row.id, { registeredHash: row.contentHash, actualHash: materialHashes[row.id] }]))
  const requirementsReady = requirements.every(row => row.confirmation === 'confirmed' && (!row.origin.materialId ||
    !!requirementMaterials[row.origin.materialId]?.registeredHash && requirementMaterials[row.origin.materialId].actualHash === requirementMaterials[row.origin.materialId].registeredHash)) &&
    (!!requirements.length || !!goal.noFormalRequirementsReason)
  gate('requirements', { project: current.config.project, requirements, requirementMaterials, noFormalRequirementsReason: goal.noFormalRequirementsReason, question: goal.researchQuestion },
    requirementsReady, requirementsReady ? 'ready' : 'blocked', requirementsReady ? ['硬要求已确认，研究问题来自本次明确目标；不据此宣称要求已全部满足。'] :
      ['请确认未定或冲突要求。没有正式要求时，需在本次目标中明确说明理由。'], requirements.map(row => row.id))
  const coverage = selectedSources.length >= goal.minimumSources && located.length >= goal.minimumLocatedEvidence
  gate('research', { question: goal.researchQuestion, minimumSources: goal.minimumSources, minimumLocatedEvidence: goal.minimumLocatedEvidence,
    materialHashes, sources: ledger.sources, evidence: ledger.evidence, claims: ledger.claims }, requirementsReady,
    !requirementsReady ? 'blocked' : coverage ? 'ready' : 'insufficient', coverage ?
      [`当前 ${selectedSources.length} 个关联当前文本的来源、${located.length} 条定位证据达到本次数量目标；数量不证明论点支持范围或独立出版身份。`] :
      [`当前只有 ${selectedSources.length} 个关联当前文本的来源、${located.length} 条定位证据；目标 ${goal.minimumSources} 个来源、${goal.minimumLocatedEvidence} 条证据未达到。结束检索需明确保留不足，不能据此允许无依据事实写作。`], located.map(row => row.id).slice(0, 200))
  const outlineReady = requirementsReady && ledger.outline.confirmation === 'confirmed' && !!ledger.outline.sections.length &&
    ledger.outline.researchQuestion.trim() === goal.researchQuestion.trim() && !!ledger.outline.thesis.trim()
  const decisions = await io.read('.scholarflow/context/decisions.md')
  gate('outline', { requirements, requirementMaterials, outline: ledger.outline, claims: ledger.claims, evidence: ledger.evidence, materialHashes,
    decisionsHash: decisions ? digest(decisions.text) : 'missing' }, outlineReady, outlineReady ? 'ready' : 'blocked',
    outlineReady ? ['已存在用户确认的完整大纲；该确认不替代章节的证据门禁。'] : ['先处理要求并明确确认研究问题、中心论点与章节结构。'],
    ledger.outline.sections.map(row => row.id))
  const projection = projectMarkdown(document.text), sections = ledger.outline.sections.map(section => {
    try {
      const target = sectionTarget(document.text, ledger.outline, section.id)
      const paragraphs = projection.blocks.filter(block => block.start >= target.startUtf16 && block.end <= target.endUtf16)
      const claims = section.claimIds.map(id => ledger.claims[id])
      const evidence = claims.flatMap(claim => claim?.evidenceLinks ?? []).map(link => located.find(row => row.id === link.evidenceId)).filter(Boolean)
      return { sectionId: section.id, saved: target.mode === 'replace-body' && paragraphs.length > 0, hasCurrentEvidence: evidence.length > 0,
        paragraphCount: paragraphs.length, gapCount: section.missingEvidence.length }
    } catch { return { sectionId: section.id, saved: false, hasCurrentEvidence: false, paragraphCount: 0, gapCount: section.missingEvidence.length } }
  })
  const draftingComplete = outlineReady && !document.externalChange && !document.initialPlaceholder && sections.every(section => section.saved)
  gate('drafting', { outline: ledger.outline, documentHash: document.contentHash, revisionId: document.revisionId, sections,
    claims: ledger.claims, evidence: ledger.evidence, materialHashes, profileAndContext: input.dependencyHash }, draftingComplete,
    !draftingComplete ? 'blocked' : sections.some(section => !section.hasCurrentEvidence || section.gapCount) ? 'with-issues' : 'ready',
    draftingComplete ? ['各大纲章节均有已保存正文。证据缺口、待补与研究结果仍需按当前稿件审查，阶段完成不代表论文就绪。'] :
      ['先保存各个已确认大纲章节的正文；候选存在或模型自报完成不算已保存初稿。'], sections.filter(section => section.saved).map(section => section.sectionId))
  const currentReview = !!review.report && !review.stale
  gate('review', { dependencyHash: input.dependencyHash, reportHash: review.report ? digest(json(review.report)) : undefined,
    issues: ledger.reviewIssues }, currentReview, currentReview ? review.report!.checks.some(check => check.status !== 'pass') ? 'with-issues' : 'ready' : 'blocked',
    currentReview ? ['审查对应当前输入版本；未知检查与所有旧未关闭问题保持可见，不把一次调用结束当成通过。'] : ['当前稿件尚无同版审查，或主稿／资料／配置已改变；需要重新检查。'],
    review.report ? [review.report.id] : [])
  const proposals = Object.values(ledger.proposalStates).filter(row => row.state === 'pending')
  invariant(proposals.length <= 200, 'WORKFLOW_ARTIFACT_LIMIT', '待处理建议超过工作流检查范围，请先收窄待处理记录。')
  const currentProposals: string[] = []
  for (const state of proposals) {
    const image = await proposalImage(io, state.proposalId), proposal = image.proposal
    if (document.externalChange || proposal.projectId !== ledger.projectId || proposal.scope !== 'selection' || proposal.baseDocumentHash !== document.contentHash || proposal.baseRevisionId !== document.revisionId ||
      !proposal.dependentEvidenceIds.every(id => located.some(row => row.id === id)) ||
      proposal.checks.some(check => check.status === 'fail')) continue
    try { applyEdits(document.text, proposal.edits); currentProposals.push(proposal.id) } catch { /* Stale proposals do not complete the stage. */ }
  }
  gate('revision', { documentHash: document.contentHash, revisionId: document.revisionId, unresolved, proposalStates: ledger.proposalStates,
    currentProposals, evidence: ledger.evidence, materialHashes }, currentProposals.length > 0 || currentReview && !unresolved.length,
    currentReview && !unresolved.length ? 'ready' : currentProposals.length ? 'with-issues' : 'blocked', currentReview && !unresolved.length ? ['当前没有未关闭问题；可说明理由跳过修订建议。'] :
      currentProposals.length ? ['同版修订候选已经保存并通过结构校验。接受候选仍需另外确认；语义问题只在复查通过后关闭。'] :
        ['当前尚无可审阅的同版修订候选或同版审查；问题保持未关闭，不能为了完成阶段删除问题记录。'], currentProposals, currentReview && !unresolved.length)
  const deliveries = Object.values(ledger.deliveries).filter(row => row.documentHash === document.contentHash && row.revisionId === document.revisionId &&
    row.ledgerRevision + 1 === ledger.revision)
  let validDelivery: typeof deliveries[number] | undefined
  for (const manifest of deliveries) {
    if (manifest.reviewState === 'draft-reviewed' && (!currentReview || manifest.reviewId !== review.report!.id)) continue
    try { await readDelivery(io, manifest.id); validDelivery = manifest; break } catch { /* Never reconstruct a missing delivery artifact. */ }
  }
  gate('delivery', { documentHash: document.contentHash, revisionId: document.revisionId, ledgerRevision: ledger.revision,
    dependencyHash: input.dependencyHash, deliveries: ledger.deliveries }, !!validDelivery,
    !validDelivery ? 'blocked' : validDelivery.reviewState === 'draft-reviewed' ? 'ready' : 'with-issues', validDelivery ?
      [`已保存并核对同版交付 ${validDelivery.id}，状态 ${validDelivery.reviewState}。保持实际质量标识，不宣称自动可投稿。`] :
      ['先创建当前稿件与数据版本对应的交付快照，并核对正文、BibTeX 和质量报告文件。'], validDelivery ? [validDelivery.id] : [])
  return { current, gates: output, sections, dependencyHash: input.dependencyHash }
}
