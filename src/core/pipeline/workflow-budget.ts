import { z } from 'zod'
import { id, stage } from '../../shared/schema.ts'
import { invariant } from '../../shared/errors.ts'
import { type FileStore } from '../store/files.ts'
import { commit } from '../store/transactions.ts'
import { readWorkflowRecord, workflowCheckpointMutations, WORKFLOW_POINTER } from './workflow.ts'
import type { WorkflowCheckpoint } from '../../shared/workflow.ts'
import { isDetachedProjectPointer } from '../project/identity.ts'
import { ensureNoAutomaticExecuting } from './automatic-lease.ts'
import { automaticChildGrantSchema } from '../../shared/workflow-automatic.ts'

const pointerSchema = z.object({ schemaVersion: z.literal(1), workflowId: id, projectId: id }).strict()
const requestSchema = z.object({ callId: id, runId: id, stage, kind: z.enum(['model', 'search', 'lookup']),
  owner: z.object({ pid: z.number().int().min(1), bootInstance: z.string().min(1).max(200) }).strict().optional(),
  candidateLimit: z.number().int().min(0).max(80).default(0), activeDurationMs: z.number().int().nonnegative().default(0), automaticChild: automaticChildGrantSchema.optional() }).strict()
export type WorkflowCall = z.input<typeof requestSchema>
function statistics(checkpoint: WorkflowCheckpoint, now = Date.now()) {
  const budget = checkpoint.budget!
  invariant(new Set(budget.calls.map(row => row.callId)).size === budget.calls.length &&
    budget.calls.every(row => row.receivedCandidates <= row.reservedCandidates && budget.childDurationMs[row.runId] !== undefined &&
      Number.isFinite(Date.parse(row.startedAt)) && row.startDurationMs <= budget.childDurationMs[row.runId] &&
      (row.state === 'pending' ? !row.completedAt : !!row.completedAt && Number.isFinite(Date.parse(row.completedAt)))),
    'WORKFLOW_BUDGET_INVALID', '累计预算检查点无法校验；未重置额度。')
  return { modelCalls: budget.calls.filter(row => row.kind === 'model').length,
    searchQueries: budget.calls.filter(row => row.kind !== 'model').length,
    candidates: budget.calls.reduce((sum, row) => sum + (['pending', 'interrupted'].includes(row.state) ? row.reservedCandidates : row.receivedCandidates), 0),
    durationMs: Object.values(budget.childDurationMs).reduce((sum, ms) => sum + ms, 0) + budget.calls.filter(row => row.state === 'pending')
      .reduce((sum, row) => sum + Math.max(0, now - Date.parse(row.startedAt)), 0),
    reviewRounds: new Set(budget.calls.filter(row => row.stage === 'review' && row.kind === 'model').map(row => row.runId)).size }
}
async function binding(io: FileStore, expected?: string) {
  const image = await io.read(WORKFLOW_POINTER)
  if (!image || await isDetachedProjectPointer(io, WORKFLOW_POINTER, image)) { invariant(!expected, 'WORKFLOW_BINDING_CHANGED', '原引导任务索引缺失或已归档为副本历史；未调用提供方。'); return }
  const pointer = pointerSchema.parse(JSON.parse(image.text)), stored = await readWorkflowRecord(io, pointer.workflowId)
  invariant(stored.current.ledger.projectId === pointer.projectId, 'PROJECT_ID_CONFLICT', '引导预算不属于当前项目。')
  const terminal = ['cancelled', 'succeeded', 'completed-with-issues'].includes(stored.checkpoint.status)
  if (terminal) { invariant(!expected, 'WORKFLOW_TERMINAL', '原引导任务已结束，不能重放其中的执行计划。'); return }
  invariant(expected === pointer.workflowId, 'WORKFLOW_BINDING_CHANGED', '当前引导任务改变；请重新预览阶段发送范围与累计预算。')
  invariant(!stored.configChanged, 'WORKFLOW_INPUT_CHANGED', '引导目标的配置改变，未调用提供方。')
  invariant(stored.checkpoint.status === 'waiting-input', 'WORKFLOW_PAUSED', '引导任务已暂停；先明确恢复再执行阶段。')
  return stored
}
export async function workflowBudgetInfo(io: FileStore) {
  const image = await io.read(WORKFLOW_POINTER)
  if (!image || await isDetachedProjectPointer(io, WORKFLOW_POINTER, image)) return
  const pointer = pointerSchema.parse(JSON.parse(image.text)), stored = await readWorkflowRecord(io, pointer.workflowId)
  invariant(pointer.projectId === stored.current.ledger.projectId, 'PROJECT_ID_CONFLICT', '累计预算索引不属于当前项目。')
  if (['cancelled', 'succeeded', 'completed-with-issues'].includes(stored.checkpoint.status)) return
  const used = stored.checkpoint.budget ? statistics(stored.checkpoint) : undefined
  return { workflowId: stored.input.workflowId, status: stored.checkpoint.status, limits: stored.input.budget, maxReviewRounds: stored.input.maxReviewRounds,
    used, pendingCalls: stored.checkpoint.budget?.calls.filter(row => row.state === 'pending').map(row => ({ callId: row.callId, runId: row.runId, stage: row.stage })) ?? [] }
}
export async function workflowAssociation(io: FileStore) {
  const info = await workflowBudgetInfo(io)
  if (!info) return undefined
  await binding(io, info.workflowId)
  return info.workflowId
}
export async function reserveWorkflowCall(io: FileStore, expected: string | undefined, input: WorkflowCall) {
  const request = requestSchema.parse(input)
  invariant(!request.automaticChild || request.automaticChild.workflowId === expected, 'AUTOMATIC_CHILD_INVALID', '自动调用必须绑定原目标预算。')
  return io.lock(async () => {
    const stored = await binding(io, expected)
    if (!stored) return undefined
    invariant(!request.automaticChild || request.automaticChild.runId === request.runId && request.automaticChild.workflowId === expected &&
      (request.kind === 'model' && ['drafting', 'revision', 'review'].includes(request.stage) || request.kind === 'search' && request.stage === 'research'),
      'AUTOMATIC_CHILD_INVALID', '调度授权不属于这个阶段或调用。')
    await ensureNoAutomaticExecuting(io, stored.input.projectId, request.automaticChild)
    invariant(request.owner, 'WORKFLOW_OWNER_REQUIRED', '累计请求须绑定可检查的实际执行进程；未发起请求。')
    const checkpoint = structuredClone(stored.checkpoint), budget = checkpoint.budget ??= { calls: [], childDurationMs: {} }
    invariant(!budget.calls.some(row => row.callId === request.callId), 'WORKFLOW_CALL_ALREADY_CHARGED', '这个调用已经计入累计预算；未知响应不能重新发送同一次请求。')
    invariant(!budget.calls.some(row => row.state === 'pending'), 'WORKFLOW_CALL_PENDING', '前一请求仍未结束或响应未知；先等待或明确处理进程中断记录，不并行请求。')
    budget.childDurationMs[request.runId] = Math.max(budget.childDurationMs[request.runId] ?? 0, request.activeDurationMs)
    statistics(checkpoint) // Counts and duration remain inspectable, never stopping thresholds.
    const startedAt = new Date().toISOString()
    budget.calls.push({ callId: request.callId, runId: request.runId, stage: request.stage, kind: request.kind, state: 'pending',
      startedAt, reservedCandidates: request.candidateLimit, receivedCandidates: 0, startDurationMs: budget.childDurationMs[request.runId], owner: request.owner })
    checkpoint.revision++; checkpoint.updatedAt = startedAt
    await commit(io, workflowCheckpointMutations(stored, checkpoint))
    return { workflowId: stored.input.workflowId, callId: request.callId }
  })
}
export async function settleWorkflowCall(io: FileStore, reservation: Awaited<ReturnType<typeof reserveWorkflowCall>>, state: 'succeeded' | 'failed', candidates: number) {
  if (!reservation) return
  return io.lock(async () => {
    const stored = await readWorkflowRecord(io, reservation.workflowId), checkpoint = structuredClone(stored.checkpoint)
    invariant(checkpoint.budget, 'WORKFLOW_BUDGET_INVALID', '原累计预算缺失；未重建计数。')
    statistics(checkpoint)
    const call = checkpoint.budget.calls.find(row => row.callId === reservation.callId)
    invariant(call && call.state === 'pending' && Number.isInteger(candidates) && candidates >= 0 && candidates <= call.reservedCandidates,
      'WORKFLOW_BUDGET_INVALID', '原调用或候选数量无法校验；未覆盖累计预算。')
    call.state = state; call.receivedCandidates = candidates; call.completedAt = new Date().toISOString()
    checkpoint.budget.childDurationMs[call.runId] = Math.max(checkpoint.budget.childDurationMs[call.runId],
      call.startDurationMs + Math.max(0, Date.parse(call.completedAt) - Date.parse(call.startedAt)))
    checkpoint.revision++; checkpoint.updatedAt = call.completedAt
    await commit(io, workflowCheckpointMutations(stored, checkpoint))
  })
}
export async function syncWorkflowDuration(io: FileStore, workflowId: string | undefined, runId: string, durationMs: number) {
  if (!workflowId) return
  id.parse(runId); invariant(Number.isInteger(durationMs) && durationMs >= 0, 'WORKFLOW_BUDGET_INVALID', '阶段执行时间无法校验。')
  await io.lock(async () => {
    const stored = await readWorkflowRecord(io, workflowId), checkpoint = structuredClone(stored.checkpoint)
    invariant(checkpoint.budget, 'WORKFLOW_BUDGET_MISSING', '原累计预算缺失，未重置。')
    statistics(checkpoint)
    const recorded = checkpoint.budget.childDurationMs[runId]
    if (recorded === undefined || durationMs <= recorded) return
    checkpoint.budget.childDurationMs[runId] = durationMs; checkpoint.revision++; checkpoint.updatedAt = new Date().toISOString()
    await commit(io, workflowCheckpointMutations(stored, checkpoint))
  })
}
export async function workflowCall<T>(io: FileStore, workflowId: string | undefined, request: WorkflowCall, signal: AbortSignal,
  execute: (signal: AbortSignal) => Promise<T>, candidateCount: (result: T) => number = () => 0): Promise<T> {
  signal.throwIfAborted()
  const reservation = await reserveWorkflowCall(io, workflowId, request)
  let result: T, candidates: number
  try { result = await execute(signal); signal.throwIfAborted(); candidates = candidateCount(result)
    invariant(Number.isInteger(candidates) && candidates >= 0 && candidates <= (request.candidateLimit ?? 0), 'WORKFLOW_BUDGET_INVALID', '返回候选数量无法校验，未自动纳入来源。') }
  catch (error) { await settleWorkflowCall(io, reservation, 'failed', 0); throw error }
  await settleWorkflowCall(io, reservation, 'succeeded', candidates)
  return result
}
