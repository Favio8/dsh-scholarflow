import { batchPrepareRequest, batchPlanSchema, batchCheckpointSchema, type ResearchBatchPlan, type ResearchBatchCheckpoint } from '../../shared/research-batch.ts'
import { searchRecordSchema, type SearchRecord, type ResearchProvider } from '../../shared/online-research.ts'
import { runSnapshotSchema, runStateSchema, type RunState } from '../../shared/runs.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { commit, inspectRecovery, type Mutation } from '../store/transactions.ts'
import { snapshot } from '../project/project.ts'
import { ACTIVE_RUN, readRun, readRunInput, runFile, inputFile } from '../pipeline/run-store.ts'
import { frozenPlanFile, checkpointFile } from '../pipeline/run-control.ts'
import { transientRetry, waitRetrySlice } from '../pipeline/retry.ts'
import { readSearch } from './online.ts'
import { workflowAssociation, workflowCall, syncWorkflowDuration } from '../pipeline/workflow-budget.ts'
import { isDetachedProjectPointer } from '../project/identity.ts'
import { ensureNoAutomaticExecuting } from '../pipeline/automatic-lease.ts'

const terminal = (status: RunState['status']) => ['failed', 'cancelled', 'succeeded', 'completed-with-issues'].includes(status)
const searchPath = (searchId: string) => `.scholarflow/research/${searchId}.json`
const outcomeHash = (record: SearchRecord) => { const { decisions: _decisions, ...outcome } = searchRecordSchema.parse(record); return digest(json(outcome)) }
export async function prepareResearchBatch(io: FileStore, request: unknown, parentRunId?: string): Promise<ResearchBatchPlan> {
  const input = batchPrepareRequest.parse(request), current = await snapshot(io)
  invariant(input.context.projectId === current.ledger.projectId && input.context.expectedLedgerRevision === current.ledger.revision,
    'STALE_LEDGER_REVISION', '请为当前项目版本预览检索计划。')
  invariant(!current.config.research.providerRefs.length || current.config.research.providerRefs.includes('crossref'),
    'RESEARCH_PROVIDER_NOT_APPROVED', '项目未选择 Crossref 提供方。')
  const profile = await io.read(current.config.writing.projectProfile)
  const workflowId = await workflowAssociation(io)
  const snapshotInput = runSnapshotSchema.parse({ schemaVersion: 1, runId: newId('run'), projectId: current.ledger.projectId,
    ...(workflowId && { workflowId }),
    sessionId: input.context.sessionId, stage: 'research', configHash: current.configHash, ledgerRevision: current.ledger.revision,
    documentHash: current.document.contentHash, outlineVersion: current.ledger.outline.version, materialHashes: {}, sourceHashes: {},
    profileHash: digest(profile?.text ?? ''), skillDigests: [], modelDescriptor: { providerId: 'none', modelId: 'none' },
    budget: current.config.workflow.budget, networkScope: 'approved-providers', createdAt: new Date().toISOString() })
  const body = { schemaVersion: 1 as const, id: newId('researchplan'), snapshot: snapshotInput, ledgerHash: current.ledgerHash,
    searches: input.searches.map(search => ({ queryId: newId('query'), search })), ...(parentRunId && { parentRunId }) }
  return batchPlanSchema.parse({ ...body, contentHash: digest(json(body)) })
}
export function verifyPlan(plan: ResearchBatchPlan) {
  batchPlanSchema.parse(plan); const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash && plan.snapshot.stage === 'research' && plan.snapshot.networkScope === 'approved-providers',
    'RUN_CHECKPOINT_CHANGED', '冻结检索计划摘要或阶段不匹配。')
  invariant(new Set(plan.searches.map(row => row.queryId)).size === plan.searches.length,
    'RUN_CHECKPOINT_CHANGED', '冻结计划的查询身份重复。')
}
export async function readResearchBatch(io: FileStore, runId: string) {
  const current = await snapshot(io), stored = await readRun(io, runId, current.ledger.projectId)
  invariant(stored.run.stage === 'research' && !stored.legacy, 'RUN_CHECKPOINT_UNAVAILABLE', '这不是可恢复的多查询检索运行。')
  const file = await io.read(frozenPlanFile(runId)), checkpointFileImage = await io.read(checkpointFile(runId))
  invariant(file && checkpointFileImage && Buffer.byteLength(file.text) <= 100000 && Buffer.byteLength(checkpointFileImage.text) <= 100000,
    'RUN_CHECKPOINT_UNAVAILABLE', '检索计划或检查点缺失、过大，未猜测恢复。')
  const plan = batchPlanSchema.parse(JSON.parse(file.text)), checkpoint = batchCheckpointSchema.parse(JSON.parse(checkpointFileImage.text))
  verifyPlan(plan)
  invariant(plan.snapshot.runId === runId && plan.snapshot.projectId === current.ledger.projectId && stored.run.planHash === plan.contentHash &&
    json((await readRunInput(io, runId, current.ledger.projectId)).snapshot) === json(plan.snapshot) &&
    digest(checkpointFileImage.text) === stored.run.checkpointHash && checkpoint.planHash === plan.contentHash && checkpoint.runId === runId &&
    checkpoint.projectId === current.ledger.projectId && json(checkpoint.queries.map(row => row.queryId)) === json(plan.searches.map(row => row.queryId)),
    'RUN_CHECKPOINT_CHANGED', '检索记录的身份、输入或检查点不一致。')
  let candidates = 0
  invariant(checkpoint.queriesUsed === checkpoint.queries.reduce((sum, query) => sum + query.attempts.length, 0), 'RUN_CHECKPOINT_CHANGED', '查询次数与已保存尝试不一致。')
  for (const query of checkpoint.queries) {
    invariant(query.state !== 'completed' || query.attempts.at(-1)?.state === 'completed', 'RUN_CHECKPOINT_CHANGED', '成功查询缺少成功快照。')
    invariant(query.state !== 'running' || query.attempts.at(-1)?.state === 'running', 'RUN_CHECKPOINT_CHANGED', '运行查询缺少调用检查点。')
    for (const attempt of query.attempts) {
      const search = await readSearch(io, attempt.searchId)
      invariant(json(search.record.search) === json(plan.searches.find(row => row.queryId === query.queryId)!.search) && search.record.state === attempt.state &&
        (attempt.state === 'running' || attempt.outcomeHash === outcomeHash(search.record)), 'RUN_CHECKPOINT_CHANGED', '查询结果与检查点不同，保留原文件。')
      candidates += search.record.records.length
    }
  }
  invariant(candidates === checkpoint.candidatesReceived, 'RUN_CHECKPOINT_CHANGED', '候选计数与原结果不一致。')
  return { current, stored, plan, file, checkpoint, checkpointFileImage }
}
export async function prepareResearchBatchAction(io: FileStore, runId: string, action: 'resume' | 'retry' | 'close', ownerAlive: (owner: RunState['owner']) => boolean, retrySessionId?: string) {
  const data = await readResearchBatch(io, runId), active = await io.read(ACTIVE_RUN)
  invariant(!(await inspectRecovery(io, data.current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '请先确认恢复项目事务。')
  if (action === 'retry') invariant(['failed', 'cancelled'].includes(data.stored.run.status), 'RUN_RETRY_UNAVAILABLE', '只从失败或取消运行创建关联重试。')
  else {
    invariant(!terminal(data.stored.run.status), 'RUN_TERMINAL', '检索运行已有终态，原历史保持不变。')
    invariant(data.stored.run.status === 'paused' || !ownerAlive(data.stored.run.owner), 'RUN_OWNER_ALIVE', '原执行进程仍存活，请在原会话暂停或取消。')
    invariant(active?.text === data.stored.file.text, 'RUN_STATE_CHANGED', '活动运行与事实源不同。')
  }
  if (action === 'resume') invariant(data.current.configHash === data.plan.snapshot.configHash,
    'STALE_PROJECT_CONFIG', '项目检索权限或预算配置改变，请结束原运行后重新预览。')
  const retryPlan = action === 'retry' ? await prepareResearchBatch(io, { context: { requestId: newId('req'), workspaceId: 'ws_retry', sessionId: retrySessionId ?? data.stored.run.executionSessionId ?? data.stored.run.sessionId,
    projectId: data.current.ledger.projectId, expectedLedgerRevision: data.current.ledger.revision }, searches: data.plan.searches.map(row => row.search) }, runId) : undefined
  const body = { id: newId('researchaction'), runId, projectId: data.current.ledger.projectId, action,
    stateHash: digest(data.stored.file.text), checkpointHash: digest(data.checkpointFileImage.text), planHash: digest(data.file.text),
    activeHash: active ? digest(active.text) : null, ledgerHash: data.current.ledgerHash, configHash: data.current.configHash,
    retryPlanHash: retryPlan?.contentHash ?? null }
  return { ...body, contentHash: digest(json(body)), retryPlan }
}
export type ResearchBatchAction = Awaited<ReturnType<typeof prepareResearchBatchAction>>
async function validateAction(io: FileStore, action: ResearchBatchAction, ownerAlive: (owner: RunState['owner']) => boolean) {
  const { contentHash, retryPlan: _retry, ...body } = action
  invariant(digest(json(body)) === contentHash && (action.retryPlan?.contentHash ?? null) === action.retryPlanHash, 'INVALID_APPROVAL', '检索恢复计划改变。')
  const data = await readResearchBatch(io, action.runId), active = await io.read(ACTIVE_RUN)
  invariant(digest(data.stored.file.text) === action.stateHash && digest(data.checkpointFileImage.text) === action.checkpointHash && digest(data.file.text) === action.planHash &&
    (active ? digest(active.text) : null) === action.activeHash && data.current.ledgerHash === action.ledgerHash && data.current.configHash === action.configHash,
    'RUN_STATE_CHANGED', '预览后项目或检索记录改变，请重新确认。')
  invariant(!(await inspectRecovery(io, data.current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '请先恢复项目事务。')
  if (action.action !== 'retry') invariant(data.stored.run.status === 'paused' || !ownerAlive(data.stored.run.owner), 'RUN_OWNER_ALIVE', '原执行进程仍存活，未接管。')
  return { ...data, active }
}
export async function closeResearchBatch(io: FileStore, action: ResearchBatchAction, ownerAlive: (owner: RunState['owner']) => boolean) {
  invariant(action.action === 'close', 'INVALID_APPROVAL', '这不是结束检索计划。')
  return io.lock(async () => {
    const data = await validateAction(io, action, ownerAlive), state = { ...data.stored.run, status: 'cancelled' as const, errorCode: 'USER_CLOSED_CHECKPOINT', updatedAt: new Date().toISOString() }
    await commit(io, [{ path: `.scholarflow/runs/${action.runId}/control-history/${action.id}.json`, before: undefined,
      after: json({ action: 'close', previousState: data.stored.file.text, planHash: action.contentHash }) },
      { path: runFile(action.runId), before: data.stored.file, after: json(state) }, { path: ACTIVE_RUN, before: data.active, after: json(state) }])
    return { run: state, checkpoint: data.checkpoint, searches: data.plan.searches }
  })
}
export async function executeResearchBatch(io: FileStore, plan: ResearchBatchPlan, provider: ResearchProvider, signal: AbortSignal,
  owner: RunState['owner'], ownerAlive: (owner: RunState['owner']) => boolean,
  control: { pauseRequested: () => boolean; action?: ResearchBatchAction; executionSessionId?: string; automaticChild?: import('../../shared/workflow-automatic.ts').AutomaticChildGrant } = { pauseRequested: () => false }) {
  verifyPlan(plan)
  invariant(provider.id === 'crossref' && provider.capabilities.search, 'RESEARCH_PROVIDER_UNAVAILABLE', '所选提供方不能检索。')
  signal.throwIfAborted()
  let state: RunState = { schemaVersion: 1, runId: plan.snapshot.runId, projectId: plan.snapshot.projectId, sessionId: plan.snapshot.sessionId, stage: 'research',
    status: 'running', usedModelCalls: 0, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), owner, planHash: plan.contentHash,
    activeDurationMs: 0, ...(plan.parentRunId && { parentRunId: plan.parentRunId }) }
  let checkpoint: ResearchBatchCheckpoint = { schemaVersion: 1, runId: state.runId, projectId: state.projectId, planHash: plan.contentHash,
    queriesUsed: 0, candidatesReceived: 0, queries: plan.searches.map(row => ({ queryId: row.queryId, state: 'pending', attempts: [], transientRetries: 0 })) }
  let stateHash: string, checkpointHash: string, priorDuration = 0, executionStarted = Date.now()
  const save = async (mutations: Mutation[] = []) => io.lock(async () => {
    const current = await snapshot(io), previous = await io.read(runFile(state.runId)), active = await io.read(ACTIVE_RUN), progress = await io.read(checkpointFile(state.runId))
    invariant(current.ledger.projectId === state.projectId && previous && active?.text === previous.text && digest(previous.text) === stateHash,
      'RUN_STATE_CHANGED', '运行或项目身份已改变，未用旧内存覆盖。')
    invariant(progress && digest(progress.text) === checkpointHash, 'RUN_CHECKPOINT_CHANGED', '检索检查点被外部修改，原结果保留。')
    state.updatedAt = new Date().toISOString(); state.activeDurationMs = priorDuration + Math.max(0, Date.now() - executionStarted)
    const progressText = json(batchCheckpointSchema.parse(checkpoint)); state.checkpointHash = digest(progressText)
    const text = json(runStateSchema.parse(state))
    await commit(io, [...mutations, { path: checkpointFile(state.runId), before: progress, after: progressText },
      { path: runFile(state.runId), before: previous, after: text }, { path: ACTIVE_RUN, before: active, after: text }])
    stateHash = digest(text); checkpointHash = digest(progressText)
  })
  await io.lock(async () => {
    await ensureNoAutomaticExecuting(io, plan.snapshot.projectId, control.automaticChild)
    const current = await snapshot(io), active = await io.read(ACTIVE_RUN)
    invariant(!(await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先恢复项目事务，再开始检索。')
    if (control.action?.action === 'resume') {
      const data = await validateAction(io, control.action, ownerAlive)
      invariant(plan.contentHash === data.plan.contentHash, 'INVALID_APPROVAL', '恢复不是原冻结查询计划。')
      state = { ...data.stored.run, status: 'running', owner, executionSessionId: control.executionSessionId }; delete state.errorCode
      checkpoint = data.checkpoint; priorDuration = state.activeDurationMs ?? 0
      stateHash = digest(data.stored.file.text); checkpointHash = digest(data.checkpointFileImage.text)
      return
    }
    if (control.action) { invariant(control.action.action === 'retry' && plan.parentRunId === control.action.runId && plan.contentHash === control.action.retryPlanHash,
      'INVALID_APPROVAL', '重试计划没有关联原失败运行。'); await validateAction(io, control.action, ownerAlive) }
    invariant(current.configHash === plan.snapshot.configHash && current.ledgerHash === plan.ledgerHash, 'STALE_LEDGER_REVISION', '确认后项目输入改变，请重新预览。')
    if (active && !await isDetachedProjectPointer(io, ACTIVE_RUN, active)) {
      const previous = runStateSchema.parse(JSON.parse(active.text)), stored = await readRun(io, previous.runId, state.projectId)
      invariant(json(stored.run) === json(previous), 'RUN_STATE_CHANGED', '活动运行与事实源不同。')
      invariant(terminal(previous.status), ownerAlive(previous.owner) ? 'RUN_IN_PROGRESS' : 'RUN_INTERRUPTED', '项目已有未结束运行，请先明确恢复或结束。')
    }
    const cpText = json(checkpoint); state.checkpointHash = digest(cpText); const text = json(state)
    await commit(io, [{ path: inputFile(state.runId), before: undefined, after: json(plan.snapshot) }, { path: frozenPlanFile(state.runId), before: undefined, after: json(plan) },
      { path: checkpointFile(state.runId), before: undefined, after: cpText }, { path: runFile(state.runId), before: undefined, after: text }, { path: ACTIVE_RUN, before: active, after: text }])
    stateHash = digest(text); checkpointHash = digest(cpText)
  })
  const budgetSignal = signal
  const result = () => ({ run: state, checkpoint, searches: plan.searches, paused: state.status === 'paused', limitations: ['候选仅是出版元数据；纳入来源与全文证据确认仍需用户操作。'] })
  try {
    // An interrupted request is charged and archived. Only this explicitly
    // confirmed resume can send a fresh attempt; completed searches are reused.
    for (const query of checkpoint.queries.filter(row => row.state === 'running')) {
      const attempt = query.attempts.at(-1)!, search = await readSearch(io, attempt.searchId)
      const record: SearchRecord = { ...search.record, state: 'interrupted', completedAt: new Date().toISOString(), errorCode: 'RESEARCH_INTERRUPTED',
        warnings: ['进程中断，没有可验证的完整结果。原尝试计入查询预算，恢复将发起新的独立尝试。'] }
      attempt.state = 'interrupted'; attempt.errorCode = record.errorCode; attempt.outcomeHash = outcomeHash(record)
      query.state = query.attempts.length < 3 ? 'pending' : 'failed'
      await save([{ path: searchPath(attempt.searchId), before: search.file, after: json(record) }])
    }
    await save()
    while (checkpoint.queries.some(row => row.state === 'pending')) {
      budgetSignal.throwIfAborted()
      if (control.pauseRequested()) { state.status = 'paused'; await save(); await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0); return result() }
      const query = checkpoint.queries.find(row => row.state === 'pending')!, spec = plan.searches.find(row => row.queryId === query.queryId)!.search
      while (query.retryNotBefore && Date.now() < query.retryNotBefore) {
        budgetSignal.throwIfAborted()
        if (control.pauseRequested()) { state.status = 'paused'; await save(); await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0); return result() }
        await waitRetrySlice(Math.min(200, query.retryNotBefore - Date.now()), budgetSignal)
      }
      const boundary = await snapshot(io)
      invariant(boundary.configHash === plan.snapshot.configHash, 'STALE_PROJECT_CONFIG', '检索权限或预算配置改变，已停止调度。')
      await readResearchBatch(io, state.runId)
      delete query.retryNotBefore
      const searchId = newId('search')
      let record = searchRecordSchema.parse({ schemaVersion: 1, projectId: state.projectId, id: searchId, provider: 'crossref', search: spec,
        createdAt: new Date().toISOString(), state: 'running', queriesUsed: 1, records: [], warnings: [], decisions: {} })
      const attempt: ResearchBatchCheckpoint['queries'][number]['attempts'][number] = { searchId, state: 'running' }
      query.attempts.push(attempt); query.state = 'running'; checkpoint.queriesUsed++
      await save([{ path: searchPath(searchId), before: undefined, after: json(record) }])
      const searchFile = (await io.read(searchPath(searchId)))!
      let failure: unknown
      try {
        const response = await workflowCall(io, plan.snapshot.workflowId, { callId: searchId, runId: state.runId, stage: 'research', kind: 'search',
          candidateLimit: spec.limit, activeDurationMs: state.activeDurationMs ?? 0, owner, automaticChild: control.automaticChild }, AbortSignal.any([budgetSignal, AbortSignal.timeout(25000)]),
          signal => provider.search(spec, signal), result => Math.min(spec.limit, result.records.length)); budgetSignal.throwIfAborted()
        record = searchRecordSchema.parse({ ...record, state: 'completed', records: response.records.slice(0, spec.limit), warnings: response.warnings, completedAt: new Date().toISOString() })
      } catch (error) {
        failure = error
        const errorCode = budgetSignal.aborted ? signal.aborted ? 'RESEARCH_CANCELLED' : 'RESEARCH_BUDGET_EXHAUSTED' : error instanceof ScholarError ? error.code : 'RESEARCH_PROVIDER_FAILED'
        record = { ...record, state: signal.aborted ? signal.reason === 'plugin-unload' ? 'interrupted' : 'cancelled' : 'failed', completedAt: new Date().toISOString(), errorCode,
          warnings: ['此查询没有取得可纳入的完整结果；其他已保存成功查询保持不变。'] }
      }
      attempt.state = record.state as typeof attempt.state; attempt.errorCode = record.errorCode; attempt.outcomeHash = outcomeHash(record)
      query.state = record.state === 'completed' ? 'completed' : 'failed'; checkpoint.candidatesReceived += record.records.length
      const unknownRetryWindow = failure instanceof ScholarError && failure.details.retryWindowUnavailable === true
      const retry = !budgetSignal.aborted && failure && !unknownRetryWindow ? transientRetry(failure, query.transientRetries) : undefined
      if (retry && query.attempts.length < 3) { query.state = 'pending'; query.transientRetries = retry.retry; query.retryNotBefore = retry.notBefore }
      if ((unknownRetryWindow || record.state === 'interrupted') && query.attempts.length < 3) query.state = 'pending'
      await save([{ path: searchPath(searchId), before: searchFile, after: json(record) }])
      await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0)
      budgetSignal.throwIfAborted()
      if (record.errorCode?.startsWith('WORKFLOW_')) { state.status = 'failed'; state.errorCode = record.errorCode; await save(); return result() }
      if (unknownRetryWindow) { state.status = 'paused'; state.errorCode = 'RESEARCH_RETRY_WINDOW_UNAVAILABLE'; await save(); await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0); return result() }
    }
    state.status = checkpoint.queries.some(row => row.state === 'completed') ? 'completed-with-issues' : 'failed'
    if (state.status === 'failed') state.errorCode = 'RESEARCH_NO_SUCCESSFUL_QUERY'
    await save(); await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0); return result()
  } catch (error) {
    state.status = signal.aborted ? signal.reason === 'plugin-unload' ? 'interrupted' : 'cancelled' : 'failed'
    state.errorCode = signal.aborted ? signal.reason === 'plugin-unload' ? 'RESEARCH_INTERRUPTED' : 'RESEARCH_CANCELLED' : error instanceof ScholarError ? error.code : 'RESEARCH_EXECUTION_FAILED'
    await save(); await syncWorkflowDuration(io, plan.snapshot.workflowId, state.runId, state.activeDurationMs ?? 0); return result()
  }
}
