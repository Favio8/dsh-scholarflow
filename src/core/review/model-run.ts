import { z } from 'zod'
import { id, hash, projectType, outlineSchema, claimSchema, evidenceSchema, sourceSchema, requirementSchema, issueSchema } from '../../shared/schema.ts'
import { skillMetadataSchema } from '../../shared/skills.ts'
import { modelReviewRequest, modelReviewOutputSchema, reviewReportSchema } from '../../shared/review.ts'
import { runSnapshotSchema, runStateSchema, type RunState } from '../../shared/runs.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { commit, inspectRecovery } from '../store/transactions.ts'
import { reviewInput } from './review.ts'
import { modelReviewSystem, validateModelReview, verifyModelReviewPlan, existingModelReview, publishModelReview, type ModelReviewPlan } from './model.ts'
import { semanticReviewChecks } from '../../shared/review.ts'
import { ACTIVE_RUN, readRun, readRunInput, runFile, inputFile } from '../pipeline/run-store.ts'
import { frozenPlanFile, checkpointFile } from '../pipeline/run-control.ts'
import { transientRetry, waitRetrySlice } from '../pipeline/retry.ts'
import type { ModelCall } from '../pipeline/generation.ts'
import { workflowCall, syncWorkflowDuration } from '../pipeline/workflow-budget.ts'
import { isDetachedProjectPointer } from '../project/identity.ts'
import { ensureNoAutomaticExecuting } from '../pipeline/automatic-lease.ts'

const frozenSchema = z.object({ kind: z.literal('model-review'), id, reportId: id, contentHash: hash, input: modelReviewRequest,
  snapshot: runSnapshotSchema.refine(value => value.stage === 'review'), dependencyHash: hash, ledgerHash: hash, inputBytes: z.number().int().min(0).max(20 * 1024 * 1024),
  baseReport: reviewReportSchema, parentRunId: id.optional(), retryNotBefore: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  context: z.object({ manuscript: z.string().max(2 * 1024 * 1024),
    blocks: z.array(z.object({ id, sourceRange: z.object({ startUtf16: z.number().int().nonnegative(), endUtf16: z.number().int().nonnegative() }).strict(), sourceText: z.string() }).strict()).max(2000),
    project: z.object({ id, title: z.string(), type: projectType, language: z.enum(['zh-CN', 'en']) }).strict(),
    requirements: z.array(requirementSchema.pick({ id: true, kind: true, description: true, confirmation: true, constraint: true, verificationMethod: true })),
    outline: outlineSchema, claims: z.array(claimSchema), evidence: z.array(evidenceSchema),
    sources: z.array(sourceSchema.pick({ id: true, kind: true, title: true, authors: true, year: true, identifiers: true, citeKey: true, identity: true, textAccess: true })),
    priorIssues: z.array(issueSchema).max(100), writingProfile: z.string().max(65536), reviewProfile: z.string().max(65536),
    approvedMemory: z.partialRecord(z.enum(['decisions', 'terminology', 'writing-memory']), z.string().max(65536)),
    academicSkills: z.array(z.object({ priority: z.number().int().min(1), bindingId: id, qualifiedId: z.string(), digest: hash, metadata: skillMetadataSchema,
      instructions: z.string().max(65536), references: z.array(z.object({ relativePath: z.string(), content: z.string().max(65536), hash }).strict()).max(200), warnings: z.array(z.string()).max(300) }).strict()).max(30),
    scope: z.string(), semanticScope: z.literal('sf-cross-section-v1').optional(), knownLimitations: z.array(z.object({ id, status: z.enum(['pass', 'fail', 'unknown']), detail: z.string() }).strict()) }).strict(),
}).strict()
const checkpointSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('model-review'), runId: id, projectId: id, planHash: hash,
  formatAttempts: z.number().int().min(0).max(2), pendingCall: z.boolean(), repair: z.string().max(2000).optional(),
  transientRetries: z.number().int().min(0).max(2), retryNotBefore: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), lastTransientCode: z.string().max(64).optional(),
  output: modelReviewOutputSchema.optional(), published: z.object({ reviewId: id, reportHash: hash }).strict().optional() }).strict()
type Checkpoint = z.infer<typeof checkpointSchema>

