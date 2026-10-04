import { manualReviewRequest, reviewReportSchema } from '../../shared/review.ts'
import { invariant } from '../../shared/errors.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { reviewInput, inspectReview, manualEligibleChecks, storeReview } from './review.ts'

export async function prepareManualReview(io: FileStore, request: unknown) {
  const input = manualReviewRequest.parse(request), current = await reviewInput(io), review = await inspectReview(io)
  invariant(input.context.projectId === current.current.ledger.projectId && input.context.expectedLedgerRevision === current.current.ledger.revision,
    'STALE_LEDGER_REVISION', '人工复核需要当前项目与数据版本。')
  invariant(review.report && !review.stale && review.report.id === input.reviewId, 'REVIEW_INPUT_CHANGED', '人工复核须针对当前同版本审查，请先重跑过期检查。')
  const eligible = new Set(manualEligibleChecks(review.report, current)), ledger = current.current.ledger
  invariant(new Set(input.assessments.map(row => row.checkId)).size === input.assessments.length, 'MANUAL_REVIEW_INVALID', '同一检查不能重复提交相互矛盾的人工结果。')
  for (const assessment of input.assessments) {
    invariant(eligible.has(assessment.checkId), 'MANUAL_REVIEW_UNAVAILABLE', '此检查须由对应规则或来源核验完成，人工确认不能绕过缺失数据或硬真实性阻塞。')
    invariant(assessment.claimIds.every(id => ledger.claims[id]) && assessment.requirementIds.every(id => ledger.requirements[id]?.confirmation === 'confirmed'),
      'MANUAL_REVIEW_INVALID', '人工复核引用了不存在的论点或未确认要求。')
    invariant(assessment.evidenceIds.every(id => {
      const evidence = ledger.evidence[id], source = evidence && ledger.sources[evidence.sourceId]
      return evidence?.validation === 'located' && source?.contentHash === evidence.sourceContentHash && source.materialId && current.materialHashes[source.materialId] === evidence.sourceContentHash
    }), 'MANUAL_REVIEW_INVALID', '人工复核引用的证据须仍可定位，且原材料未改变。')
    if (assessment.checkId.startsWith('requirement_')) invariant(assessment.requirementIds.includes(assessment.checkId.slice('requirement_'.length)),
      'MANUAL_REVIEW_INVALID', '人工要求复核需记录对应要求身份。')
    if (assessment.checkId === 'own_research_results') {
      invariant(assessment.evidenceIds.length && assessment.evidenceIds.every(id => ledger.evidence[id].kind === 'user-measurement' &&
        ledger.evidence[id].measurement?.origin === 'user-supplied' && ledger.sources[ledger.evidence[id].sourceId].kind === 'user-result'),
        'MANUAL_REVIEW_INVALID', '实验复核须引用本项目用户测量，并核对设置、记录和正文；不能使用其他论文结果。')
    }
  }
  const body = { id: newId('manualreview'), request: input, projectId: ledger.projectId, expectedRevision: ledger.revision,
    ledgerHash: current.current.ledgerHash, dependencyHash: current.dependencyHash, parentReport: review.report, parentHash: digest(json(review.report)) }
  return { ...body, contentHash: digest(json(body)) }
}
export type ManualReviewPlan = Awaited<ReturnType<typeof prepareManualReview>>
export async function submitManualReview(io: FileStore, plan: ManualReviewPlan, sourceSessionId: string) {
  const { contentHash, ...body } = plan
  invariant(contentHash === digest(json(body)), 'INVALID_APPROVAL', '人工复核计划改变。')
  const current = await reviewInput(io), review = await inspectReview(io)
  invariant(current.current.ledgerHash === plan.ledgerHash && current.dependencyHash === plan.dependencyHash && review.report && !review.stale && digest(json(review.report)) === plan.parentHash,
    'REVIEW_INPUT_CHANGED', '人工确认期间项目或审查改变，未保存过期复核。')
  await prepareManualReview(io, plan.request) // Validate the actual check/data gates again.
  const reviewId = newId('review'), assessed = new Map(plan.request.assessments.map(row => [row.checkId, row])), report = structuredClone(plan.parentReport)
  report.id = reviewId; report.parentReviewId = plan.parentReport.id; report.manualAssessmentId = plan.id; report.createdAt = new Date().toISOString(); report.ledgerRevision = plan.expectedRevision
  report.checks = report.checks.map(check => { const assessment = assessed.get(check.id); return assessment ? {
    ...check, method: 'manual' as const, status: assessment.status, detail: `人工复核 ${check.id}：${assessment.reason}；证据 ${assessment.evidenceIds.join(', ') || '无新增证据'}；论点 ${assessment.claimIds.join(', ') || '未指定'}；要求 ${assessment.requirementIds.join(', ') || '未指定'}。人工判断不替代来源身份或原始数据核验。` } : check })
  report.issues = report.issues.filter(issue => ![...assessed.values()].some(row => row.status === 'pass' && issue.id === `issue_${digest(row.checkId).slice(7, 31)}`))
    .map(issue => { const assessment = [...assessed.values()].find(row => issue.id === `issue_${digest(row.checkId).slice(7, 31)}`)
      return { ...issue, reviewId, ...(assessment && { checkMethod: 'manual' as const, explanation: assessment.reason, claimIds: assessment.claimIds,
        evidenceIds: assessment.evidenceIds, requirementIds: assessment.requirementIds }) } })
  for (const assessment of plan.request.assessments.filter(row => row.status !== 'pass')) {
    const issueId = `issue_${digest(assessment.checkId).slice(7, 31)}`
    if (report.issues.some(issue => issue.id === issueId)) continue
    const previous = current.current.ledger.reviewIssues[issueId]
    invariant(previous, 'MANUAL_REVIEW_INVALID', '缺少对应复核问题依据，请先重跑确定性审查。')
    report.issues.push({ ...previous, reviewId, checkMethod: 'manual', state: 'open', stale: false, resolutionReason: undefined, title: assessment.reason, explanation: assessment.reason,
      claimIds: assessment.claimIds, evidenceIds: assessment.evidenceIds, requirementIds: assessment.requirementIds })
  }
  report.limitations = [...report.limitations.filter(line => !line.startsWith('本轮只执行')), '本次人工复核仅覆盖列出的检查、当前正文与输入版本；不提供学术真实性保证，未执行与未知项目保持可见。']
  const artifact = { schemaVersion: 1, id: plan.id, projectId: plan.projectId, sourceSessionId, confirmedAt: report.createdAt, parentReviewId: plan.parentReport.id,
    reviewId, dependencyHash: plan.dependencyHash, assessments: plan.request.assessments, approvedPlanHash: plan.contentHash }
  return storeReview(io, reviewReportSchema.parse(report), plan.expectedRevision, plan.request.assessments.filter(row => row.status === 'pass').map(row => row.checkId),
    [{ path: `.scholarflow/reviews/manual/${plan.id}.json`, before: undefined, after: json(artifact) }])
}
