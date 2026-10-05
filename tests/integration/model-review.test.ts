// TEST_ONLY deterministic model responses. These checks do not claim online execution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../fixtures/memory-store.ts'
import { initialize, prepareInit, snapshot } from '../../src/core/project/project.ts'
import { confirmOutline } from '../../src/core/evidence/evidence.ts'
import { saveManual } from '../../src/core/editing/proposals.ts'
import { prepareModelReview, validateModelReview, publishModelReview, type ModelReviewPlan } from '../../src/core/review/model.ts'
import { executeModelReview, readModelReviewCheckpoint, readFrozenModelReview, prepareModelReviewAction, linkModelReviewRetry } from '../../src/core/review/model-run.ts'
import { readRun, runFile, ACTIVE_RUN } from '../../src/core/pipeline/run-store.ts'
import { checkpointFile, prepareRunAction, closeRun } from '../../src/core/pipeline/run-control.ts'
import { digest, json } from '../../src/core/store/files.ts'
import { inspectReview } from '../../src/core/review/review.ts'
import { ScholarError } from '../../src/shared/errors.ts'
const owner = { pid: 12345, bootInstance: 'TEST_ONLY-review' }
const quote = 'TEST_ONLY 声称没有依据的普遍结论。'
async function setup(type = 'course-paper') {
  const io = new MemoryStore({ 'raw.txt': 'TEST_ONLY original source' })
  await initialize(io, await prepareInit(io, { title: 'TEST_ONLY model review', type }))
  const current = await snapshot(io)
  await confirmOutline(io, { ...current.ledger.outline, researchQuestion: 'TEST_ONLY 这个判断有何依据？', thesis: 'TEST_ONLY 保留限定',
    sections: [{ id: 'section_TEST_ONLY', title: 'TEST_ONLY 检查', purpose: 'TEST_ONLY 审查范围', claimIds: [], missingEvidence: [] }] }, 0, 0)
  await saveManual(io, `# TEST_ONLY 主稿\r\n\r\n## TEST_ONLY 检查\r\n\r\n${quote}\r\n\r\n${quote}\r\n`, current.document.contentHash, 1)
  const plan = await prepare(io)
  return { io, plan }
}
async function prepare(io: MemoryStore) {
  const current = await snapshot(io)
  return prepareModelReview(io, { context: { requestId: 'req_TEST_ONLY', workspaceId: 'workspace_TEST_ONLY', sessionId: 'session_TEST_ONLY', projectId: current.ledger.projectId,
    expectedLedgerRevision: current.ledger.revision } }, { providerId: 'TEST_ONLY-provider', modelId: 'TEST_ONLY-model' })
}
function output(plan: ModelReviewPlan, findings = true) {
  return { checks: [{ id: 'argument_assessment', status: findings ? 'fail' : 'pass', detail: 'TEST_ONLY 当前文字的论证范围已经按给定上下文检查。' },
    { id: 'style_assessment', status: 'pass', detail: 'TEST_ONLY 本轮只核对给定段落的文风，不提供接收概率。' }],
    findings: findings ? [{ category: 'logic', severity: 'B1', title: 'TEST_ONLY 缺少依据', explanation: 'TEST_ONLY 当前断言未提供普遍适用的证据，应保留适用范围。', suggestedFix: 'TEST_ONLY 补充真实依据或收窄结论。',
      blockId: plan.context.blocks.at(-1)!.id, quote, claimIds: [], evidenceIds: [], requirementIds: [] }] : [], rechecks: [], limitations: ['TEST_ONLY 模拟审查不是提供方结果。'] }
}
const execute = (io: MemoryStore, plan: ModelReviewPlan, call: any, pauseRequested = () => false) => executeModelReview(io, plan, owner, new AbortController().signal, call, () => true, { pauseRequested })