export async function readFrozenModelReview(io: FileStore, runId: string, projectId: string) {
  const file = await io.read(frozenPlanFile(runId))
  invariant(file && Buffer.byteLength(file.text) <= 20 * 1024 * 1024, 'RUN_CHECKPOINT_UNAVAILABLE', '模型审查没有可验证的完整输入检查点。')
  const raw = JSON.parse(file.text); frozenSchema.parse(raw)
  const { contentHash, ...body } = raw
  invariant(digest(json(body)) === contentHash && raw.snapshot.projectId === projectId && raw.snapshot.runId === runId && raw.context.project.id === projectId &&
    raw.input.context.projectId === projectId && raw.baseReport.projectId === projectId, 'RUN_CHECKPOINT_CHANGED', '审查冻结输入的摘要或身份不符。')
  const input = await readRunInput(io, runId, projectId)
  invariant(json(input.snapshot) === json(raw.snapshot), 'RUN_CHECKPOINT_CHANGED', '审查输入快照与冻结计划不一致。')
  verifyModelReviewPlan(raw)
  return { plan: raw as ModelReviewPlan, file }
}
export async function readModelReviewCheckpoint(io: FileStore, state: RunState) {
  const file = await io.read(checkpointFile(state.runId))
  invariant(file && state.checkpointHash && digest(file.text) === state.checkpointHash, 'RUN_CHECKPOINT_CHANGED', '审查运行检查点缺失或改变。')
  const checkpoint = checkpointSchema.parse(JSON.parse(file.text))
  invariant(checkpoint.runId === state.runId && checkpoint.projectId === state.projectId && checkpoint.planHash === state.planHash && (!checkpoint.published || checkpoint.output),
    'RUN_CHECKPOINT_CHANGED', '审查检查点身份或已保存产物不一致。')
  return { checkpoint, file }
}
export async function prepareModelReviewAction(io: FileStore, runId: string, action: 'resume' | 'retry', ownerAlive: (owner: RunState['owner']) => boolean) {
  const current = await reviewInput(io), stored = await readRun(io, runId, current.current.ledger.projectId), active = await io.read(ACTIVE_RUN)
  invariant(!(await inspectRecovery(io, current.current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先恢复多文件事务再处理审查运行。')
  invariant(stored.run.stage === 'review' && !stored.legacy, 'RUN_CHECKPOINT_UNAVAILABLE', '该记录不是具有完整检查点的模型审查。')
  if (action === 'retry') invariant(['failed', 'cancelled'].includes(stored.run.status), 'RUN_RETRY_UNAVAILABLE', '仅失败或取消审查可创建关联新运行。')
  else {
    invariant(!['failed', 'cancelled', 'succeeded', 'completed-with-issues'].includes(stored.run.status), 'RUN_TERMINAL', '审查已有终态，不能擦除其历史。')
    invariant(stored.run.status === 'paused' || !ownerAlive(stored.run.owner), 'RUN_OWNER_ALIVE', '原审查执行进程仍存活，请先在原会话暂停。')
    invariant(active && digest(active.text) === digest(stored.file.text), 'RUN_STATE_CHANGED', '审查活动投影与事实源不同。')
  }
  const frozen = await readFrozenModelReview(io, runId, current.current.ledger.projectId), progress = await readModelReviewCheckpoint(io, stored.run)
  invariant(frozen.plan.contentHash === stored.run.planHash && !(stored.run.status === 'paused' && progress.checkpoint.pendingCall), 'RUN_CHECKPOINT_CHANGED', '审查计划或安全暂停状态无效。')
  const existing = progress.checkpoint.output ? await existingModelReview(io, frozen.plan, progress.checkpoint.output) : undefined
  invariant(!progress.checkpoint.published || existing && existing.reportHash === progress.checkpoint.published.reportHash && existing.report.id === progress.checkpoint.published.reviewId,
    'REVIEW_ARTIFACT_CHANGED', '审查已保存产物缺失或改变。')
  invariant(action !== 'retry' || !existing, 'RUN_ARTIFACT_EXISTS', '原运行已保存审查报告，请查看原产物，不重复审查。')
  if (action === 'resume' && !existing) invariant(current.current.ledgerHash === frozen.plan.ledgerHash && current.dependencyHash === frozen.plan.dependencyHash,
    'REVIEW_INPUT_CHANGED', '检查点之后输入改变，请结束旧审查并为当前稿件预览新运行。')
  const body = { id: newId('reviewaction'), action, projectId: current.current.ledger.projectId, runId, stateHash: digest(stored.file.text), activeHash: active ? digest(active.text) : null,
    frozenHash: digest(frozen.file.text), checkpointHash: digest(progress.file.text), ledgerHash: current.current.ledgerHash, dependencyHash: current.dependencyHash,
    existingReportId: existing?.report.id, retryNotBefore: progress.checkpoint.retryNotBefore }
  return { ...body, contentHash: digest(json(body)), frozen: frozen.plan }
}
export type ModelReviewAction = Awaited<ReturnType<typeof prepareModelReviewAction>>
async function validateAction(io: FileStore, action: ModelReviewAction, ownerAlive: (owner: RunState['owner']) => boolean) {
  const { contentHash, frozen: _frozen, ...body } = action
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', '审查运行操作计划改变。')
  const actual = await prepareModelReviewAction(io, action.runId, action.action, ownerAlive)
  for (const field of ['stateHash', 'activeHash', 'frozenHash', 'checkpointHash', 'ledgerHash', 'dependencyHash', 'existingReportId', 'retryNotBefore'] as const)
    invariant(actual[field] === action[field], 'RUN_STATE_CHANGED', '确认期间运行或审查输入改变，请重新预览。')
  return actual
}
export function linkModelReviewRetry(plan: ModelReviewPlan, action: ModelReviewAction): ModelReviewPlan {
  const { contentHash: _old, ...body } = plan
  const next = { ...body, parentRunId: action.runId, ...(action.retryNotBefore && { retryNotBefore: action.retryNotBefore }) }
  return { ...next, contentHash: digest(json(next)) }
}

export async function executeModelReview(io: FileStore, plan: ModelReviewPlan, owner: RunState['owner'], signal: AbortSignal,
  modelCall: (request: ModelCall) => Promise<string>, ownerAlive: (owner: RunState['owner']) => boolean,
  control: { pauseRequested: () => boolean; resume?: ModelReviewAction; retry?: ModelReviewAction; executionSessionId?: string }) {
  const { contentHash, ...body } = plan
  frozenSchema.parse(plan); verifyModelReviewPlan(plan)
  let state: RunState = { schemaVersion: 1, runId: plan.snapshot.runId, projectId: plan.snapshot.projectId, sessionId: plan.snapshot.sessionId, stage: 'review', status: 'running',
    usedModelCalls: 0, owner, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), planHash: plan.contentHash, activeDurationMs: 0,
    ...(plan.parentRunId && { parentRunId: plan.parentRunId }) }
  let checkpoint: Checkpoint = { schemaVersion: 1, kind: 'model-review', runId: state.runId, projectId: state.projectId, planHash: plan.contentHash,
    formatAttempts: 0, pendingCall: false, transientRetries: 0, ...(plan.retryNotBefore && { retryNotBefore: plan.retryNotBefore }) }
  let expectedStateHash = '', expectedCheckpointHash = '', started = Date.now(), priorDuration = 0
  const checkInputs = async () => { const input = await reviewInput(io)
    invariant(input.current.ledgerHash === plan.ledgerHash && input.dependencyHash === plan.dependencyHash && !input.current.document.externalChange,
      'REVIEW_INPUT_CHANGED', '下一阶段调用前正文、材料、指令或要求改变，已停止调度。')
    invariant(!(await inspectRecovery(io, input.current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先恢复项目多文件事务。') }
  const save = async () => io.lock(async () => {
    const primary = await io.read(runFile(state.runId)), active = await io.read(ACTIVE_RUN), progress = await io.read(checkpointFile(state.runId))
    invariant(primary && active && digest(primary.text) === expectedStateHash && digest(active.text) === expectedStateHash && progress && digest(progress.text) === expectedCheckpointHash,
      'RUN_STATE_CHANGED', '审查权威状态、活动投影或检查点改变，未覆盖。')
    state.updatedAt = new Date().toISOString(); state.activeDurationMs = priorDuration + Math.max(0, Date.now() - started)
    const progressText = json(checkpointSchema.parse(checkpoint)); state.checkpointHash = digest(progressText)
    const stateText = json(runStateSchema.parse(state))
    await commit(io, [{ path: checkpointFile(state.runId), before: progress, after: progressText }, { path: runFile(state.runId), before: primary, after: stateText }, { path: ACTIVE_RUN, before: active, after: stateText }])
    expectedStateHash = digest(stateText); expectedCheckpointHash = digest(progressText)
  })
  await io.lock(async () => {
    await ensureNoAutomaticExecuting(io, plan.snapshot.projectId)
    const active = await io.read(ACTIVE_RUN)
    if (control.retry) { invariant(control.retry.action === 'retry' && plan.parentRunId === control.retry.runId, 'INVALID_APPROVAL', '关联重试与原运行不符。'); await validateAction(io, control.retry, ownerAlive) }
    if (control.resume) {
      const action = await validateAction(io, control.resume, ownerAlive), original = await readRun(io, action.runId, action.projectId), progress = await readModelReviewCheckpoint(io, original.run)
      invariant(action.action === 'resume' && action.runId === state.runId && action.frozen.contentHash === plan.contentHash, 'INVALID_APPROVAL', '恢复不属于此冻结审查。')
      state = { ...original.run, owner, status: 'running', ...(control.executionSessionId && { executionSessionId: control.executionSessionId }) }; delete state.errorCode
      checkpoint = progress.checkpoint
      priorDuration = (state.activeDurationMs ?? 0) + (checkpoint.pendingCall ? Math.min(plan.snapshot.budget.maxDurationMinutes * 60000, Math.max(0, Date.now() - Date.parse(state.updatedAt))) : 0)
      checkpoint.pendingCall = false; started = Date.now()
      const progressText = json(checkpointSchema.parse(checkpoint)); state.checkpointHash = digest(progressText); state.updatedAt = new Date().toISOString(); state.activeDurationMs = priorDuration
      const stateText = json(runStateSchema.parse(state))
      await commit(io, [{ path: `.scholarflow/runs/${state.runId}/control-history/${action.id}.json`, before: undefined, after: json({ schemaVersion: 1, action: 'resume', approvedPlanHash: action.contentHash, originalState: original.file.text }) },
        { path: checkpointFile(state.runId), before: progress.file, after: progressText }, { path: runFile(state.runId), before: original.file, after: stateText }, { path: ACTIVE_RUN, before: active, after: stateText }])
      expectedStateHash = digest(stateText); expectedCheckpointHash = digest(progressText); return
    }
    await checkInputs()
    if (active && !await isDetachedProjectPointer(io, ACTIVE_RUN, active)) {
      const previous = runStateSchema.parse(JSON.parse(active.text)), authoritative = await readRun(io, previous.runId, state.projectId)
      invariant(authoritative.file.text === active.text, 'RUN_STATE_CHANGED', '活动投影与运行事实源不同。')
      invariant(!['running', 'queued', 'paused', 'waiting-input', 'interrupted'].includes(previous.status), ownerAlive(previous.owner) ? 'RUN_IN_PROGRESS' : 'RUN_INTERRUPTED', '本项目有未结束运行，请先处理检查点。')
    }
    const progressText = json(checkpointSchema.parse(checkpoint)); state.checkpointHash = digest(progressText); const stateText = json(runStateSchema.parse(state))
    await commit(io, [{ path: inputFile(state.runId), before: undefined, after: json(plan.snapshot) }, { path: frozenPlanFile(state.runId), before: undefined, after: json(plan) },
      { path: checkpointFile(state.runId), before: undefined, after: progressText }, { path: runFile(state.runId), before: undefined, after: stateText }, { path: ACTIVE_RUN, before: active, after: stateText },
      { path: `.scholarflow/runs/${state.runId}/skills.json`, before: undefined, after: json({ schemaVersion: 1, projectId: state.projectId, resourceLockHash: plan.snapshot.resourceLockHash, resources: plan.context.academicSkills }) }])
    expectedStateHash = digest(stateText); expectedCheckpointHash = digest(progressText)
  })
  const remainingMs = Math.max(1, plan.snapshot.budget.maxDurationMinutes * 60000 - priorDuration), bounded = AbortSignal.any([signal, AbortSignal.timeout(Math.min(remainingMs, 30 * 60000))])
  const pause = async () => { bounded.throwIfAborted(); state.status = 'paused'; await save(); await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0); return { run: state, paused: true } }
  try {
    if (checkpoint.output) {
      const existing = await existingModelReview(io, plan, checkpoint.output)
      if (existing) { state.reviewId = existing.report.id; state.status = existing.report.issues.length || existing.report.checks.some(check => check.status !== 'pass') ? 'completed-with-issues' : 'succeeded'; checkpoint.published = { reviewId: existing.report.id, reportHash: existing.reportHash }; await save(); return { run: state, ...existing, recoveredArtifact: true } }
    }
    invariant(priorDuration < plan.snapshot.budget.maxDurationMinutes * 60000, 'BUDGET_EXHAUSTED', '原审查时间预算耗尽，保留检查点。')
    while (!checkpoint.output && checkpoint.formatAttempts < 2) {
      bounded.throwIfAborted(); if (control.pauseRequested()) return await pause()
      invariant(state.usedModelCalls < plan.snapshot.budget.maxModelCalls, 'BUDGET_EXHAUSTED', '审查模型调用预算耗尽。')
      while (checkpoint.retryNotBefore && Date.now() < checkpoint.retryNotBefore) {
        bounded.throwIfAborted(); if (control.pauseRequested()) return await pause()
        invariant(checkpoint.retryNotBefore - Date.now() < remainingMs - (Date.now() - started), 'BUDGET_EXHAUSTED', '提供方重试窗口超过剩余审查预算。')
        await waitRetrySlice(Math.min(200, checkpoint.retryNotBefore - Date.now()), bounded)
      }
      delete checkpoint.retryNotBefore; await checkInputs(); state.usedModelCalls++; checkpoint.pendingCall = true; await save()
      let raw: string
      try { raw = await workflowCall(io, plan.snapshot.workflowId, { callId: `${state.runId}.model.${state.usedModelCalls}`, runId: state.runId,
        stage: 'review', kind: 'model', activeDurationMs: state.activeDurationMs ?? 0, owner }, bounded,
        signal => modelCall({ system: modelReviewSystem(plan), instruction: '按冻结合同审查给定完整当前稿件，分别核对全部检查，保留未知与证据边界，只返回结构化结果。', context: plan.context, repair: checkpoint.repair, signal, runId: state.runId, maxTokens: plan.snapshot.modelDescriptor.maxOutputTokens ?? 4096 })) }
      catch (error) { bounded.throwIfAborted(); const retry = transientRetry(error, checkpoint.transientRetries)
        if (!retry) throw error
        checkpoint.pendingCall = false; checkpoint.transientRetries = retry.retry; checkpoint.retryNotBefore = retry.notBefore; checkpoint.lastTransientCode = retry.code; await save(); continue }
      bounded.throwIfAborted(); checkpoint.pendingCall = false; checkpoint.formatAttempts++
      try { checkpoint.output = validateModelReview(plan, JSON.parse(raw)) }
      catch { checkpoint.repair = `返回严格 JSON。checks 恰好包含以下不同检查名的数组，status 必须按实际依据填写 pass/fail/unknown，不能是以检查名为键的对象：${JSON.stringify((plan.context.semanticScope ? semanticReviewChecks : semanticReviewChecks.slice(0, 2)).map(id => ({ id, status: 'unknown', detail: '实际检查依据或无法判定的原因，至少10字符。' })))}。findings、rechecks、limitations 必须是数组；问题和复查使用给定身份、实际源码块及其唯一连续原样 quote，关联 ID 只取本次范围。${plan.context.semanticScope ? '每项 finding 必須有对应 assessmentId，关联的具体检查与论证／文风总检查不能同时 pass。' : ''}detail/explanation/reason 至少10字符。不能重复位置、制造引用或同时宣称有问题且通过。没有问题／复查时返回空数组，无法判断明确 unknown。` }
      await save()
      await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0)
    }
    if (control.pauseRequested()) return await pause()
    invariant(checkpoint.output, 'MODEL_REVIEW_INVALID', '一次格式修复后审查输出仍不满足合同，未更新报告。')
    bounded.throwIfAborted(); await checkInputs()
    const result = await publishModelReview(io, plan, checkpoint.output)
    state.reviewId = result.report.id; state.status = result.report.issues.length || result.report.checks.some(check => check.status !== 'pass') ? 'completed-with-issues' : 'succeeded'
    checkpoint.published = { reviewId: result.report.id, reportHash: digest(json(result.report)) }; await save()
    await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0)
    return { run: state, report: result.report, recoveredArtifact: 'recoveredArtifact' in result }
  } catch (error) {
    checkpoint.pendingCall = false; state.status = bounded.aborted ? signal.aborted ? signal.reason === 'plugin-unload' ? 'interrupted' : 'cancelled' : 'failed' : error instanceof ScholarError && error.code === 'REVIEW_INPUT_CHANGED' ? 'paused' : 'failed'
    state.errorCode = bounded.aborted ? signal.aborted ? 'CANCELLED' : 'BUDGET_EXHAUSTED' : error instanceof ScholarError ? error.code : 'MODEL_CALL_FAILED'
    await save(); await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0); if (bounded.aborted) throw new ScholarError(state.errorCode, '审查已停止，保留检查点和已保存产物。'); throw error
  }
}
