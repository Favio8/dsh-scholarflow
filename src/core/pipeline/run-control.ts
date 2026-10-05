import { z } from 'zod'
import { id, hash } from '../../shared/schema.ts'
import { generationRequest, runSnapshotSchema, runStateSchema, generationCheckpointSchema, type RunState } from '../../shared/runs.ts'
import { invariant } from '../../shared/errors.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { snapshot } from '../project/project.ts'
import { commit, inspectRecovery } from '../store/transactions.ts'
import { ACTIVE_RUN, readRun, readRunInput, runFile } from './run-store.ts'
import { proposalImage } from '../editing/proposals.ts'
import type { GenerationPlan } from './generation.ts'

export const frozenPlanFile = (runId: string) => `.scholarflow/runs/${id.parse(runId)}/plan.json`
export const checkpointFile = (runId: string) => `.scholarflow/runs/${id.parse(runId)}/checkpoint.json`
const frozenSchema = z.object({ id, contentHash: hash, snapshot: runSnapshotSchema.refine(value => ['drafting', 'revision'].includes(value.stage)), input: generationRequest,
  context: z.record(z.string(), z.unknown()), evidenceIds: z.array(id).max(10000), inputBytes: z.number().int().min(0), ledgerHash: hash,
  parentRunId: id.optional(), retryNotBefore: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), sectionTarget: z.object({ sectionId: id, title: z.string(), depth: z.number().int().min(1).max(6),
    mode: z.enum(['insert', 'replace-body']), startUtf16: z.number().int().min(0), endUtf16: z.number().int().min(0) }).strict().optional() }).strict()

export function validateFrozenGeneration(plan: unknown): asserts plan is GenerationPlan {
  const parsed = frozenSchema.parse(plan)
  // Hash the unchanged producer representation, including its deliberate field
  // order; schema parsing is validation, not rewriting immutable old inputs.
  const { contentHash: originalHash, ...originalBody } = plan as GenerationPlan
  invariant(digest(json(originalBody)) === originalHash && parsed.snapshot.projectId === parsed.input.context.projectId,
    'RUN_CHECKPOINT_CHANGED', '冻结生成计划的摘要或项目身份不匹配。')
}
export async function readFrozenGeneration(io: FileStore, runId: string, projectId: string) {
  const file = await io.read(frozenPlanFile(runId))
  invariant(file && Buffer.byteLength(file.text) <= 20 * 1024 * 1024, 'RUN_CHECKPOINT_UNAVAILABLE', '该运行没有可验证的完整输入检查点；请结束中断记录后重新预览新任务。')
  const raw = JSON.parse(file.text)
  validateFrozenGeneration(raw)
  const { contentHash, ...body } = raw
  invariant(digest(json(body)) === contentHash && raw.snapshot.projectId === projectId && raw.snapshot.runId === runId &&
    raw.input.context.projectId === projectId, 'RUN_CHECKPOINT_CHANGED', '冻结输入的摘要或身份不匹配，未恢复。')
  const input = await readRunInput(io, runId, projectId)
  invariant(json(input.snapshot) === json(raw.snapshot), 'RUN_CHECKPOINT_CHANGED', '输入快照与冻结计划不一致。')
  return { plan: raw as GenerationPlan, file }
}

export async function readGenerationCheckpoint(io: FileStore, state: RunState) {
  const file = await io.read(checkpointFile(state.runId))
  invariant(file && state.checkpointHash && digest(file.text) === state.checkpointHash, 'RUN_CHECKPOINT_CHANGED', '运行检查点缺失或改变，不能猜测恢复。')
  const checkpoint = generationCheckpointSchema.parse(JSON.parse(file.text))
  invariant(checkpoint.projectId === state.projectId && checkpoint.runId === state.runId && checkpoint.planHash === state.planHash,
    'RUN_CHECKPOINT_CHANGED', '运行检查点身份不一致。')
  invariant(!checkpoint.proposal || checkpoint.proposal.runId === state.runId && checkpoint.proposal.projectId === state.projectId,
    'RUN_CHECKPOINT_CHANGED', '检查点中的建议不属于此运行。')
  return { checkpoint, file }
}