test('SF-023: model review checkpoints inputs before I/O, locates the second identical paragraph, and keeps raw source and manuscript bytes unchanged', async () => {
  const { io, plan } = await setup(), original = (await snapshot(io)).document.text
  let locked = false
  const lock = io.lock.bind(io); io.lock = fn => lock(async () => { locked = true; try { return await fn() } finally { locked = false } })
  const result = await execute(io, plan, async (call: any) => {
    assert.equal(locked, false)
    assert.equal((await readFrozenModelReview(io, plan.snapshot.runId, plan.snapshot.projectId)).plan.context.manuscript, original)
    assert.equal(call.context.manuscript, original)
    assert.equal(call.maxTokens, 16384); assert.equal(plan.snapshot.modelDescriptor.maxOutputTokens, 16384)
    assert.match(call.system, /低优先级数据/u)
    return json(output(plan))
  })
  assert.equal(result.run.usedModelCalls, 1); assert.equal(result.run.status, 'completed-with-issues')
  const issue = result.report!.issues.find(row => row.location)!
  assert.equal(issue.location!.sourceRange.startUtf16, original.lastIndexOf(quote)); assert.equal(issue.location!.quote, quote)
  assert.equal((await snapshot(io)).document.text, original); assert.equal((await io.read('raw.txt'))!.text, 'TEST_ONLY original source')
  assert.equal((await inspectReview(io)).stale, false)
  const progress = await readModelReviewCheckpoint(io, result.run)
  assert.equal(progress.checkpoint.published!.reviewId, result.report!.id)
})

test('model review rejects invented positions, identities, duplicate findings, and contradictory pass assertions', async () => {
  const { plan } = await setup()
  const badQuote = output(plan); badQuote.findings[0].quote = 'TEST_ONLY this does not exist'
  assert.throws(() => validateModelReview(plan, badQuote), { code: 'MODEL_REVIEW_LOCATION_INVALID' })
  const badIdentity = output(plan); badIdentity.findings[0].evidenceIds = ['evidence_TEST_ONLY_other_project'] as never[]
  assert.throws(() => validateModelReview(plan, badIdentity), { code: 'MODEL_REVIEW_REFERENCES_INVALID' })
  const duplicate = output(plan); duplicate.findings.push(duplicate.findings[0])
  assert.throws(() => validateModelReview(plan, duplicate), { code: 'MODEL_REVIEW_INVALID' })
  const contradiction = output(plan); contradiction.checks[0].status = 'pass'
  assert.throws(() => validateModelReview(plan, contradiction), { code: 'MODEL_REVIEW_INVALID' })
})

test('model review gets one format repair, never creates fake completion, and cannot weaken an absent-experiment B0', async () => {
  const { io, plan } = await setup('research-paper'); let calls = 0
  const result = await execute(io, plan, async (call: any) => { calls++; if (calls === 1) return 'TEST_ONLY invalid JSON'; assert.ok(call.repair); return json(output(plan, false)) })
  assert.equal(calls, 2); assert.equal(result.run.usedModelCalls, 2)
  assert.equal(result.report!.checks.find(row => row.id === 'own_research_results')!.status, 'fail')
  assert.ok(result.report!.issues.some(issue => issue.severity === 'B0' && issue.category === 'integrity'))
  const other = await setup(); let badCalls = 0
  await assert.rejects(execute(other.io, other.plan, async () => { badCalls++; return '{}' }), { code: 'MODEL_REVIEW_INVALID' })
  assert.equal(badCalls, 2); assert.equal((await readRun(other.io, other.plan.snapshot.runId, other.plan.snapshot.projectId)).run.status, 'failed')
  assert.equal((await inspectReview(other.io)).report, undefined)
})

