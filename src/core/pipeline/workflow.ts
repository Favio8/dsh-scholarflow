import { z } from 'zod'
import { hash, id, stage } from '../../shared/schema.ts'
import { workflowGoalSchema, workflowActionRequest, workflowCheckpointSchema, type WorkflowGoal, type WorkflowCheckpoint } from '../../shared/workflow.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { commit, inspectRecovery } from '../store/transactions.ts'
import { snapshot } from '../project/project.ts'
import { workflowGates } from './workflow-gates.ts'
import { invariant } from '../../shared/errors.ts'
import { ACTIVE_RUN } from './run-store.ts'

const POINTER = '.scholarflow/workflows/current.json'
const root = (workflowId: string) => {
  id.parse(workflowId); invariant(/^workflow_[\w]+$/u.test(workflowId), 'WORKFLOW_INVALID', '引导任务身份无效。')
  return `.scholarflow/runs/${workflowId}`
}
const terminal = (status: WorkflowCheckpoint['status']) => ['cancelled', 'succeeded', 'completed-with-issues'].includes(status)
const inputSchema = z.object({ schemaVersion: z.literal(1), workflowId: id, projectId: id, sessionId: id, goal: workflowGoalSchema, configHash: hash, createdAt: z.string() }).strict()
const planSchema = z.object({ schemaVersion: z.literal(1), workflowId: id, projectId: id, inputHash: hash,
  stages: z.array(stage).length(7), contentHash: hash }).strict()
const pointerSchema = z.object({ schemaVersion: z.literal(1), workflowId: id, projectId: id }).strict()
const runSchema = z.object({ schemaVersion: z.literal(1), workflowId: id, projectId: id, planHash: hash, checkpointHash: hash,
  status: workflowCheckpointSchema.shape.status, startedAt: z.string(), updatedAt: z.string() }).strict()
