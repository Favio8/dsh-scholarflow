import { z } from 'zod'
import { id } from '../../shared/schema.ts'
import { automaticInputSchema, automaticStateSchema, automaticPolicySchema, type AutomaticPolicy, type AutomaticState, type AutomaticChildGrant } from '../../shared/workflow-automatic.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { commit, inspectRecovery } from '../store/transactions.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'
import { readWorkflow, readWorkflowRecord, workflowCheckpointMutations, prepareWorkflowAction, applyWorkflowAction, ensureNoStageExecuting, WORKFLOW_POINTER } from './workflow.ts'
import { workflowBudgetInfo, syncWorkflowDuration } from './workflow-budget.ts'
import { reviewInput, runReview } from '../review/review.ts'
import { prepareDelivery, createDelivery } from '../export/delivery.ts'
import { validateFrozenModelReview } from '../review/model-run.ts'
import type { ModelReviewPlan } from '../review/model.ts'
import type { GenerationPlan } from './generation.ts'
import { validateFrozenGeneration, readGenerationCheckpoint } from './run-control.ts'
import { verifyPlan as verifyResearchPlan, readResearchBatch } from '../research/batch.ts'
import { batchPlanSchema, type ResearchBatchPlan } from '../../shared/research-batch.ts'
import { applyDraftSequenceAction, type DraftSequenceActionPlan } from './draft-sequence.ts'
import { readRun } from './run-store.ts'
import { proposalImage } from '../editing/proposals.ts'
import type { SkillReader } from '../skills/bindings.ts'

export type AutomaticWork = { kind: 'generation'; plan: GenerationPlan; sequenceAction?: DraftSequenceActionPlan } |
  { kind: 'research'; plan: ResearchBatchPlan }
function validateWork(work: AutomaticWork) {
  if (work.kind === 'generation') {
    validateFrozenGeneration(work.plan)
    if (work.sequenceAction) {
      const { contentHash, ...body } = work.sequenceAction
      invariant(digest(json(body)) === contentHash && work.sequenceAction.action === 'next' &&
        work.sequenceAction.generation?.contentHash === work.plan.contentHash && work.sequenceAction.sequenceId === work.plan.snapshot.draftSequenceId,
        'AUTOMATIC_CHILD_INVALID', '按节操作不属于所列冻结生成计划。')
    }
  } else verifyResearchPlan(batchPlanSchema.parse(work.plan))
}
export async function readAutomaticWork(io: FileStore, workflowId: string, automaticId: string): Promise<AutomaticWork> {
  const stored = await readAutomatic(io, workflowId, automaticId), pin = stored.input.work
  invariant(pin, 'AUTOMATIC_CHILD_INVALID', '原推进未授权这个阶段。')
  const file = await io.read(`${location(workflowId, automaticId)}/work-plan.json`)
  invariant(file && Buffer.byteLength(file.text) <= 20 * 1024 * 1024, 'AUTOMATIC_CHILD_INVALID', '原阶段输入缺失或过大，没有重建。')
  const work = JSON.parse(file.text) as AutomaticWork
  invariant(work.kind === pin.kind, 'AUTOMATIC_CHILD_INVALID', '原阶段类型改变。')
  validateWork(work)
  const { plan } = work
  invariant(plan.contentHash === pin.planHash && plan.snapshot.runId === pin.runId && plan.snapshot.projectId === stored.input.projectId &&
    plan.snapshot.workflowId === workflowId && plan.snapshot.sessionId === stored.input.sessionId && plan.snapshot.stage === pin.stage &&
    plan.snapshot.draftSequenceId === pin.draftSequenceId && json(plan.snapshot.modelDescriptor) === json(pin.modelDescriptor) &&
    json(plan.snapshot.skillDigests) === json(pin.skillDigests) && (work.kind === 'generation' ? work.plan.inputBytes : Buffer.byteLength(json(work.plan.searches))) === pin.inputBytes,
    'AUTOMATIC_CHILD_INVALID', '阶段身份、范围、模型或说明改变，没有调用。')
  return work
}

