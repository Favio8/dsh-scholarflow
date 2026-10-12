import { snapshot } from '../project/project.ts'
import { inspectReview, runReview } from './review.ts'
import { issueFixSelection } from './issue-fixes.ts'
import { applyReviewImprovements, proposalImage } from '../editing/proposals.ts'
import { ScholarError } from '../../shared/errors.ts'
import { json, digest, type FileStore } from '../store/files.ts'

/** Group current findings by their verified paragraph; metadata gaps are not invented edits. */
export async function inspectImprovements(io: FileStore) {
  const current = await snapshot(io), review = await inspectReview(io)
  const groups = new Map<string, { issueId: string; issueIds: string[]; blockId: string; instruction: string }>()
  const issues = Object.values(current.ledger.reviewIssues).filter(issue => !issue.stale && issue.documentHash === current.document.contentHash && ['open', 'proposed-fix'].includes(issue.state))
  if (!review.stale && !current.document.externalChange) for (const issue of issues) {
    if (!issue.location) continue
    let selection
    try { selection = issueFixSelection(current, issue.id) }
    catch (error) { if (error instanceof ScholarError && ['SELECTION_UNSUPPORTED', 'ISSUE_LOCATION_STALE'].includes(error.code)) continue; throw error }
    const blockId = selection.blockIds[0], instruction = `${issue.title}\n${issue.suggestedFix ?? issue.explanation}`
    const group = groups.get(blockId)
    if (group) { group.issueIds.push(issue.id); group.instruction += '\n\n' + instruction }
    else groups.set(blockId, { issueId: issue.id, issueIds: [issue.id], blockId, instruction: '修复本段以下问题，保留事实、限定条件、引用和其他人工内容；仅返回完整段落候选。\n\n' + instruction })
  }
  const proposals = [], occupied = new Set<string>()
  for (const state of Object.values(current.ledger.proposalStates).filter(row => row.state === 'pending').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const image = await proposalImage(io, state.proposalId), proposal = image.proposal
    if (!proposal.reviewIssue || proposal.projectId !== current.ledger.projectId || proposal.baseDocumentHash !== current.document.contentHash || proposal.baseRevisionId !== current.document.revisionId) continue
    const group = [...groups.values()].find(row => row.issueIds.includes(proposal.reviewIssue!.issueId))
    if (!group || occupied.has(group.blockId)) continue
    const recordFile = await io.read(`.scholarflow/reviews/fixes/${proposal.id}.json`)
    if (!recordFile) continue
    const record = JSON.parse(recordFile.text), issue = current.ledger.reviewIssues[proposal.reviewIssue.issueId]
    const { state: _currentState, ...currentIssue } = issue, { state: _originalState, ...originalIssue } = record.originalIssue
    if (record.projectId !== proposal.projectId || record.proposalId !== proposal.id || record.proposalHash !== image.contentHash ||
      digest(json(record.originalIssue)) !== proposal.reviewIssue.issueHash || json(currentIssue) !== json(originalIssue)) continue
    occupied.add(group.blockId); proposals.push({ proposal, proposalHash: image.contentHash })
  }
  proposals.sort((a, b) => a.proposal.edits[0].startUtf16 - b.proposal.edits[0].startUtf16)
  const needsMaterials = issues.some(issue => {
    if (issue.category !== 'evidence' || issue.location) return false
    const source = Object.values(current.ledger.sources).find(row => issue.title.includes(row.id))
    return source ? source.textAccess !== 'fulltext' : issue.evidenceIds.length > 0
  })
  return { groups: [...groups.values()], proposals, needsMaterials, stale: review.stale, documentHash: current.document.contentHash }
}

export async function acceptImprovementsAndRecheck(io: FileStore, refs: Array<{ proposalId: string; proposalHash: string }>, revision: number) {
  const accepted = await applyReviewImprovements(io, refs, revision)
  if (accepted.alreadyApplied) return accepted
  try {
    const records = await Promise.all(refs.map(async ref => {
      const path = `.scholarflow/reviews/fixes/${ref.proposalId}-recheck.json`, before = (await io.read(path))!
      return { path, before, record: JSON.parse(before.text) }
    }))
    const result = await runReview(io, accepted.revision!, report => records.map(({ path, before, record }) => ({ path, before,
      after: json({ ...record, state: 'completed', reviewId: report.id, reportHash: digest(json(report)) }) })))
    return { ...accepted, revision: result.revision, recheck: { status: 'completed', reviewId: result.report.id } }
  } catch (error) {
    return { ...accepted, recheck: { status: 'needs-attention', errorCode: error instanceof ScholarError ? error.code : 'RECHECK_FAILED' } }
  }
}