export async function readWorkflow(io: FileStore, workflowId: string) {
  const current = await snapshot(io), prefix = root(workflowId)
  const [inputFile, planFile, checkpointFile, runFile] = await Promise.all(['input.json', 'plan.json', 'checkpoint.json', 'run.json'].map(path => io.read(`${prefix}/${path}`)))
  invariant(inputFile && planFile && checkpointFile && runFile, 'WORKFLOW_INVALID', '引导任务快照缺失；未重建历史。')
  const input = inputSchema.parse(JSON.parse(inputFile.text)), plan = planSchema.parse(JSON.parse(planFile.text))
  const checkpoint = workflowCheckpointSchema.parse(JSON.parse(checkpointFile.text)), { contentHash, ...body } = plan
  const run = runSchema.parse(JSON.parse(runFile.text))
  invariant(input.workflowId === workflowId && plan.workflowId === workflowId && checkpoint.workflowId === workflowId &&
    [input.projectId, plan.projectId, checkpoint.projectId].every(value => value === current.ledger.projectId) &&
    plan.inputHash === digest(inputFile.text) && digest(json(body)) === contentHash && checkpoint.planHash === contentHash &&
    run.workflowId === workflowId && run.projectId === current.ledger.projectId && run.planHash === contentHash &&
    run.checkpointHash === digest(checkpointFile.text) && run.status === checkpoint.status &&
    json(plan.stages) === json(stage.options) && new Set(checkpoint.stamps.map(row => row.stage)).size === checkpoint.stamps.length,
    'WORKFLOW_INVALID', '引导任务身份、计划或检查点校验失败；原记录保留。')
  const facts = await workflowGates(io, input.goal)
  let priorCurrent = true
  const gates = facts.gates.map(gate => {
    const stamp = checkpoint.stamps.find(row => row.stage === gate.stage)
    const isCurrent = !!stamp && stamp.fingerprint === gate.fingerprint && priorCurrent
    const result = { ...gate, state: stamp ? isCurrent ? stamp.decision === 'skipped' ? 'skipped' as const : 'completed' as const : 'stale' as const : gate.state,
      stamp, priorCurrent, current: isCurrent }
    priorCurrent = isCurrent
    return result
  })
  return { current, input, plan, checkpoint, checkpointFile, run, runFile, gates, configChanged: input.configHash !== current.configHash }
}
export async function currentWorkflow(io: FileStore) {
  const current = await snapshot(io), file = await io.read(POINTER)
  if (!file) return { workflow: undefined }
  const pointer = pointerSchema.parse(JSON.parse(file.text))
  invariant(pointer.projectId === current.ledger.projectId, 'PROJECT_ID_CONFLICT', '引导任务索引不属于当前项目。')
  const stored = await readWorkflow(io, pointer.workflowId)
  const { checkpointFile, runFile, current: _current, ...workflow } = stored
  return { workflow }
}
export async function prepareWorkflow(io: FileStore, goal: WorkflowGoal, sessionId: string) {
  goal = workflowGoalSchema.parse(goal); id.parse(sessionId)
  const facts = await workflowGates(io, goal), active = await io.read(POINTER)
  if (active) {
    const pointer = pointerSchema.parse(JSON.parse(active.text)), previous = await readWorkflow(io, pointer.workflowId)
    invariant(terminal(previous.checkpoint.status), 'WORKFLOW_IN_PROGRESS', '当前引导任务尚未结束；请恢复或明确取消。')
  }
  const body = { id: newId('workflow_plan'), workflowId: newId('workflow'), projectId: facts.current.ledger.projectId, sessionId, goal,
    configHash: facts.current.configHash, ledgerHash: facts.current.ledgerHash, documentHash: facts.current.document.contentHash,
    fingerprints: facts.gates.map(row => row.fingerprint), pointerHash: active ? digest(active.text) : null }
  return { ...body, contentHash: digest(json(body)), gates: facts.gates }
}
export type WorkflowStartPlan = Awaited<ReturnType<typeof prepareWorkflow>>
export async function startWorkflow(io: FileStore, plan: WorkflowStartPlan) {
  const { contentHash, gates: _gates, ...body } = plan
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', '引导目标确认计划已改变。')
  return io.lock(async () => {
    const facts = await workflowGates(io, plan.goal), pointer = await io.read(POINTER)
    invariant(facts.current.ledger.projectId === plan.projectId && facts.current.configHash === plan.configHash &&
      facts.current.ledgerHash === plan.ledgerHash && facts.current.document.contentHash === plan.documentHash &&
      json(facts.gates.map(row => row.fingerprint)) === json(plan.fingerprints) && (pointer ? digest(pointer.text) : null) === plan.pointerHash,
      'WORKFLOW_INPUT_CHANGED', '确认期间项目或引导目标输入已改变，请重新预览。')
    invariant(!(await inspectRecovery(io, facts.current.config.paths.manuscriptDir)).pending.length && !await io.read(ACTIVE_RUN),
      'RUN_IN_PROGRESS', '先处理未完成事务或当前阶段执行，再建立引导任务。')
    const createdAt = new Date().toISOString(), input = inputSchema.parse({ schemaVersion: 1, workflowId: plan.workflowId,
      projectId: plan.projectId, sessionId: plan.sessionId, goal: plan.goal, configHash: plan.configHash, createdAt })
    const planBody = { schemaVersion: 1 as const, workflowId: plan.workflowId, projectId: plan.projectId, inputHash: digest(json(input)), stages: stage.options }
    const savedPlan = planSchema.parse({ ...planBody, contentHash: digest(json(planBody)) })
    const checkpoint = workflowCheckpointSchema.parse({ schemaVersion: 1, workflowId: plan.workflowId, projectId: plan.projectId,
      planHash: savedPlan.contentHash, revision: 0, status: 'waiting-input', stamps: [], updatedAt: createdAt })
    const prefix = root(plan.workflowId)
    await commit(io, [
      { path: `${prefix}/input.json`, before: undefined, after: json(input) },
      { path: `${prefix}/plan.json`, before: undefined, after: json(savedPlan) },
      { path: `${prefix}/checkpoint.json`, before: undefined, after: json(checkpoint) },
      { path: `${prefix}/run.json`, before: undefined, after: json(runSchema.parse({ schemaVersion: 1, workflowId: plan.workflowId, projectId: plan.projectId,
        planHash: savedPlan.contentHash, checkpointHash: digest(json(checkpoint)), status: checkpoint.status, startedAt: createdAt, updatedAt: createdAt })) },
      { path: POINTER, before: pointer, after: json({ schemaVersion: 1, workflowId: plan.workflowId, projectId: plan.projectId }) },
    ])
    return { workflowId: plan.workflowId }
  })
}
export async function prepareWorkflowAction(io: FileStore, input: z.infer<typeof workflowActionRequest>) {
  input = workflowActionRequest.parse(input)
  const stored = await readWorkflow(io, input.workflowId), pointer = await io.read(POINTER)
  invariant(pointer && pointerSchema.parse(JSON.parse(pointer.text)).workflowId === input.workflowId, 'WORKFLOW_NOT_CURRENT', '只可变更当前引导任务；历史记录保持只读。')
  invariant(!terminal(stored.checkpoint.status), 'WORKFLOW_TERMINAL', '引导任务已结束，原历史不能重新执行。')
  const completing = ['complete-stage', 'skip-stage', 'stop-revision'].includes(input.action)
  if (completing) {
    invariant(stored.checkpoint.status === 'waiting-input' && !stored.configChanged, 'WORKFLOW_INPUT_CHANGED', '任务已暂停或配置改变；请检查目标并处理当前任务。')
    const gate = stored.gates.find(row => row.stage === input.stage)
    invariant(gate && gate.priorCurrent, 'WORKFLOW_STAGE_ORDER', '先确认前序阶段的当前输入；过期阶段须重新检查。')
    invariant(!gate.current, 'WORKFLOW_STAGE_CURRENT', '这个阶段已经按当前输入确认，不重复记为进展。')
    if (input.action === 'skip-stage') invariant(gate.canSkip && input.reason.length >= 10, 'WORKFLOW_SKIP_DENIED', '只有当前审查没有未关闭问题时才可说明理由跳过修订。')
    else if (input.action === 'stop-revision') invariant(input.stage === 'revision' && stored.gates.find(row => row.stage === 'review')!.current && input.reason.length >= 10,
      'WORKFLOW_STOP_DENIED', '带问题结束修订须有当前审查和明确理由；原问题全部保留。')
    else invariant(gate.canComplete && (gate.outcome === 'ready' || input.reason.length >= 10), 'WORKFLOW_GATE_BLOCKED', '阶段事实不足，或尚未说明如何保留缺口与未知项。')
  } else if (input.action === 'resume') invariant(stored.checkpoint.status === 'paused' && !stored.configChanged, 'WORKFLOW_INPUT_CHANGED', '仅可恢复配置未变的暂停任务；资料变化会使相关阶段过期。')
  else if (input.action === 'pause') invariant(stored.checkpoint.status === 'waiting-input', 'WORKFLOW_NOT_RUNNING', '任务当前不能暂停。')
  else if (input.action === 'finish') invariant(stored.checkpoint.status === 'waiting-input' && !stored.configChanged && stored.gates.every(row => row.current), 'WORKFLOW_GATE_BLOCKED', '七阶段尚未全部按当前输入确认，不能结束交付。')
  else invariant(input.reason.length >= 10, 'WORKFLOW_REASON_REQUIRED', '取消任务须说明理由，已有产物和问题都会保留。')
  const body = { id: newId('workflow_action'), workflowId: input.workflowId, projectId: stored.current.ledger.projectId, sessionId: input.context.sessionId,
    action: input.action, stage: input.stage, reason: input.reason, checkpointHash: digest(stored.checkpointFile.text), pointerHash: digest(pointer.text),
    configHash: stored.current.configHash, fingerprints: stored.gates.map(row => row.fingerprint), gate: stored.gates.find(row => row.stage === input.stage) }
  return { ...body, contentHash: digest(json(body)) }
}
export type WorkflowActionPlan = Awaited<ReturnType<typeof prepareWorkflowAction>>
export async function applyWorkflowAction(io: FileStore, plan: WorkflowActionPlan) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', '引导任务操作预览已改变。')
  return io.lock(async () => {
    const stored = await readWorkflow(io, plan.workflowId), pointer = await io.read(POINTER)
    invariant(stored.current.ledger.projectId === plan.projectId && stored.current.configHash === plan.configHash &&
      digest(stored.checkpointFile.text) === plan.checkpointHash && pointer && digest(pointer.text) === plan.pointerHash &&
      json(stored.gates.map(row => row.fingerprint)) === json(plan.fingerprints), 'WORKFLOW_INPUT_CHANGED', '确认期间输入、检查点或当前任务改变；未采用旧预览。')
    invariant(!await io.read(ACTIVE_RUN) && !(await inspectRecovery(io, stored.current.config.paths.manuscriptDir)).pending.length,
      'RUN_IN_PROGRESS', '当前阶段仍在执行或事务待恢复；先结束阶段操作，再确认引导检查点。')
    const validated = await prepareWorkflowAction(io, { context: { requestId: plan.id, workspaceId: 'workspace_domain_validation', sessionId: plan.sessionId },
      workflowId: plan.workflowId, action: plan.action, stage: plan.stage, reason: plan.reason })
    invariant(validated.checkpointHash === plan.checkpointHash && validated.pointerHash === plan.pointerHash && validated.configHash === plan.configHash &&
      json(validated.fingerprints) === json(plan.fingerprints), 'WORKFLOW_INPUT_CHANGED', '最终检查期间阶段输入改变，未保存检查点。')
    const updatedAt = new Date().toISOString(), checkpoint = structuredClone(stored.checkpoint)
    if (['complete-stage', 'skip-stage', 'stop-revision'].includes(plan.action)) {
      const gate = plan.gate!
      checkpoint.stamps = checkpoint.stamps.filter(row => row.stage !== gate.stage)
      checkpoint.stamps.push({ stage: gate.stage, fingerprint: gate.fingerprint,
        outcome: plan.action === 'stop-revision' ? 'with-issues' : gate.outcome as 'ready' | 'with-issues' | 'insufficient',
        decision: plan.action === 'skip-stage' ? 'skipped' : plan.action === 'stop-revision' ? 'stopped' : 'completed',
        reason: plan.reason, artifacts: gate.artifacts, decidedAt: updatedAt, sessionId: plan.sessionId })
    } else if (plan.action === 'pause') checkpoint.status = 'paused'
    else if (plan.action === 'resume') checkpoint.status = 'waiting-input'
    else if (plan.action === 'cancel') checkpoint.status = 'cancelled'
    else checkpoint.status = checkpoint.stamps.some(row => row.outcome !== 'ready') ? 'completed-with-issues' : 'succeeded'
    checkpoint.revision++; checkpoint.updatedAt = updatedAt
    const prefix = root(plan.workflowId)
    await commit(io, [{ path: `${prefix}/decisions/${plan.id}.json`, before: undefined,
      after: json({ schemaVersion: 1, ...body, decidedAt: updatedAt, previous: stored.checkpoint, next: checkpoint }) },
      { path: `${prefix}/checkpoint.json`, before: stored.checkpointFile, after: json(workflowCheckpointSchema.parse(checkpoint)) },
      { path: `${prefix}/run.json`, before: stored.runFile, after: json(runSchema.parse({ ...stored.run, status: checkpoint.status,
        checkpointHash: digest(json(checkpoint)), updatedAt })) }])
    return { workflowId: plan.workflowId, status: checkpoint.status }
  })
}