const terminal = (state: AutomaticState) => ['failed', 'cancelled', 'succeeded', 'completed-with-issues'].includes(state.status)
const pointerSchema = z.object({ schemaVersion: z.literal(1), automaticId: id, workflowId: id, projectId: id }).strict()
const base = (workflowId: string) => {
  invariant(/^workflow_[\w]+$/u.test(id.parse(workflowId)), 'AUTOMATIC_INVALID', '自动推进必须属于实际引导目标。')
  return `.scholarflow/runs/${workflowId}/automatic`
}
const location = (workflowId: string, automaticId: string) => {
  invariant(/^automatic_[\w]+$/u.test(id.parse(automaticId)), 'AUTOMATIC_INVALID', '自动推进身份无效。')
  return `${base(workflowId)}/${automaticId}`
}
function progress(stored: Awaited<ReturnType<typeof readWorkflow>>) {
  const { ledger, document } = stored.current
  // New report IDs, timestamps, model wording and checkpoint counters are not
  // evidence of progress. Only saved task facts and actual check/issue outcomes.
  return digest(json({ documentHash: document.contentHash, requirements: ledger.requirements, sources: ledger.sources,
    evidence: ledger.evidence, claims: ledger.claims, outline: ledger.outline,
    review: stored.gates.find(row => row.stage === 'review')?.canComplete,
    issues: Object.values(ledger.reviewIssues).map(row => ({ id: row.id, state: row.state, stale: row.stale, documentHash: row.documentHash })).sort((a, b) => a.id.localeCompare(b.id)),
    delivery: stored.gates.find(row => row.stage === 'delivery')?.canComplete }))
}
export async function readAutomatic(io: FileStore, workflowId: string, automaticId: string) {
  const root = await readWorkflowRecord(io, workflowId), prefix = location(workflowId, automaticId)
  const [inputFile, stateFile] = await Promise.all([io.read(`${prefix}/input.json`), io.read(`${prefix}/run.json`)])
  invariant(inputFile && stateFile, 'AUTOMATIC_INVALID', '自动推进输入或状态缺失；没有重建。')
  const input = automaticInputSchema.parse(JSON.parse(inputFile.text)), state = automaticStateSchema.parse(JSON.parse(stateFile.text))
  invariant(input.automaticId === automaticId && state.automaticId === automaticId && input.workflowId === workflowId && state.workflowId === workflowId &&
    input.projectId === root.current.ledger.projectId && state.projectId === input.projectId && state.inputHash === digest(inputFile.text) &&
    input.workflowPlanHash === root.plan.contentHash && new Set(state.steps.map(row => row.stepId)).size === state.steps.length &&
    state.steps.filter(row => row.state === 'pending').length <= 1 && state.steps.every((row, index) => !index || row.number > state.steps[index - 1].number),
    'AUTOMATIC_INVALID', '自动推进身份、输入或步骤顺序校验失败；原记录保留。')
  return { root, input, state, inputFile, stateFile }
}
export async function inspectAutomatic(io: FileStore, workflowId: string) {
  const file = await io.read(`${base(workflowId)}/current.json`)
  if (!file) return { automatic: undefined }
  const pointer = pointerSchema.parse(JSON.parse(file.text)), stored = await readAutomatic(io, workflowId, pointer.automaticId)
  invariant(pointer.workflowId === workflowId && pointer.projectId === stored.input.projectId, 'AUTOMATIC_INVALID', '自动推进索引身份不符。')
  return { automatic: { input: stored.input, state: stored.state, limits: stored.root.checkpoint.automaticBudget } }
}
export async function readAutomaticReview(io: FileStore, workflowId: string, automaticId: string) {
  const stored = await readAutomatic(io, workflowId, automaticId), pin = stored.input.modelReview
  invariant(pin, 'AUTOMATIC_CHILD_INVALID', '这个范围未授权模型审查。')
  const file = await io.read(`${location(workflowId, automaticId)}/review-plan.json`)
  invariant(file && Buffer.byteLength(file.text) <= 20 * 1024 * 1024, 'AUTOMATIC_CHILD_INVALID', '已确认审查范围缺失或过大，没有重建。')
  const plan: unknown = JSON.parse(file.text); validateFrozenModelReview(plan)
  invariant(plan.contentHash === pin.planHash && plan.snapshot.runId === pin.runId && plan.snapshot.projectId === stored.input.projectId &&
    plan.snapshot.sessionId === stored.input.sessionId && plan.snapshot.workflowId === workflowId && plan.context.semanticScope === 'sf-cross-section-v1' &&
    plan.dependencyHash === stored.input.dependencyHash && plan.inputBytes === pin.inputBytes &&
    json(plan.snapshot.modelDescriptor) === json(pin.modelDescriptor) && json(plan.snapshot.skillDigests) === json(pin.skillDigests),
    'AUTOMATIC_CHILD_INVALID', '审查身份、固定模型、说明或输入范围改变；未发送请求。')
  return plan
}
async function eligible(io: FileStore, workflowId: string) {
  const stored = await readWorkflow(io, workflowId)
  await currentGoal(io, workflowId, stored.current.ledger.projectId)
  invariant(!stored.configChanged && stored.checkpoint.status === 'waiting-input', 'WORKFLOW_INPUT_CHANGED', '先恢复未变更的引导目标，或取消旧目标后重新规划。')
  invariant(stored.input.budget && stored.checkpoint.budget && !stored.checkpoint.budget.calls.some(row => row.state === 'pending'),
    'WORKFLOW_CALL_PENDING', '累计预算缺失或前一请求响应未知；未自动调度。')
  invariant(!(await inspectRecovery(io, stored.current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先明确恢复未完成事务，再推进。')
  await ensureNoStageExecuting(io, stored.current.ledger.projectId)
  return stored
}
async function currentGoal(io: FileStore, workflowId: string, projectId: string) {
  const file = await io.read(WORKFLOW_POINTER)
  let pointer: any
  try { pointer = file && JSON.parse(file.text) } catch { /* No guessed pointer. */ }
  invariant(pointer?.schemaVersion === 1 && pointer.workflowId === workflowId && pointer.projectId === projectId,
    'WORKFLOW_BINDING_CHANGED', '当前引导目标改变或索引缺失，旧调度不会继续。')
}
export async function prepareAutomatic(io: FileStore, workflowId: string, sessionId: string, policy: AutomaticPolicy, reviewPlan?: ModelReviewPlan, work?: AutomaticWork) {
  id.parse(sessionId); policy = automaticPolicySchema.parse(policy)
  const stored = await eligible(io, workflowId), previous = await inspectAutomatic(io, workflowId), pointer = await io.read(`${base(workflowId)}/current.json`)
  invariant(!previous.automatic || terminal(previous.automatic.state), 'AUTOMATIC_IN_PROGRESS', '先恢复或明确结束当前自动推进；不覆盖检查点。')
  const limits = stored.checkpoint.automaticBudget
  invariant(!limits || limits.maxNoProgress === policy.maxNoProgress, 'AUTOMATIC_LIMIT_CHANGED', '本目标已冻结步骤与无进展上限，新的推进不重置额度。')
  const observed = await reviewInput(io)
  invariant(observed.current.configHash === stored.current.configHash && observed.current.ledgerHash === stored.current.ledgerHash, 'WORKFLOW_INPUT_CHANGED', '预览期间输入变化，请重新读取。')
  if (reviewPlan) {
    validateFrozenModelReview(reviewPlan)
    invariant(reviewPlan.snapshot.workflowId === workflowId && reviewPlan.snapshot.sessionId === sessionId && reviewPlan.snapshot.projectId === stored.current.ledger.projectId &&
      reviewPlan.ledgerHash === stored.current.ledgerHash && reviewPlan.dependencyHash === observed.dependencyHash && reviewPlan.context.semanticScope === 'sf-cross-section-v1',
      'AUTOMATIC_CHILD_INVALID', '自动审查必须预览当前原目标、会话和完整五项同版范围。')
  }
  if (work) {
    validateWork(work)
    invariant(!reviewPlan && work.plan.snapshot.workflowId === workflowId && work.plan.snapshot.projectId === stored.current.ledger.projectId &&
      work.plan.snapshot.sessionId === sessionId && work.plan.snapshot.configHash === stored.current.configHash && work.plan.ledgerHash === stored.current.ledgerHash &&
      work.plan.snapshot.documentHash === stored.current.document.contentHash, 'AUTOMATIC_CHILD_INVALID', '阶段须冻结当前原目标、会话和项目版本；不能同时把旧审查扩大到新正文。')
  }
  const input = automaticInputSchema.parse({ schemaVersion: 1, automaticId: newId('automatic'), workflowId, projectId: stored.current.ledger.projectId, sessionId,
    workflowPlanHash: stored.plan.contentHash, dependencyHash: observed.dependencyHash, policy, createdAt: new Date().toISOString(),
    ...(reviewPlan && { modelReview: { runId: reviewPlan.snapshot.runId, planHash: reviewPlan.contentHash, inputBytes: reviewPlan.inputBytes,
      modelDescriptor: reviewPlan.snapshot.modelDescriptor, skillDigests: reviewPlan.snapshot.skillDigests } }),
    ...(work && { work: { kind: work.kind, stage: work.plan.snapshot.stage, runId: work.plan.snapshot.runId, planHash: work.plan.contentHash,
      inputBytes: work.kind === 'generation' ? work.plan.inputBytes : Buffer.byteLength(json(work.plan.searches)), modelDescriptor: work.plan.snapshot.modelDescriptor,
      skillDigests: work.plan.snapshot.skillDigests, draftSequenceId: work.plan.snapshot.draftSequenceId } }) })
  const body = { id: newId('automatic_plan'), input, checkpointHash: digest(stored.checkpointFile.text), ledgerHash: stored.current.ledgerHash,
    pointerHash: pointer ? digest(pointer.text) : null, ...(reviewPlan && { reviewPlan }), ...(work && { work }) }
  return { ...body, contentHash: digest(json(body)) }
}
export type AutomaticPlan = Awaited<ReturnType<typeof prepareAutomatic>>
export async function prepareAutomaticAction(io: FileStore, workflowId: string, automaticId: string, sessionId: string,
  action: 'resume' | 'close', reason: string, ownerAlive: (owner: AutomaticState['owner']) => boolean) {
  id.parse(sessionId); invariant(reason.trim().length >= 10 && reason.length <= 4000, 'AUTOMATIC_REASON_REQUIRED', '恢复或结束推进须明确说明理由。')
  const stored = await readAutomatic(io, workflowId, automaticId), pointer = await io.read(`${base(workflowId)}/current.json`)
  invariant(pointer && pointerSchema.parse(JSON.parse(pointer.text)).automaticId === automaticId && !terminal(stored.state),
    'AUTOMATIC_TERMINAL', '仅可操作当前未结束推进；原终态保持不变，新尝试保留原额度。')
  if (['running', 'queued'].includes(stored.state.status) || stored.state.steps.some(row => row.state === 'pending'))
    invariant(!ownerAlive(stored.state.owner), 'RUN_OWNER_ALIVE', '原调度进程仍存活，不能接管或结束其登记；先在原会话停止或等待其保存。')
  if (action === 'resume') {
    invariant(!stored.state.steps.some(row => row.state === 'pending'), 'AUTOMATIC_PENDING_OPERATION', '旧步骤结果未知；请核对产物后明确结束旧推进，再预览新尝试，不重放登记。')
    await eligible(io, workflowId)
    invariant((await reviewInput(io)).dependencyHash === stored.input.dependencyHash, 'WORKFLOW_INPUT_CHANGED', '原范围已变化，不能恢复旧授权。')
    if (stored.input.modelReview) await readAutomaticReview(io, workflowId, automaticId)
    if (stored.input.work) await readAutomaticWork(io, workflowId, automaticId)
  }
  const body = { id: newId('automatic_action'), action, workflowId, automaticId, projectId: stored.input.projectId, sessionId, reason: reason.trim(),
    stateHash: digest(stored.stateFile.text), checkpointHash: digest(stored.root.checkpointFile.text), pointerHash: digest(pointer.text) }
  return { ...body, contentHash: digest(json(body)) }
}
export type AutomaticActionPlan = Awaited<ReturnType<typeof prepareAutomaticAction>>
export async function applyAutomaticAction(io: FileStore, plan: AutomaticActionPlan, owner: AutomaticState['owner'], ownerAlive: (owner: AutomaticState['owner']) => boolean) {
  const { contentHash, ...body } = plan
  invariant(contentHash === digest(json(body)), 'INVALID_APPROVAL', '自动推进恢复／结束计划已变化。')
  return io.lock(async () => {
    const fresh = await prepareAutomaticAction(io, plan.workflowId, plan.automaticId, plan.sessionId, plan.action, plan.reason, ownerAlive), stored = await readAutomatic(io, plan.workflowId, plan.automaticId)
    invariant(fresh.stateHash === plan.stateHash && fresh.checkpointHash === plan.checkpointHash && fresh.pointerHash === plan.pointerHash,
      'AUTOMATIC_STATE_CHANGED', '确认期间原登记、目标或检查点改变，未采用旧预览。')
    const state = structuredClone(stored.state)
    state.status = plan.action === 'resume' ? 'queued' : 'cancelled'; state.reason = plan.reason; state.code = undefined
    if (plan.action === 'resume') { state.owner = owner; state.executionSessionId = plan.sessionId }
    else for (const step of state.steps) if (step.state === 'pending') { step.state = 'interrupted'; step.completedAt = new Date().toISOString() }
    state.revision++; state.updatedAt = new Date().toISOString()
    await commit(io, [{ path: `${location(plan.workflowId, plan.automaticId)}/decisions/${plan.id}.json`, before: undefined,
      after: json({ schemaVersion: 1, ...body, decidedAt: state.updatedAt, previous: stored.state, next: state }) },
      { path: `${location(plan.workflowId, plan.automaticId)}/run.json`, before: stored.stateFile, after: json(automaticStateSchema.parse(state)) }])
    return { automaticId: plan.automaticId, status: state.status }
  })
}
export async function startAutomatic(io: FileStore, plan: AutomaticPlan, owner: AutomaticState['owner']) {
  const { contentHash, ...body } = plan
  automaticInputSchema.parse(plan.input)
  invariant(contentHash === digest(json(body)), 'INVALID_APPROVAL', '自动推进预览内容已变化。')
  return io.lock(async () => {
    const stored = await eligible(io, plan.input.workflowId), pointer = await io.read(`${base(plan.input.workflowId)}/current.json`), observed = await reviewInput(io)
    invariant(stored.current.ledger.projectId === plan.input.projectId && stored.current.ledgerHash === plan.ledgerHash && digest(stored.checkpointFile.text) === plan.checkpointHash &&
      (pointer ? digest(pointer.text) : null) === plan.pointerHash && observed.dependencyHash === plan.input.dependencyHash,
      'WORKFLOW_INPUT_CHANGED', '确认期间目标、事实、输入或自动推进改变；没有沿用旧授权。')
    const prefix = location(plan.input.workflowId, plan.input.automaticId), inputText = json(plan.input), checkpoint = structuredClone(stored.checkpoint)
    invariant(!!plan.reviewPlan === !!plan.input.modelReview, 'AUTOMATIC_CHILD_INVALID', '审查预览与冻结输入不一致。')
    invariant(!!plan.work === !!plan.input.work, 'AUTOMATIC_CHILD_INVALID', '阶段预览与冻结输入不一致。')
    if (plan.work) {
      validateWork(plan.work)
      const pin = plan.input.work!, child = plan.work.plan
      invariant(child.contentHash === pin.planHash && child.snapshot.runId === pin.runId && child.snapshot.stage === pin.stage && plan.work.kind === pin.kind &&
        child.snapshot.projectId === plan.input.projectId && child.snapshot.sessionId === plan.input.sessionId && child.snapshot.workflowId === plan.input.workflowId &&
        child.ledgerHash === stored.current.ledgerHash && child.snapshot.documentHash === stored.current.document.contentHash && child.snapshot.configHash === stored.current.configHash &&
        json(child.snapshot.modelDescriptor) === json(pin.modelDescriptor) && json(child.snapshot.skillDigests) === json(pin.skillDigests) &&
        (plan.work.kind === 'generation' ? plan.work.plan.inputBytes : Buffer.byteLength(json(plan.work.plan.searches))) === pin.inputBytes,
        'AUTOMATIC_CHILD_INVALID', '确认时冻结阶段或项目范围改变。')
    }
    if (plan.reviewPlan) {
      validateFrozenModelReview(plan.reviewPlan)
      invariant(plan.reviewPlan.contentHash === plan.input.modelReview!.planHash && plan.reviewPlan.ledgerHash === stored.current.ledgerHash &&
        plan.reviewPlan.dependencyHash === observed.dependencyHash && plan.reviewPlan.snapshot.projectId === plan.input.projectId &&
        plan.reviewPlan.snapshot.workflowId === plan.input.workflowId && plan.reviewPlan.snapshot.sessionId === plan.input.sessionId &&
        plan.reviewPlan.snapshot.runId === plan.input.modelReview!.runId && plan.reviewPlan.context.semanticScope === 'sf-cross-section-v1' &&
        plan.reviewPlan.inputBytes === plan.input.modelReview!.inputBytes && json(plan.reviewPlan.snapshot.modelDescriptor) === json(plan.input.modelReview!.modelDescriptor) &&
        json(plan.reviewPlan.snapshot.skillDigests) === json(plan.input.modelReview!.skillDigests), 'AUTOMATIC_CHILD_INVALID', '确认时审查计划已变化。')
    }
    checkpoint.budget ??= { calls: [], childDurationMs: {} }
    checkpoint.automaticBudget ??= { maxSteps: plan.input.policy.maxSteps, usedSteps: 0, maxNoProgress: plan.input.policy.maxNoProgress, noProgress: 0, progressHash: progress(stored) }
    if (checkpoint.automaticBudget.progressHash !== progress(stored)) {
      checkpoint.automaticBudget.noProgress = 0; checkpoint.automaticBudget.progressHash = progress(stored)
    }
    checkpoint.budget!.childDurationMs[plan.input.automaticId] = 0
    checkpoint.revision++; checkpoint.updatedAt = new Date().toISOString()
    const state = automaticStateSchema.parse({ schemaVersion: 1, automaticId: plan.input.automaticId, workflowId: plan.input.workflowId,
      projectId: plan.input.projectId, inputHash: digest(inputText), status: 'queued', revision: 0, owner,
      startedAt: checkpoint.updatedAt, updatedAt: checkpoint.updatedAt, reason: plan.work ? '操作者已确认当前事实推进和所列固定阶段；候选及检索结果另行审阅。' : plan.reviewPlan ? '操作者已确认当前事实推进及一次固定五项模型审查；修改仍须另行接受。' : '操作者已确认只推进当前已保存事实；不调用模型或新增网络请求。', steps: [] })
    await commit(io, [{ path: `${prefix}/input.json`, before: undefined, after: inputText }, { path: `${prefix}/run.json`, before: undefined, after: json(state) },
      ...(plan.reviewPlan ? [{ path: `${prefix}/review-plan.json`, before: undefined, after: json(plan.reviewPlan) }] : []),
      ...(plan.work ? [{ path: `${prefix}/work-plan.json`, before: undefined, after: json(plan.work) }] : []),
      { path: `${base(plan.input.workflowId)}/current.json`, before: pointer, after: json({ schemaVersion: 1, automaticId: state.automaticId, workflowId: state.workflowId, projectId: state.projectId }) },
      ...workflowCheckpointMutations(stored, checkpoint)])
    return { automaticId: state.automaticId }
  })
}
async function stateChange(io: FileStore, workflowId: string, automaticId: string, change: (state: AutomaticState) => void) {
  return io.lock(async () => {
    const stored = await readAutomatic(io, workflowId, automaticId), state = structuredClone(stored.state)
    change(state); state.revision++; state.updatedAt = new Date().toISOString()
    await commit(io, [{ path: `${location(workflowId, automaticId)}/run.json`, before: stored.stateFile, after: json(automaticStateSchema.parse(state)) }])
    return state
  })
}
export type AutomaticWorkers = { rulesReview?: (io: FileStore, revision: number) => Promise<unknown>; workingDelivery?: (io: FileStore) => Promise<unknown>;
  skillReader?: SkillReader;
  modelReview?: (plan: ModelReviewPlan, grant: AutomaticChildGrant, signal: AbortSignal, executionSessionId: string) => Promise<unknown>;
  generation?: (plan: GenerationPlan, grant: AutomaticChildGrant, signal: AbortSignal, executionSessionId: string) => Promise<unknown>;
  research?: (plan: ResearchBatchPlan, grant: AutomaticChildGrant, signal: AbortSignal, executionSessionId: string) => Promise<unknown> }
export type AutomaticControl = { pauseRequested: () => boolean }
const confirmationReason = '按操作者确认的自动推进范围登记已保存阶段事实；待补、未知与未关闭问题全部保留，不接受建议或宣称可提交。'
export async function driveAutomatic(io: FileStore, workflowId: string, automaticId: string, signal: AbortSignal, control: AutomaticControl,
  workers: AutomaticWorkers = {}) {
  const first = await readAutomatic(io, workflowId, automaticId)
  invariant(first.state.status === 'queued' && !first.state.steps.some(row => row.state === 'pending'), 'AUTOMATIC_RESUME_REQUIRED', '已开始的调度需要明确恢复或结束，不能重放旧步骤。')
  const timedOut = () => false
  await stateChange(io, workflowId, automaticId, state => {
    invariant(state.status === 'queued' && !state.steps.some(row => row.state === 'pending'), 'AUTOMATIC_IN_PROGRESS', '调度已被另一个执行器接管，未再次开始。')
    state.status = 'running'
  })
  const began = Date.now(), priorMs = first.root.checkpoint.budget!.childDurationMs[automaticId]!
  let childElapsedMs = 0
  const controlDuration = () => priorMs + Math.max(0, Date.now() - began - childElapsedMs)
  const publicationPending = async () => {
    try { return (await inspectRecovery(io, first.root.current.config.paths.manuscriptDir)).pending.length > 0 }
    catch { return true } // Damaged/conflicting journals must remain untouched.
  }
  const stop = (status: AutomaticState['status'], code: string, reason: string) => stateChange(io, workflowId, automaticId, state => { state.status = status; state.code = code; state.reason = reason })
  try {
    while (true) {
      await syncWorkflowDuration(io, workflowId, automaticId, controlDuration())
      const stored = await readWorkflow(io, workflowId), auto = await readAutomatic(io, workflowId, automaticId), limits = stored.checkpoint.automaticBudget!
      await currentGoal(io, workflowId, stored.current.ledger.projectId)
      const pointer = await io.read(`${base(workflowId)}/current.json`)
      invariant(pointer && pointerSchema.parse(JSON.parse(pointer.text)).automaticId === automaticId, 'AUTOMATIC_STATE_CHANGED', '当前自动推进索引改变，未继续旧调度。')
      invariant(auto.state.status === 'running', 'AUTOMATIC_STATE_CHANGED', '自动推进状态已由其他操作改变，未继续。')
      if (signal.aborted) return await stop(timedOut() ? 'completed-with-issues' : signal.reason === 'plugin-unload' ? 'interrupted' : 'cancelled',
        timedOut() ? 'WORKFLOW_BUDGET_EXHAUSTED' : 'AUTOMATIC_ABORTED', '调度已停止；原稿、问题、原额度和已完成结果保留。')
      if (control.pauseRequested() || stored.checkpoint.status === 'paused') return await stop('paused', 'AUTOMATIC_PAUSED', '已暂停，检查点保留；恢复需要重新确认原范围。')
      if (stored.checkpoint.status === 'cancelled') return await stop('cancelled', 'WORKFLOW_TERMINAL', '引导目标已取消，未继续调度。')
      const observed = await reviewInput(io)
      invariant(!stored.configChanged && observed.dependencyHash === auto.input.dependencyHash, 'WORKFLOW_INPUT_CHANGED', '资料、要求、大纲、记忆、文风或实际稿件已变化；旧授权停止。')
      if (limits.noProgress >= limits.maxNoProgress) return await stop('completed-with-issues', 'AUTOMATIC_NO_PROGRESS', '没有新增有效事实或问题变化，已达到原无进展上限；保留卡点。')
      const needsModelReview = auto.input.modelReview && !auto.state.steps.some(row => row.operation === 'model-review' && row.state === 'settled')
      const needsWork = auto.input.work && !auto.state.steps.some(row => ['model-generation', 'research-batch'].includes(row.operation) && row.state === 'settled')
      const workIndex = needsWork ? stored.gates.findIndex(row => row.stage === auto.input.work!.stage) : -1
      const gate = needsWork && stored.gates.slice(0, workIndex).every(row => row.current) ? stored.gates[workIndex] :
        needsModelReview && stored.gates.slice(0, 4).every(row => row.current) ? stored.gates.find(row => row.stage === 'review') : stored.gates.find(row => !row.current), policy = auto.input.policy
      let operation: AutomaticState['steps'][number]['operation'], action: 'complete-stage' | 'stop-revision' | 'finish' = 'complete-stage', reason = confirmationReason
      let reviewPlan: ModelReviewPlan | undefined
      let work: AutomaticWork | undefined
      if (!gate) { operation = 'finish'; action = 'finish' }
      else if (needsWork && gate.stage === auto.input.work!.stage) {
        work = await readAutomaticWork(io, workflowId, automaticId)
        invariant(work.plan.ledgerHash === stored.current.ledgerHash, 'WORKFLOW_INPUT_CHANGED', '阶段数据版本改变，请重新预览原范围。')
        invariant(work.kind === 'generation' ? workers.generation : workers.research, 'UNSUPPORTED_DSH_CAPABILITY', '宿主没有此阶段的实际执行器。')
        operation = work.kind === 'generation' ? 'model-generation' : 'research-batch'
      } else if (gate.stage === 'research' && gate.outcome === 'insufficient' && !policy.insufficientResearchReason)
        return await stop('waiting-input', 'RESEARCH_INSUFFICIENT', gate.reasons.join(' '))
      else if (gate.stage === 'review' && auto.input.modelReview && !auto.state.steps.some(row => row.operation === 'model-review' && row.state === 'settled')) {
        invariant(workers.modelReview, 'UNSUPPORTED_DSH_CAPABILITY', '宿主没有提供已授权模型审查执行器，没有降级成规则通过。')
        reviewPlan = await readAutomaticReview(io, workflowId, automaticId)
        invariant(reviewPlan.ledgerHash === stored.current.ledgerHash, 'REVIEW_INPUT_CHANGED', '原审查数据版本改变，须重新预览，不重建旧授权。')
        operation = 'model-review'
      } else if (gate.canComplete) { operation = 'acknowledge'; if (gate.stage === 'research' && gate.outcome === 'insufficient') reason = policy.insufficientResearchReason! }
      else if (gate.stage === 'review' && policy.ruleReview) operation = 'rules-review'
      else if (gate.stage === 'revision' && policy.stopRevisionReason && stored.gates.find(row => row.stage === 'review')!.current) {
        operation = 'acknowledge'; action = 'stop-revision'; reason = policy.stopRevisionReason
      } else if (gate.stage === 'delivery' && policy.workingDraftDelivery) operation = 'working-delivery'
      else return await stop('waiting-input', 'AUTOMATIC_USER_INPUT_REQUIRED', gate.reasons.join(' '))

      const beforeProgress = progress(stored), stepId = newId('automatic_step'), startedAt = new Date().toISOString()
      await io.lock(async () => {
        const fresh = await readAutomatic(io, workflowId, automaticId), root = await readWorkflow(io, workflowId), checkpoint = structuredClone(root.checkpoint)
        invariant(fresh.state.status === 'running' && !fresh.state.steps.some(row => row.state === 'pending') && digest(root.checkpointFile.text) === digest(stored.checkpointFile.text) &&
          !checkpoint.budget!.calls.some(row => row.state === 'pending'),
          'AUTOMATIC_STATE_CHANGED', '步骤或累计预算在登记前变化，未执行。')
        await ensureNoStageExecuting(io, root.current.ledger.projectId)
        const state = structuredClone(fresh.state)
        checkpoint.automaticBudget!.usedSteps++; checkpoint.revision++; checkpoint.updatedAt = startedAt
        state.steps.push({ stepId, number: checkpoint.automaticBudget!.usedSteps, ...(gate && { stage: gate.stage }), operation, beforeProgress, state: 'pending', startedAt,
          ...(reviewPlan && { child: { runId: reviewPlan.snapshot.runId, planHash: reviewPlan.contentHash } }),
          ...(work && { child: { runId: work.plan.snapshot.runId, planHash: work.plan.contentHash } }) })
        state.revision++; state.updatedAt = startedAt
        await commit(io, [...workflowCheckpointMutations(root, checkpoint),
          { path: `${location(workflowId, automaticId)}/run.json`, before: fresh.stateFile, after: json(automaticStateSchema.parse(state)) }])
      })
      signal.throwIfAborted()
      invariant((await reviewInput(io)).dependencyHash === auto.input.dependencyHash, 'WORKFLOW_INPUT_CHANGED', '步骤登记后输入改变，未执行旧范围；原登记与额度保留。')
      if (operation === 'model-review') {
        const childBegan = Date.now(), priorChildDuration = (await readWorkflowRecord(io, workflowId)).checkpoint.budget!.childDurationMs[reviewPlan!.snapshot.runId] ?? 0
        try {
          await workers.modelReview!(reviewPlan!, { workflowId, automaticId, stepId, runId: reviewPlan!.snapshot.runId, planHash: reviewPlan!.contentHash }, signal,
            auto.state.executionSessionId ?? auto.input.sessionId)
          const report = (await readWorkflow(io, workflowId)).gates.find(row => row.stage === 'review')!
          invariant(report.canComplete && report.artifacts.includes(reviewPlan!.reportId), 'AUTOMATIC_CHILD_INCOMPLETE', '已授权模型审查没有保存其同版报告，停止而不重放。')
        } finally {
          // Exclude only time actually recorded for this child. Host model
          // selection and validation overhead still consume parent time.
          if (!await publicationPending()) {
            const recorded = (await readWorkflowRecord(io, workflowId)).checkpoint.budget!.childDurationMs[reviewPlan!.snapshot.runId] ?? priorChildDuration
            childElapsedMs += Math.min(Math.max(0, Date.now() - childBegan), Math.max(0, recorded - priorChildDuration))
          }
        }
      } else if (work) {
        const childRunId = work.plan.snapshot.runId, childBegan = Date.now()
        const priorChildDuration = (await readWorkflowRecord(io, workflowId)).checkpoint.budget!.childDurationMs[childRunId] ?? 0
        const grant = { workflowId, automaticId, stepId, runId: childRunId, planHash: work.plan.contentHash }
        try {
          if (work.kind === 'generation') {
            if (work.sequenceAction) await applyDraftSequenceAction(io, work.sequenceAction, workers.skillReader)
            await workers.generation!(work.plan, grant, signal, auto.state.executionSessionId ?? auto.input.sessionId)
            const child = await readRun(io, childRunId, auto.input.projectId)
            invariant(child.run.status === 'completed-with-issues' && child.run.planHash === grant.planHash && child.run.proposalId,
              'AUTOMATIC_CHILD_INCOMPLETE', '冻结生成尚未保存候选；请查看原运行，不重放此步骤。')
            const image = await proposalImage(io, child.run.proposalId), checkpoint = await readGenerationCheckpoint(io, child.run)
            invariant(image.proposal.runId === childRunId && image.proposal.projectId === auto.input.projectId &&
              image.proposal.baseDocumentHash === work.plan.snapshot.documentHash && checkpoint.checkpoint.proposal &&
              json(image.proposal) === json(checkpoint.checkpoint.proposal), 'AUTOMATIC_CHILD_INCOMPLETE', '候选与原运行检查点不一致，不能据执行器回复宣称完成。')
          } else {
            await workers.research!(work.plan, grant, signal, auto.state.executionSessionId ?? auto.input.sessionId)
            const actual = await readResearchBatch(io, childRunId)
            invariant(['succeeded', 'completed-with-issues'].includes(actual.stored.run.status) && actual.plan.contentHash === grant.planHash &&
              actual.checkpoint.queries.every(query => ['completed', 'failed'].includes(query.state)),
              'AUTOMATIC_CHILD_INCOMPLETE', '检索尚未结束或未保存结果；成功记录保留，请从原运行恢复。')
          }
        } finally {
          if (!await publicationPending()) {
            const recorded = (await readWorkflowRecord(io, workflowId)).checkpoint.budget!.childDurationMs[childRunId] ?? priorChildDuration
            childElapsedMs += Math.min(Math.max(0, Date.now() - childBegan), Math.max(0, recorded - priorChildDuration))
          }
        }
      } else if (operation === 'rules-review') await (workers.rulesReview ?? runReview)(io, stored.current.ledger.revision)
      else if (operation === 'working-delivery') {
        if (workers.workingDelivery) await workers.workingDelivery(io)
        else { const plan = await prepareDelivery(io); await createDelivery(io, plan, 'working-draft', plan.ledgerRevision) }
      } else {
        const plan = await prepareWorkflowAction(io, { context: { requestId: stepId, workspaceId: 'workspace_domain_validation', sessionId: auto.state.executionSessionId ?? auto.input.sessionId }, workflowId,
          action, ...(gate && { stage: gate.stage }), reason })
        await applyWorkflowAction(io, plan)
      }
      await io.lock(async () => {
        const fresh = await readAutomatic(io, workflowId, automaticId), root = await readWorkflow(io, workflowId), checkpoint = structuredClone(root.checkpoint)
        const state = structuredClone(fresh.state), pending = state.steps.find(row => row.stepId === stepId)
        invariant(state.status === 'running' && pending?.state === 'pending', 'AUTOMATIC_STATE_CHANGED', '步骤状态变化，未覆盖原检查点。')
        const afterProgress = progress(root)
        pending.state = 'settled'; pending.afterProgress = afterProgress; pending.completedAt = new Date().toISOString()
        if (['rules-review', 'model-review', 'working-delivery', 'model-generation', 'research-batch'].includes(operation)) checkpoint.automaticBudget!.noProgress = afterProgress === beforeProgress ? checkpoint.automaticBudget!.noProgress + 1 : 0
        checkpoint.automaticBudget!.progressHash = afterProgress; checkpoint.revision++; checkpoint.updatedAt = pending.completedAt
        state.revision++; state.updatedAt = pending.completedAt
        if (operation === 'finish') { state.status = root.checkpoint.status === 'succeeded' ? 'succeeded' : 'completed-with-issues'; state.reason = '七阶段事实已登记并保存同版交付；质量保持原标识，不宣称学术结果或可提交。' }
        if (work) {
          state.status = 'completed-with-issues'; state.code = 'AUTOMATIC_STAGE_REVIEW_REQUIRED'
          state.reason = work.kind === 'generation' ? '本次冻结候选已保存，主稿保持原样。请审阅并明确接受／拒绝；接受后为实际新稿预览下一阶段，原任务预算继续累计。' :
            '本次冻结检索已结束，成功与失败结果分别保留。请审阅候选、收录来源并定位证据；元数据不能直接成为论点依据，原任务预算继续累计。'
        }
        await commit(io, [...workflowCheckpointMutations(root, checkpoint),
          { path: `${location(workflowId, automaticId)}/run.json`, before: fresh.stateFile, after: json(automaticStateSchema.parse(state)) }])
      })
      if (operation === 'finish' || work) return (await readAutomatic(io, workflowId, automaticId)).state
    }
  } catch (error) {
    const interrupted = signal.aborted && signal.reason === 'plugin-unload'
    const code = timedOut() ? 'WORKFLOW_BUDGET_EXHAUSTED' : error instanceof ScholarError ? error.code : signal.aborted ? 'AUTOMATIC_ABORTED' : 'AUTOMATIC_FAILED'
    if (!await publicationPending()) await stop(timedOut() ? 'completed-with-issues' : interrupted ? 'interrupted' : signal.aborted ? 'cancelled' : 'failed', code,
      timedOut() ? '原任务执行时间预算已耗尽；保留原稿、已收费请求、未知步骤和检查点，不重置额度。' :
        error instanceof ScholarError ? error.message : '自动推进未完成；保留原稿、步骤登记与累计额度，请检查中断记录。')
    throw error
  } finally {
    if (!await publicationPending()) await syncWorkflowDuration(io, workflowId, automaticId, controlDuration())
  }
}