export async function prepareRunAction(io: FileStore, runId: string, action: 'resume' | 'close' | 'retry', ownerAlive: (owner: RunState['owner']) => boolean) {
  const current = await snapshot(io), stored = await readRun(io, runId, current.ledger.projectId), active = await io.read(ACTIVE_RUN)
  invariant(!(await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先恢复多文件事务，再处理运行。')
  const terminal = ['failed', 'cancelled', 'succeeded', 'completed-with-issues'].includes(stored.run.status)
  if (action === 'retry') invariant(['failed', 'cancelled'].includes(stored.run.status), 'RUN_RETRY_UNAVAILABLE', '只能从失败或取消记录创建新运行。')
  else {
    invariant(!terminal, 'RUN_TERMINAL', '运行已有终态，历史不会被恢复操作擦除。')
    invariant(stored.run.status === 'paused' || !ownerAlive(stored.run.owner), 'RUN_OWNER_ALIVE', '原执行进程仍存活，不能接管。请在原会话暂停或取消；若已重新加载插件，请重启宿主后再检查。')
    invariant(active && JSON.parse(active.text).runId === runId && digest(active.text) === digest(stored.file.text),
      'RUN_STATE_CHANGED', '活动投影与运行事实源不一致，未猜测修复。')
  }
  let frozen: Awaited<ReturnType<typeof readFrozenGeneration>> | undefined, progress: Awaited<ReturnType<typeof readGenerationCheckpoint>> | undefined
  let existingProposalId: string | undefined, existingProposalState: string | undefined
  if (action !== 'close') {
    invariant(!stored.legacy, 'RUN_MIGRATION_REQUIRED', '先明确迁移旧存储格式；缺少完整输入的旧运行不能自动恢复。')
    frozen = await readFrozenGeneration(io, runId, current.ledger.projectId)
    invariant(frozen.plan.contentHash === stored.run.planHash, 'RUN_CHECKPOINT_CHANGED', '运行与冻结计划不一致。')
    progress = await readGenerationCheckpoint(io, stored.run)
    invariant(stored.run.status !== 'paused' || !progress.checkpoint.pendingCall, 'RUN_CHECKPOINT_CHANGED', '暂停记录仍有未结束调用，不能按安全暂停恢复。')
    if (progress.checkpoint.proposal) {
      const proposal = progress.checkpoint.proposal, state = current.ledger.proposalStates[proposal.id]
      if (state) {
        const image = await proposalImage(io, proposal.id)
        invariant(json(image.proposal) === json(proposal), 'PROPOSAL_CHANGED', '已保存建议与运行检查点不一致，未重放。')
        existingProposalId = proposal.id; existingProposalState = state.state
      }
    }
    invariant(action !== 'retry' || !existingProposalId, 'RUN_ARTIFACT_EXISTS', '该运行已保存建议，先查看原建议；不因失败状态重复生成。')
    if (action === 'resume' && !existingProposalId) invariant(current.configHash === frozen.plan.snapshot.configHash && current.ledgerHash === frozen.plan.ledgerHash &&
      current.document.contentHash === frozen.plan.snapshot.documentHash, 'STALE_DOCUMENT_VERSION', '检查点之后项目输入已改变；请结束旧运行再为当前版本预览新任务。')
  }
  const body = { id: newId('run_action'), projectId: current.ledger.projectId, runId, action, stateHash: digest(stored.file.text),
    statePath: stored.path, activeHash: active ? digest(active.text) : null, frozenHash: frozen ? digest(frozen.file.text) : null,
    checkpointHash: progress ? digest(progress.file.text) : null, ledgerHash: current.ledgerHash, configHash: current.configHash,
    documentHash: current.document.contentHash, existingProposalId, existingProposalState, retryNotBefore: progress?.checkpoint.retryNotBefore }
  return { ...body, contentHash: digest(json(body)), frozen: frozen?.plan }
}
export type RunActionPlan = Awaited<ReturnType<typeof prepareRunAction>>

export async function validateRunAction(io: FileStore, plan: RunActionPlan, ownerAlive: (owner: RunState['owner']) => boolean) {
  const { contentHash, frozen: _frozen, ...body } = plan
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', '运行操作预览改变。')
  const stored = await readRun(io, plan.runId, plan.projectId), active = await io.read(ACTIVE_RUN), current = await snapshot(io)
  invariant(digest(stored.file.text) === plan.stateHash && stored.path === plan.statePath && (active ? digest(active.text) : null) === plan.activeHash &&
    current.ledgerHash === plan.ledgerHash && current.configHash === plan.configHash && current.document.contentHash === plan.documentHash,
    'RUN_STATE_CHANGED', '确认期间运行或项目输入改变，请重新预览。')
  invariant(!(await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先恢复多文件事务。')
  if (plan.action !== 'retry') invariant(stored.run.status === 'paused' || !ownerAlive(stored.run.owner), 'RUN_OWNER_ALIVE', '原执行进程仍存活，不能接管。')
  if (plan.frozenHash) invariant(digest((await io.read(frozenPlanFile(plan.runId)))?.text ?? '') === plan.frozenHash &&
    digest((await io.read(checkpointFile(plan.runId)))?.text ?? '') === plan.checkpointHash, 'RUN_CHECKPOINT_CHANGED', '确认期间冻结输入或检查点改变。')
  return { stored, active, current }
}

export async function closeRun(io: FileStore, plan: RunActionPlan, ownerAlive: (owner: RunState['owner']) => boolean) {
  invariant(plan.action === 'close', 'INVALID_APPROVAL', '此计划不是结束中断运行。')
  return io.lock(async () => {
    const { stored, active } = await validateRunAction(io, plan, ownerAlive)
    const state = runStateSchema.parse({ ...stored.run, status: 'cancelled', errorCode: 'USER_CLOSED_CHECKPOINT', updatedAt: new Date().toISOString() })
    await commit(io, [{ path: `.scholarflow/runs/${plan.runId}/control-history/${plan.id}.json`, before: undefined,
      after: json({ schemaVersion: 1, action: 'close', originalState: stored.file.text, approvedPlanHash: plan.contentHash }) },
      { path: stored.path, before: stored.file, after: json(state) }, { path: ACTIVE_RUN, before: active, after: json(state) }])
    return { run: state, manuscriptUnchanged: true }
  })
}
