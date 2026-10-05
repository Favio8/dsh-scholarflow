// TEST_ONLY fixtures and fixed model responses; no provider-quality claim.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot, mutateLedger } from '../../src/core/project/project.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { saveManual, buildProposal, storeProposal, rejectProposal, applyProposal } from '../../src/core/editing/proposals.ts'
import { locateIssue, issueFixSelection } from '../../src/core/review/issue-fixes.ts'
import { acceptAndRecheck } from '../../src/core/review/fix-workflow.ts'
import { prepareModelReview, publishModelReview } from '../../src/core/review/model.ts'
import { prepareGeneration, executeGeneration } from '../../src/core/pipeline/generation.ts'
import { digest, json } from '../../src/core/store/files.ts'
import { ScholarError } from '../../src/shared/errors.ts'
import { prepareProposalRevision, publishProposalRevision } from '../../src/core/editing/proposal-revision.ts'
const quote = 'TEST_ONLY 这个判断缺少实际依据。', replacement = 'TEST_ONLY 此判断仍需核对实际依据，当前只适用于所列测试范围。'
async function setup() {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY original bytes\r\n' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY issue fixes', type: 'course-paper' }))
  const initial = await snapshot(io)
  await confirmOutline(io, { ...initial.ledger.outline, researchQuestion: 'TEST_ONLY 依据是什么？', thesis: 'TEST_ONLY 保留范围',
    sections: [{ id: 'section_TEST_ONLY', title: 'TEST_ONLY 正文', purpose: 'TEST_ONLY 有限审查', claimIds: [], missingEvidence: [] }] }, 0, 0)
  await saveManual(io, `# TEST_ONLY 主稿\n\n## TEST_ONLY 正文\n\n${quote}\n\n${quote}\n`, initial.document.contentHash, 1)
  let current = await snapshot(io)
  const plan = await prepareModelReview(io, { context: context(current) }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' })
  const result = await publishModelReview(io, plan, { checks: [{ id: 'argument_assessment', status: 'fail', detail: 'TEST_ONLY 第二段断言的支持范围尚未给出依据。' },
    { id: 'style_assessment', status: 'pass', detail: 'TEST_ONLY 本轮仅核对所列正文的表达形式。' }], findings: [{ category: 'logic', severity: 'B1', title: 'TEST_ONLY 第二段缺少范围',
      explanation: 'TEST_ONLY 此段没有说明证据来源和适用边界。', suggestedFix: 'TEST_ONLY 保留待核对状态并收窄范围。', blockId: plan.context.blocks.at(-1)!.id, quote, claimIds: [], evidenceIds: [], requirementIds: [] }], rechecks: [], limitations: ['TEST_ONLY 固定响应。'] })
  const issue = result.report.issues.find(row => row.location)!
  current = await snapshot(io)
  return { io, issue, current, selection: issueFixSelection(current, issue.id) }
}
function context(current: Awaited<ReturnType<typeof snapshot>>) {
  return { requestId: 'req_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY', sessionId: 'session_TEST_ONLY', projectId: current.ledger.projectId, expectedLedgerRevision: current.ledger.revision }
}
function candidate(current: Awaited<ReturnType<typeof snapshot>>, issueId: string) {
  return buildProposal(current, { runId: 'run_TEST_ONLY_fix', instruction: 'TEST_ONLY 修复范围并保留原文。', replacementText: replacement,
    selection: issueFixSelection(current, issueId), reviewIssueId: issueId, dependentEvidenceIds: [] })
}

test('operator edits preserve issue provenance and restore the original risk decision after both candidates are rejected', async () => {
  const { io, issue } = await setup()
  await mutateLedger(io, (await snapshot(io)).ledger.revision, ledger => { ledger.reviewIssues[issue.id].state = 'accepted-risk'; ledger.reviewIssues[issue.id].resolutionReason = 'TEST_ONLY 风险保留待补证据。' })
  const current = await snapshot(io), parent = candidate(current, issue.id), stored = await storeProposal(io, parent, current.ledger.revision)
  const plan = await prepareProposalRevision(io, { context: context(await snapshot(io)), proposalId: parent.id, proposalHash: stored.proposalHash, replacementText: replacement + ' TEST_ONLY 再核对边界。' })
  const child = await publishProposalRevision(io, plan, 'session_TEST_ONLY')
  assert.equal(plan.proposal.reviewIssue?.issueId, issue.id)
  assert.equal((await snapshot(io)).document.text, current.document.text)
  await rejectProposal(io, parent.id, child.revision)
  assert.equal((await snapshot(io)).ledger.reviewIssues[issue.id].state, 'proposed-fix')
  await rejectProposal(io, plan.proposal.id, (await snapshot(io)).ledger.revision)
  assert.equal((await snapshot(io)).ledger.reviewIssues[issue.id].state, 'accepted-risk')
  assert.equal((await snapshot(io)).ledger.reviewIssues[issue.id].resolutionReason, 'TEST_ONLY 风险保留待补证据。')
})