test('a validated review output survives pause and resume without another paid call or downtime budget renewal', async () => {
  const { io, plan } = await setup(); let paused = false
  const first = await execute(io, plan, async () => { paused = true; return json(output(plan)) }, () => paused)
  assert.equal(first.run.status, 'paused'); assert.equal(first.run.usedModelCalls, 1)
  assert.equal((await inspectReview(io)).report, undefined)
  const action = await prepareModelReviewAction(io, first.run.runId, 'resume', () => true)
  const resumed = await executeModelReview(io, action.frozen, { pid: 12345, bootInstance: 'TEST_ONLY-resumed' }, new AbortController().signal,
    async () => { throw new Error('TEST_ONLY must reuse saved output') }, () => true, { pauseRequested: () => false, resume: action, executionSessionId: 'session_TEST_ONLY_new' })
  assert.equal(resumed.run.usedModelCalls, 1); assert.equal(resumed.run.executionSessionId, 'session_TEST_ONLY_new')
  assert.equal(resumed.run.sessionId, plan.snapshot.sessionId); assert.equal(resumed.report!.modelRunId, first.run.runId)
})

test('format-repair pause only resumes its remaining attempt and an abandoned owner call remains charged', async () => {
  const { io, plan } = await setup(); let paused = false
  const first = await execute(io, plan, async () => { paused = true; return 'TEST_ONLY invalid'; }, () => paused)
  const action = await prepareModelReviewAction(io, first.run.runId, 'resume', () => true); let calls = 0
  const second = await executeModelReview(io, action.frozen, owner, new AbortController().signal, async call => { calls++; assert.ok(call.repair); return json(output(plan)) },
    () => true, { pauseRequested: () => false, resume: action })
  assert.equal(calls, 1); assert.equal(second.run.usedModelCalls, 2)
  const dead = await setup(), stopped = await execute(dead.io, dead.plan, async () => { throw new Error('TEST_ONLY no call before pause') }, () => true)
  const state = { ...stopped.run, status: 'running' as const, usedModelCalls: 1 }, progress = await readModelReviewCheckpoint(dead.io, stopped.run)
  progress.checkpoint.pendingCall = true; const cpText = json(progress.checkpoint); state.checkpointHash = digest(cpText)
  dead.io.externalEdit(checkpointFile(state.runId), cpText); dead.io.externalEdit(runFile(state.runId), json(state)); dead.io.externalEdit(ACTIVE_RUN, json(state))
  await assert.rejects(prepareModelReviewAction(dead.io, state.runId, 'resume', () => true), { code: 'RUN_OWNER_ALIVE' })
  const recovery = await prepareModelReviewAction(dead.io, state.runId, 'resume', () => false)
  const recovered = await executeModelReview(dead.io, recovery.frozen, { pid: 12346, bootInstance: 'TEST_ONLY-dead-recovery' }, new AbortController().signal,
    async () => json(output(dead.plan)), () => false, { pauseRequested: () => false, resume: recovery })
  assert.equal(recovered.run.usedModelCalls, 2)
})

test('published review recovery settles only its terminal record after later user edits, without publishing a second report', async () => {
  const { io, plan } = await setup(), result = await execute(io, plan, async () => json(output(plan)))
  const progress = await readModelReviewCheckpoint(io, result.run), state = { ...result.run, status: 'running' as const }
  delete progress.checkpoint.published; delete state.reviewId
  const cpText = json(progress.checkpoint); state.checkpointHash = digest(cpText)
  io.externalEdit(checkpointFile(state.runId), cpText); io.externalEdit(runFile(state.runId), json(state)); io.externalEdit(ACTIVE_RUN, json(state))
  const current = await snapshot(io); await saveManual(io, current.document.text + 'TEST_ONLY 用户之后的人工补充。\n', current.document.contentHash, current.ledger.revision)
  const afterEdit = await snapshot(io), action = await prepareModelReviewAction(io, state.runId, 'resume', () => false)
  const recovered = await executeModelReview(io, action.frozen, owner, new AbortController().signal, async () => { throw new Error('TEST_ONLY cannot call again') }, () => false,
    { pauseRequested: () => false, resume: action })
  assert.equal(recovered.recoveredArtifact, true); assert.equal(recovered.report!.id, result.report!.id)
  assert.equal((await snapshot(io)).document.text, afterEdit.document.text); assert.equal((await snapshot(io)).ledger.revision, afterEdit.ledger.revision)
  assert.equal((await inspectReview(io)).stale, true)
})

