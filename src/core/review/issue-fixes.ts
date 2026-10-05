import { invariant } from '../../shared/errors.ts'
import { digest } from '../store/files.ts'
import { projectMarkdown, validateRange, validateSelection, unicodeBoundary } from '../editing/markdown.ts'
import type { SelectionPayload } from '../../shared/editing.ts'
import type { snapshot } from '../project/project.ts'

type Current = Awaited<ReturnType<typeof snapshot>>
export function locateIssue(current: Current, issueId: string) {
  const issue = current.ledger.reviewIssues[issueId], location = issue?.location
  invariant(issue && location && issue.documentId === 'paper' && issue.documentHash === current.document.contentHash && !current.document.externalChange && !issue.stale,
    'ISSUE_LOCATION_STALE', '问题没有当前稿件的有效位置；请先按当前版本复查，不猜测相似文本。')
  const projection = projectMarkdown(current.document.text), block = projection.blocks.find(row => row.id === location.blockId), range = location.sourceRange
  invariant(block && range.startUtf16 >= block.start && range.endUtf16 <= block.end && range.endUtf16 > range.startUtf16 &&
    digest(current.document.text.slice(block.start, block.end)) === location.blockTextHash && current.document.text.slice(range.startUtf16, range.endUtf16) === location.quote &&
    unicodeBoundary(current.document.text, range.startUtf16) && unicodeBoundary(current.document.text, range.endUtf16),
    'ISSUE_LOCATION_STALE', '问题源码位置、引文或段落摘要不符，未自动重定位。')
  return { issue, block, projection }
}
export function issueFixSelection(current: Current, issueId: string): SelectionPayload {
  const { issue, block, projection } = locateIssue(current, issueId)
  invariant(issue.state !== 'resolved', 'ISSUE_NOT_OPEN', '已复查关闭的问题不能生成修复。')
  const range = validateRange(projection, block.start, block.end, 'paragraph')
  const claimIds = [...new Set(Object.values(current.ledger.claimAnchors).filter(anchor => anchor.status === 'current' && anchor.documentHash === current.document.contentHash &&
    anchor.documentId === 'paper' && anchor.blockId === block.id).flatMap(anchor => anchor.claimIds))]
  return { projectId: current.ledger.projectId, documentId: 'paper', documentHash: current.document.contentHash, revisionId: current.document.revisionId,
    blockIds: [block.id], sourceRange: { startUtf16: block.start, endUtf16: block.end }, sourceText: current.document.text.slice(block.start, block.end), renderedText: range.renderedText,
    prefixContext: current.document.text.slice(Math.max(0, block.start - 200), block.start), suffixContext: current.document.text.slice(block.end, block.end + 200),
    citationKeys: range.citationKeys, claimIds, scope: 'paragraph', capturedAt: new Date().toISOString() }
}
export function validateIssueFix(current: Current, issueId: string, selection: SelectionPayload) {
  const { issue, block } = locateIssue(current, issueId)
  invariant(issue.state !== 'resolved' && selection && selection.projectId === current.ledger.projectId && selection.documentHash === current.document.contentHash &&
    selection.revisionId === current.document.revisionId && selection.scope === 'paragraph' && selection.sourceRange.startUtf16 === block.start && selection.sourceRange.endUtf16 === block.end,
    'ISSUE_FIX_SCOPE_INVALID', '修复必须基于当前问题的完整普通段落，不扩展到其他段落。')
  validateSelection(current.document.text, selection)
  const actualClaims = issueFixSelection(current, issueId).claimIds
  invariant(selection.claimIds.length === actualClaims.length && new Set(selection.claimIds).size === actualClaims.length && selection.claimIds.every(id => actualClaims.includes(id)),
    'ISSUE_FIX_SCOPE_INVALID', '问题修复关联必须来自目标段落当前已确认的论点锚点。')
  return issue
}