test('SF-024: issue fix uses the second exact paragraph, checkpoints its cause and stays proposed until explicit semantic recheck', async () => {
  const { io, issue, current, selection } = await setup(), original = current.document.text
  assert.equal(locateIssue(current, issue.id).issue.location!.sourceRange.startUtf16, original.lastIndexOf(quote))
  const plan = await prepareGeneration(io, { context: context(current), instruction: 'TEST_ONLY 修复所列问题。', selection, reviewIssueId: issue.id }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' })
  assert.equal((plan.context.reviewIssue as any).id, issue.id)
  const result = await executeGeneration(io, plan, { pid: 12345, bootInstance: 'TEST_ONLY-fix' }, new AbortController().signal, async call => {
    assert.equal((call.context.manuscript as any).sourceText, quote)
    return json({ replacementText: replacement, limitations: ['TEST_ONLY 未完成学术事实核验。'] })
  }, () => true)
  assert.equal(result.proposal!.reviewIssue!.issueId, issue.id)
  assert.equal((await snapshot(io)).ledger.reviewIssues[issue.id].state, 'proposed-fix')
  assert.equal((await snapshot(io)).document.text, original)
  const accepted = await acceptAndRecheck(io, result.proposal!.id, (await snapshot(io)).ledger.revision, result.proposalHash!)
  assert.equal('recheck' in accepted && accepted.recheck.status, 'completed')
  const after = await snapshot(io)
  assert.equal(after.document.text, original.slice(0, original.lastIndexOf(quote)) + replacement + '\n')
  assert.equal(after.ledger.reviewIssues[issue.id].state, 'proposed-fix'); assert.equal(after.ledger.reviewIssues[issue.id].stale, true)
  assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY original bytes\r\n')
  const revision = after.ledger.revision, again = await acceptAndRecheck(io, result.proposal!.id, revision, result.proposalHash!)
  assert.equal(again.alreadyApplied, true); assert.equal((await snapshot(io)).ledger.revision, revision)
  const next = await prepareModelReview(io, { context: context(await snapshot(io)) }, { providerId: 'TEST_ONLY', modelId: 'TEST_ONLY' })
  await publishModelReview(io, next, { checks: [{ id: 'argument_assessment', status: 'pass', detail: 'TEST_ONLY 已针对新稿的范围逐项复核。' }, { id: 'style_assessment', status: 'pass', detail: 'TEST_ONLY 已核对当前新稿的表达形式。' }], findings: [],
    rechecks: [{ issueId: issue.id, status: 'pass', reason: 'TEST_ONLY 修订后保留待核对状态并收窄判断范围，原问题已针对当前稿件复查。', blockId: next.context.blocks.at(-1)!.id, quote: replacement }], limitations: ['TEST_ONLY 固定复查。'] })
  assert.equal((await snapshot(io)).ledger.reviewIssues[issue.id].state, 'resolved')
})

test('rejecting the only issue fix keeps manuscript bytes and restores its unresolved state', async () => {
  const { io, current, issue } = await setup(), proposal = candidate(current, issue.id), saved = await storeProposal(io, proposal, current.ledger.revision)
  await rejectProposal(io, proposal.id, saved.revision)
  const after = await snapshot(io)
  assert.equal(after.document.text, current.document.text); assert.equal(after.ledger.reviewIssues[issue.id].state, 'open')
  assert.ok(await io.read(`.scholarflow/reviews/fixes/${proposal.id}.json`)); assert.equal(after.ledger.proposalStates[proposal.id].state, 'rejected')
})

test('rejecting multiple candidates restores the original explicit risk decision without marking the problem resolved', async () => {
  const { io, issue } = await setup()
  await mutateLedger(io, (await snapshot(io)).ledger.revision, ledger => { ledger.reviewIssues[issue.id].state = 'accepted-risk'; ledger.reviewIssues[issue.id].resolutionReason = 'TEST_ONLY 用户保留风险以待补证据。' })
  const before = await snapshot(io), first = candidate(before, issue.id), one = await storeProposal(io, first, before.ledger.revision)
  const secondCurrent = await snapshot(io), second = candidate(secondCurrent, issue.id), two = await storeProposal(io, second, one.revision)
  await rejectProposal(io, first.id, two.revision)
  assert.equal((await snapshot(io)).ledger.reviewIssues[issue.id].state, 'proposed-fix')
  await rejectProposal(io, second.id, (await snapshot(io)).ledger.revision)
  const after = await snapshot(io)
  assert.equal(after.ledger.reviewIssues[issue.id].state, 'accepted-risk'); assert.equal(after.document.text, before.document.text)
  assert.equal(after.ledger.reviewIssues[issue.id].resolutionReason, 'TEST_ONLY 用户保留风险以待补证据。')
})

test('forged issue scopes and changed causes fail before storing or accepting fixes', async () => {
  const { io, issue, current, selection } = await setup()
  const forged = { ...selection, sourceRange: { startUtf16: current.document.text.indexOf(quote), endUtf16: current.document.text.indexOf(quote) + quote.length } }
  assert.throws(() => buildProposal(current, { runId: 'run_TEST_ONLY_fix', instruction: 'TEST_ONLY', replacementText: replacement, selection: forged, reviewIssueId: issue.id, dependentEvidenceIds: [] }))
  const proposal = candidate(current, issue.id), stored = await storeProposal(io, proposal, current.ledger.revision)
  await mutateLedger(io, stored.revision, ledger => { ledger.reviewIssues[issue.id].explanation += 'TEST_ONLY 后续复核发现变化。' })
  const before = await snapshot(io)
  await assert.rejects(acceptAndRecheck(io, proposal.id, before.ledger.revision, stored.proposalHash), { code: 'ISSUE_FIX_CHANGED' })
  assert.equal((await snapshot(io)).document.text, current.document.text)
  await saveManual(io, before.document.text + '\nTEST_ONLY 后续人工内容。\n', before.document.contentHash, before.ledger.revision)
  assert.throws(() => issueFixSelection(before, 'issue_TEST_ONLY_missing'), { code: 'ISSUE_LOCATION_STALE' })
  assert.throws(() => issueFixSelection({ ...before, document: { ...before.document, contentHash: digest('TEST_ONLY changed') } }, issue.id), { code: 'ISSUE_LOCATION_STALE' })
})

test('a failed follow-up recheck reports the durable accepted revision without reapplying or losing user text', async () => {
  const { io, issue, current } = await setup(), proposal = candidate(current, issue.id), stored = await storeProposal(io, proposal, current.ledger.revision)
  const lock = io.lock.bind(io); let locks = 0
  io.lock = fn => { if (++locks === 2) return Promise.reject(new ScholarError('STALE_LEDGER_REVISION', 'TEST_ONLY follow-up conflict')); return lock(fn) }
  const result = await acceptAndRecheck(io, proposal.id, stored.revision, stored.proposalHash)
  assert.equal('recheck' in result && result.recheck.status, 'needs-attention'); assert.equal(result.alreadyApplied, false)
  assert.equal((await snapshot(io)).ledger.proposalStates[proposal.id].state, 'accepted')
  assert.ok((await snapshot(io)).document.text.includes(replacement)); assert.ok((await snapshot(io)).document.text.includes(quote))
})

test('a crash after accepting a fix resumes its pending rule recheck once, while later manual edits are preserved', async () => {
  const { io, current, issue } = await setup(), proposal = candidate(current, issue.id), stored = await storeProposal(io, proposal, current.ledger.revision)
  const accepted = await applyProposal(io, proposal.id, stored.revision, stored.proposalHash), body = (await snapshot(io)).document.text
  const settled = await acceptAndRecheck(io, proposal.id, accepted.revision!, stored.proposalHash)
  assert.equal(settled.alreadyApplied, true); assert.equal('recheck' in settled && settled.recheck.status, 'completed')
  assert.equal((await snapshot(io)).document.text, body)
  const stable = (await snapshot(io)).ledger.revision
  await acceptAndRecheck(io, proposal.id, stable, stored.proposalHash)
  assert.equal((await snapshot(io)).ledger.revision, stable)
  const other = await setup(), old = candidate(other.current, other.issue.id), oldSaved = await storeProposal(other.io, old, other.current.ledger.revision)
  await applyProposal(other.io, old.id, oldSaved.revision, oldSaved.proposalHash)
  const changed = await snapshot(other.io)
  await saveManual(other.io, changed.document.text + '\nTEST_ONLY 后续人工文字。\n', changed.document.contentHash, changed.ledger.revision)
  const later = await snapshot(other.io), result = await acceptAndRecheck(other.io, old.id, later.ledger.revision, oldSaved.proposalHash)
  assert.equal('recheck' in result && result.recheck.status, 'needs-attention')
  assert.equal((await snapshot(other.io)).document.text, later.document.text); assert.equal((await snapshot(other.io)).ledger.revision, later.ledger.revision)
})
