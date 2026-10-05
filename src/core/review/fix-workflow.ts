import { applyProposal, proposalImage } from '../editing/proposals.ts'
import { runReview } from './review.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { digest, json, type FileStore } from '../store/files.ts'
import { snapshot } from '../project/project.ts'
import { reviewReportSchema } from '../../shared/review.ts'

export async function acceptAndRecheck(io: FileStore, proposalId: string, revision: number, proposalHash: string) {
  const image = await proposalImage(io, proposalId)
  invariant(image.contentHash === proposalHash, 'PROPOSAL_CHANGED', '修复建议内容改变，请重新审阅。')
  const accepted = await applyProposal(io, proposalId, revision, proposalHash)
  if (!image.proposal.reviewIssue) return accepted
  try {
    const path = `.scholarflow/reviews/fixes/${proposalId}-recheck.json`, file = await io.read(path)
    invariant(file, 'RECHECK_RECORD_MISSING', '修复待复查记录缺失。')
    const record = JSON.parse(file.text), current = await snapshot(io)
    invariant(record.schemaVersion === 1 && record.projectId === image.proposal.projectId && record.proposalId === proposalId &&
      record.issueId === image.proposal.reviewIssue.issueId && record.documentHash === accepted.documentHash && record.revisionId === accepted.revisionId,
      'RECHECK_RECORD_CHANGED', '修复待复查记录与实际保存稿件不同。')
    if (record.state === 'completed') {
      const report = await io.read(`.scholarflow/reviews/${reviewReportSchema.shape.id.parse(record.reviewId)}/report.json`)
      invariant(report && digest(report.text) === record.reportHash, 'RECHECK_RECORD_CHANGED', '复查完成记录没有可验证的报告。')
      const parsed = reviewReportSchema.parse(JSON.parse(report.text))
      invariant(parsed.projectId === record.projectId && parsed.documentHash === accepted.documentHash && parsed.revisionId === accepted.revisionId, 'RECHECK_RECORD_CHANGED', '复查报告与接受修订不符。')
      return accepted
    }
    invariant(record.state === 'pending' && current.document.contentHash === accepted.documentHash && current.document.revisionId === accepted.revisionId && !current.document.externalChange,
      'STALE_DOCUMENT_VERSION', '接受后的稿件已改变，请明确审查当前版本。')
    const result = await runReview(io, accepted.alreadyApplied ? current.ledger.revision : accepted.revision!, report => [{ path, before: file,
      after: json({ ...record, state: 'completed', reviewId: report.id, reportHash: digest(json(report)) }) }])
    return { ...accepted, revision: result.revision, recheck: { status: 'completed', reviewId: result.report.id, issueId: image.proposal.reviewIssue.issueId,
      detail: '已复查当前稿件的确定性约束；已定位的模型问题仍需明确模型或人工语义复查，不因接受建议自动关闭。' } }
  } catch (error) {
    // The accepted revision is already durable. Failure of the follow-up must
    // never masquerade as a failed apply or trigger a second manuscript write.
    return { ...accepted, recheck: { status: 'needs-attention', issueId: image.proposal.reviewIssue.issueId,
      errorCode: error instanceof ScholarError ? error.code : 'RECHECK_FAILED', detail: '建议已接受并保存，随后复查未完成；请刷新并针对当前版本重新审查。' } }
  }
}