test('changed profiles pause a review before its next dispatch; closing and linked retry preserve the old terminal history', async () => {
  const { io, plan } = await setup(); let calls = 0
  await assert.rejects(execute(io, plan, async () => { calls++; io.externalEdit('.scholarflow/profiles/review.md', '# TEST_ONLY later reviewer preference\n'); return '{}' }), { code: 'REVIEW_INPUT_CHANGED' })
  assert.equal(calls, 1)
  const state = (await readRun(io, plan.snapshot.runId, plan.snapshot.projectId)).run
  assert.equal(state.status, 'paused')
  await assert.rejects(prepareModelReviewAction(io, state.runId, 'resume', () => true), { code: 'REVIEW_INPUT_CHANGED' })
  await closeRun(io, await prepareRunAction(io, state.runId, 'close', () => true), () => true)
  const action = await prepareModelReviewAction(io, state.runId, 'retry', () => true), next = linkModelReviewRetry(await prepare(io), action)
  const result = await executeModelReview(io, next, owner, new AbortController().signal, async () => json(output(next)), () => true, { pauseRequested: () => false, retry: action })
  assert.equal(result.run.parentRunId, state.runId); assert.notEqual(result.run.runId, state.runId)
  assert.equal((await readRun(io, state.runId, state.projectId)).run.status, 'cancelled')
})

test('temporary failures are charged and bounded, while authentication errors have no automatic retry', async () => {
  const { io, plan } = await setup(); let calls = 0
  await assert.rejects(execute(io, plan, async () => { calls++; throw new ScholarError('SERVER', 'TEST_ONLY transient', { status: 503 }) }), { code: 'SERVER' })
  assert.equal(calls, 3); assert.equal((await readRun(io, plan.snapshot.runId, plan.snapshot.projectId)).run.usedModelCalls, 3)
  const other = await setup(); let authCalls = 0
  await assert.rejects(execute(other.io, other.plan, async () => { authCalls++; throw new ScholarError('AUTH', 'TEST_ONLY unauthorized', { status: 401 }) }), { code: 'AUTH' })
  assert.equal(authCalls, 1)
})

test('old positioned model issues stay open when omitted and close only after an explicit current-version recheck', async () => {
  const { io, plan } = await setup(), initial = await execute(io, plan, async () => json(output(plan))), old = initial.report!.issues.find(issue => issue.location)!
  const next = await prepare(io), omitted = await publishModelReview(io, next, validateModelReview(next, output(next, false)))
  assert.ok(omitted.report.issues.some(issue => issue.id === old.id))
  const final = await prepare(io), result = output(final, false)
  result.rechecks = [{ issueId: old.id, status: 'pass', reason: 'TEST_ONLY 针对当前段落逐项核对，原先的问题已重新检查。', blockId: final.context.blocks.at(-1)!.id, quote }] as never[]
  const rechecked = await publishModelReview(io, final, validateModelReview(final, result))
  assert.equal((await snapshot(io)).ledger.reviewIssues[old.id].state, 'resolved')
  assert.equal(rechecked.report.issues.some(issue => issue.id === old.id), false)
  assert.equal(JSON.parse((await io.read(`.scholarflow/reviews/${initial.report!.id}/report.json`))!.text).issues.find((issue: any) => issue.id === old.id).state, 'open')
})

test('review cancellation preserves a charged call and prevents a late response from publishing', async () => {
  const { io, plan } = await setup(), abort = new AbortController(), original = (await snapshot(io)).document.text
  await assert.rejects(executeModelReview(io, plan, owner, abort.signal, async () => {
    abort.abort('TEST_ONLY operator cancelled'); return json(output(plan))
  }, () => true, { pauseRequested: () => false }), { code: 'CANCELLED' })
  const state = (await readRun(io, plan.snapshot.runId, plan.snapshot.projectId)).run
  assert.equal(state.status, 'cancelled'); assert.equal(state.usedModelCalls, 1)
  assert.equal((await readModelReviewCheckpoint(io, state)).checkpoint.pendingCall, false)
  assert.equal((await inspectReview(io)).report, undefined); assert.equal((await snapshot(io)).document.text, original)
})

test('parallel review startup cannot steal the active project run or dispatch a second model call', async () => {
  const { io, plan } = await setup(), other = await prepare(io)
  let release!: () => void, entered!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  const first = execute(io, plan, async () => { entered(); await gate; return json(output(plan)) })
  await inside
  let extraCalls = 0
  await assert.rejects(execute(io, other, async () => { extraCalls++; return json(output(other)) }), { code: 'RUN_IN_PROGRESS' })
  assert.equal(extraCalls, 0); assert.equal(await io.read(runFile(other.snapshot.runId)), undefined)
  release(); const result = await first
  assert.equal(result.run.usedModelCalls, 1); assert.equal(result.report!.modelRunId, plan.snapshot.runId)
})

test('a paused rate-limit window and charged retry survive confirmation without an immediate request', async () => {
  const { io, plan } = await setup(); let pause = false
  const result = await execute(io, plan, async () => { pause = true; throw new ScholarError('RATE_LIMIT', 'TEST_ONLY provider window', { status: 429, providerRetryAfterMs: 60000 }) }, () => pause)
  const saved = await readModelReviewCheckpoint(io, result.run)
  assert.equal(result.run.status, 'paused'); assert.equal(result.run.usedModelCalls, 1); assert.equal(saved.checkpoint.transientRetries, 1)
  assert.ok(saved.checkpoint.retryNotBefore! > Date.now() + 50000)
  const action = await prepareModelReviewAction(io, result.run.runId, 'resume', () => true); let calls = 0
  const resumed = await executeModelReview(io, action.frozen, owner, new AbortController().signal, async () => { calls++; return json(output(plan)) }, () => true,
    { pauseRequested: () => true, resume: action })
  assert.equal(calls, 0); assert.equal(resumed.run.usedModelCalls, 1)
  assert.equal((await readModelReviewCheckpoint(io, resumed.run)).checkpoint.retryNotBefore, saved.checkpoint.retryNotBefore)
  await closeRun(io, await prepareRunAction(io, result.run.runId, 'close', () => true), () => true)
  const retry = await prepareModelReviewAction(io, result.run.runId, 'retry', () => true), linked = linkModelReviewRetry(await prepare(io), retry)
  assert.equal(linked.retryNotBefore, saved.checkpoint.retryNotBefore)
})

test('tampered frozen inputs and changed approval checkpoints cannot dispatch or overwrite persisted review state', async () => {
  const { io, plan } = await setup(), first = await execute(io, plan, async () => 'TEST_ONLY never called', () => true)
  const action = await prepareModelReviewAction(io, first.run.runId, 'resume', () => true)
  const cp = await readModelReviewCheckpoint(io, first.run), tampered = json({ ...cp.checkpoint, transientRetries: 1 })
  io.externalEdit(checkpointFile(first.run.runId), tampered)
  const writes = io.writes; let calls = 0
  await assert.rejects(executeModelReview(io, action.frozen, owner, new AbortController().signal, async () => { calls++; return json(output(plan)) }, () => true,
    { pauseRequested: () => false, resume: action }), { code: 'RUN_CHECKPOINT_CHANGED' })
  assert.equal(calls, 0); assert.equal(io.writes, writes); assert.equal((await io.read(checkpointFile(first.run.runId)))!.text, tampered)
  const other = await setup(), stopped = await execute(other.io, other.plan, async () => '', () => true)
  const path = `.scholarflow/runs/${stopped.run.runId}/plan.json`, frozen = JSON.parse((await other.io.read(path))!.text)
  frozen.context.manuscript += 'TEST_ONLY invented input'; other.io.externalEdit(path, json(frozen))
  await assert.rejects(prepareModelReviewAction(other.io, stopped.run.runId, 'resume', () => true), { code: 'RUN_CHECKPOINT_CHANGED' })
})
