import { z } from 'zod'
import { id } from '../../shared/schema.ts'
import { runSnapshotSchema, runStateSchema } from '../../shared/runs.ts'
import { draftSequenceRequest, draftSequenceActionRequest, draftSequenceInputSchema, draftSequenceCheckpointSchema, draftSequencePlanSchema, draftSequenceRunSchema,
  type DraftSequenceInput, type DraftSequenceCheckpoint } from '../../shared/draft-sequence.ts'
import { json, digest, newId, type FileStore } from '../store/files.ts'
import { commit, inspectRecovery } from '../store/transactions.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'
import { reviewInput } from '../review/review.ts'
import { snapshot } from '../project/project.ts'
import { outlineOrder, sectionTarget } from '../editing/sections.ts'
import { applyEdits, proposalImage } from '../editing/proposals.ts'
import { prepareGeneration } from './generation.ts'
import { ACTIVE_RUN, readRun } from './run-store.ts'
import { readFrozenGeneration, readGenerationCheckpoint } from './run-control.ts'
import { workflowAssociation } from './workflow-budget.ts'
import { resolveStageSkills, type SkillReader } from '../skills/bindings.ts'
import { isDetachedProjectPointer } from '../project/identity.ts'

export const DRAFT_SEQUENCE_POINTER = '.scholarflow/drafting/current.json'
const pointerSchema = z.object({ schemaVersion: z.literal(1), sequenceId: id, projectId: id }).strict()
const prefix = (sequenceId: string) => {
  invariant(/^draft_[\w]+$/u.test(id.parse(sequenceId)), 'DRAFT_SEQUENCE_INVALID', '按节初稿身份无效。')
  return `.scholarflow/runs/${sequenceId}`
}
const terminal = (checkpoint: DraftSequenceCheckpoint) => ['cancelled', 'completed-with-issues'].includes(checkpoint.status)
// Match the existing generation executor's output default. Old immutable
// inputs remain untouched; only this absent field has a known default.
const sequenceModel = (model: DraftSequenceInput['model']) => ({ ...model, maxOutputTokens: model.maxOutputTokens ?? 16384 })
async function scope(io: FileStore, skillReader?: SkillReader) {
  const observed = await reviewInput(io), { current, materialHashes } = observed
  const contextHashes: Record<string, string> = {}
  for (const path of [current.config.writing.projectProfile, '.scholarflow/context/decisions.md', '.scholarflow/context/terminology.md',
    '.scholarflow/context/writing-memory.md', '.scholarflow/context/approvals.json', '.scholarflow/resources.lock.json']) {
    const file = await io.read(path); contextHashes[path] = file ? digest(file.text) : 'missing'
  }
  const skills = await resolveStageSkills(io, 'drafting', skillReader)
  const { requirements, materials, sources, evidence, claims, outline } = current.ledger
  return { current, skillDigests: skills.resources.map(resource => ({ qualifiedId: resource.qualifiedId, digest: resource.digest })),
    scopeHash: digest(json({ configHash: current.configHash, requirements, materials, sources, evidence, claims, outline,
    materialHashes, contextHashes, skills: skills.resources })) }
}
async function noStageRunning(io: FileStore, projectId: string) {
  const active = await io.read(ACTIVE_RUN)
  if (!active || await isDetachedProjectPointer(io, ACTIVE_RUN, active)) return
  const projected = runStateSchema.parse(JSON.parse(active.text)), stored = await readRun(io, projected.runId, projectId)
  invariant(json(stored.run) === json(projected), 'RUN_STATE_CHANGED', '活动阶段投影与事实源不一致，未继续按节调度。')
  invariant(['failed', 'cancelled', 'succeeded', 'completed-with-issues'].includes(stored.run.status),
    'RUN_IN_PROGRESS', '先暂停并处理或恢复未结束的章节运行，再操作初稿顺序。')
}
export async function readDraftSequence(io: FileStore, sequenceId: string) {
  const location = prefix(sequenceId), [inputFile, checkpointFile, planFile] = await Promise.all(['input.json', 'checkpoint.json', 'plan.json'].map(path => io.read(`${location}/${path}`)))
  invariant(inputFile && checkpointFile && planFile, 'DRAFT_SEQUENCE_INVALID', '按节初稿记录缺失；没有重建或重放。')
  const input = draftSequenceInputSchema.parse(JSON.parse(inputFile.text)), checkpoint = draftSequenceCheckpointSchema.parse(JSON.parse(checkpointFile.text))
  const current = await snapshot(io)
  const record = await io.read(`${location}/run.json`)
  invariant(record, 'DRAFT_SEQUENCE_INVALID', '初稿运行事实源缺失。')
  const run = draftSequenceRunSchema.parse(JSON.parse(record.text)), { contentHash, ...savedPlan } = draftSequencePlanSchema.parse(JSON.parse(planFile.text))
  invariant(input.sequenceId === sequenceId && checkpoint.sequenceId === sequenceId &&
    input.projectId === current.ledger.projectId && checkpoint.projectId === input.projectId && checkpoint.inputHash === digest(inputFile.text) &&
    savedPlan.sequenceId === sequenceId && savedPlan.projectId === input.projectId && savedPlan.inputHash === checkpoint.inputHash &&
    contentHash === digest(json(savedPlan)) && contentHash === checkpoint.planHash && run.planHash === contentHash &&
    json(savedPlan.sectionIds) === json(input.sections.map(row => row.sectionId)) &&
    run.checkpointHash === digest(checkpointFile.text) && run.inputHash === checkpoint.inputHash &&
    run.sequenceId === sequenceId && run.projectId === input.projectId && run.status === checkpoint.status &&
    json(input.sections.map(row => row.sectionId)) === json(checkpoint.steps.map(row => row.sectionId)) &&
    new Set(input.sections.map(row => row.sectionId)).size === input.sections.length,
    'DRAFT_SEQUENCE_INVALID', '按节初稿身份、输入或检查点校验失败；保留原记录。')
  return { current, input, checkpoint, inputFile, checkpointFile, record }
}
// Read-only observation: accepting a child never silently edits the parent
// checkpoint. The next confirmed action adopts its proven revision once.
async function acceptedChild(io: FileStore, stored: Awaited<ReturnType<typeof readDraftSequence>>) {
  const checkpoint = structuredClone(stored.checkpoint), step = checkpoint.steps.find(row => row.state === 'dispatched')
  if (!step) return { checkpoint, pendingProposalIds: [] as string[], diagnostics: [] as string[] }
  const childFile = await io.read(`.scholarflow/runs/${step.childRunId}/run.json`)
  if (!childFile) return { checkpoint, pendingProposalIds: [], diagnostics: ['章节已登记但执行记录尚未出现；可以取消本初稿顺序，原登记保留，不能猜测重放。'] }
  const run = await readRun(io, step.childRunId!, stored.input.projectId), frozen = await readFrozenGeneration(io, step.childRunId!, stored.input.projectId)
  invariant(run.run.planHash === step.childPlanHash && frozen.plan.contentHash === step.childPlanHash &&
    frozen.plan.input.sectionId === step.sectionId && frozen.plan.snapshot.documentHash === checkpoint.expectedDocumentHash &&
    frozen.plan.snapshot.workflowId === stored.input.workflowId && frozen.plan.snapshot.draftSequenceId === stored.input.sequenceId &&
    json(frozen.plan.snapshot.modelDescriptor) === json(sequenceModel(stored.input.model)), 'DRAFT_SEQUENCE_INVALID', '章节运行与确认顺序不一致，未采用其进度。')
  const pendingProposalIds: string[] = [], accepted: Awaited<ReturnType<typeof proposalImage>>[] = []
  const states = Object.values(stored.current.ledger.proposalStates)
  invariant(states.length <= 1000, 'DRAFT_SEQUENCE_HISTORY_LIMIT', '建议历史超过读取限额，未猜测章节进度。')
  for (const state of states) {
    if (!['pending', 'accepted'].includes(state.state)) continue
    const image = await proposalImage(io, state.proposalId)
    if (image.proposal.runId !== step.childRunId) continue
    invariant(image.proposal.projectId === stored.input.projectId && image.proposal.section?.sectionId === step.sectionId &&
      image.proposal.baseDocumentHash === checkpoint.expectedDocumentHash && image.proposal.baseRevisionId === checkpoint.expectedRevisionId,
      'DRAFT_SEQUENCE_INVALID', '章节建议范围或基础版本与确认顺序不一致。')
    if (state.state === 'pending') pendingProposalIds.push(state.proposalId)
    else accepted.push(image)
  }
  invariant(accepted.length <= 1, 'DRAFT_SEQUENCE_INVALID', '同一章节有多个接受记录，不能猜测实际进展。')
  if (!accepted.length) return { checkpoint, pendingProposalIds, childRun: run.run, diagnostics: [] }
  const image = accepted[0], proposal = image.proposal, state = stored.current.ledger.proposalStates[proposal.id]
  // Operator-edited descendants must retain an intact immutable ancestry.
  let ancestor = image, depth = 0
  while (ancestor.proposal.derivedFrom) {
    invariant(++depth <= 20, 'DRAFT_SEQUENCE_INVALID', '候选编辑链超出限额。')
    const parent = await proposalImage(io, ancestor.proposal.derivedFrom.proposalId)
    invariant(parent.contentHash === ancestor.proposal.derivedFrom.proposalHash && parent.proposal.runId === step.childRunId &&
      parent.proposal.section?.sectionId === step.sectionId && parent.proposal.baseDocumentHash === checkpoint.expectedDocumentHash,
      'DRAFT_SEQUENCE_INVALID', '候选编辑来源链改变，未采用其章节进度。')
    ancestor = parent
  }
  invariant(ancestor.proposal.id === run.run.proposalId, 'DRAFT_SEQUENCE_INVALID', '接受候选不是该运行产生的原建议或编辑后代。')
  const progress = await readGenerationCheckpoint(io, run.run)
  invariant(progress.checkpoint.proposal && json(progress.checkpoint.proposal) === json(ancestor.proposal),
    'DRAFT_SEQUENCE_INVALID', '章节原建议与执行检查点不一致，未采用编辑链进度。')
  invariant(state.acceptedRevisionId && stored.current.document.revisionId === state.acceptedRevisionId && !stored.current.document.externalChange,
    'DRAFT_SEQUENCE_DOCUMENT_CHANGED', '接受后的正文又有变更；原人工内容保留，请取消旧顺序并重新预览剩余章节。')
  const location = `.scholarflow/drafts/${state.acceptedRevisionId}`
  const [manifest, before, after, references] = await Promise.all([io.read(`${location}/manifest.json`), io.read(`${location}/preimage.md`),
    io.read(`${location}/paper.md`), io.read(stored.current.config.paths.references)])
  invariant(manifest && before && after && references, 'DRAFT_SEQUENCE_INVALID', '接受章节的原稿、结果或清单快照缺失。')
  const facts = JSON.parse(manifest.text)
  invariant(facts.origin === proposal.id && facts.revisionId === state.acceptedRevisionId && facts.parentRevisionId === checkpoint.expectedRevisionId &&
    facts.baseDocumentHash === checkpoint.expectedDocumentHash && digest(before.text) === checkpoint.expectedDocumentHash &&
    applyEdits(before.text, proposal.edits) === after.text && facts.contentHash === digest(after.text) &&
    after.text === stored.current.document.text && facts.referencesHash === digest(references.text),
    'DRAFT_SEQUENCE_INVALID', '接受章节的字节、来源或版本链无法校验；未据此继续。')
  step.state = 'accepted'; step.proposalId = proposal.id; step.acceptedRevisionId = state.acceptedRevisionId
  step.acceptedDocumentHash = digest(after.text); step.gaps = proposal.section!.limitations
  checkpoint.expectedDocumentHash = digest(after.text); checkpoint.expectedRevisionId = state.acceptedRevisionId
  return { checkpoint, pendingProposalIds: [], childRun: run.run, diagnostics: [] }
}
export async function inspectDraftSequence(io: FileStore) {
  const file = await io.read(DRAFT_SEQUENCE_POINTER)
  if (!file || await isDetachedProjectPointer(io, DRAFT_SEQUENCE_POINTER, file)) return { sequence: undefined }
  const pointer = pointerSchema.parse(JSON.parse(file.text)), stored = await readDraftSequence(io, pointer.sequenceId)
  invariant(pointer.projectId === stored.input.projectId, 'PROJECT_ID_CONFLICT', '初稿顺序不属于当前项目。')
  let observation: Awaited<ReturnType<typeof acceptedChild>> | undefined, diagnostic: string | undefined
  try { observation = await acceptedChild(io, stored) } catch (error) { diagnostic = error instanceof ScholarError ? error.message : '章节进度记录无法校验；保留原记录。' }
  return { sequence: { input: stored.input, checkpoint: observation?.checkpoint ?? stored.checkpoint,
    pendingProposalIds: observation?.pendingProposalIds ?? [], childRun: observation?.childRun,
    diagnostics: [...(observation?.diagnostics ?? []), ...(diagnostic ? [diagnostic] : [])] } }
}
export async function prepareDraftSequence(io: FileStore, request: z.infer<typeof draftSequenceRequest>, model: DraftSequenceInput['model'], skillReader?: SkillReader) {
  request = draftSequenceRequest.parse(request)
  const observed = await scope(io, skillReader), { current } = observed, pointer = await io.read(DRAFT_SEQUENCE_POINTER)
  invariant(current.ledger.projectId === request.context.projectId && current.ledger.revision === request.context.expectedLedgerRevision,
    'STALE_LEDGER_REVISION', '先重新读取当前项目再预览初稿顺序。')
  invariant(!current.document.externalChange && current.ledger.outline.confirmation === 'confirmed', 'OUTLINE_CONFIRMATION_REQUIRED', '先确认大纲和实际保存正文。')
  if (pointer && !await isDetachedProjectPointer(io, DRAFT_SEQUENCE_POINTER, pointer)) invariant(terminal((await readDraftSequence(io, pointerSchema.parse(JSON.parse(pointer.text)).sequenceId)).checkpoint),
    'DRAFT_SEQUENCE_IN_PROGRESS', '先恢复或明确取消已有初稿顺序。')
  const ordered = outlineOrder(current.ledger.outline), summaries = new Set(request.summarySectionIds)
  invariant(summaries.size === request.summarySectionIds.length && request.summarySectionIds.every(value => ordered.some(row => row.id === value)) &&
    ordered.some(row => !summaries.has(row.id)), 'DRAFT_SEQUENCE_ORDER_INVALID', '摘要／结论必须明确选择当前大纲章节，并至少保留一节前序正文。')
  // Moving a summary parent after one of its children makes a missing heading
  // impossible to create safely. Require a complete summary subtree instead.
  for (const row of ordered) if (row.parentId && summaries.has(row.parentId)) invariant(summaries.has(row.id),
    'DRAFT_SEQUENCE_ORDER_INVALID', '推迟父章节时必须同时推迟其子章节，不能越过未保存父标题。')
  const sections = [...ordered.filter(row => !summaries.has(row.id)), ...ordered.filter(row => summaries.has(row.id))].map(row => {
    let preserve = false
    try { const target = sectionTarget(current.document.text, current.ledger.outline, row.id)
      preserve = target.mode === 'replace-body' && !!current.document.text.slice(target.startUtf16, target.endUtf16).trim()
    } catch (error) { if (!(error instanceof ScholarError) || error.code !== 'SECTION_PARENT_REQUIRED') throw error }
    return { sectionId: row.id, title: row.title, summary: summaries.has(row.id), preserve }
  })
  const workflowId = await workflowAssociation(io)
  invariant(workflowId, 'DRAFT_SEQUENCE_WORKFLOW_REQUIRED', '先在概览确认引导目标和累计预算，再开始多节初稿。')
  const input = draftSequenceInputSchema.parse({ schemaVersion: 1, sequenceId: newId('draft'), projectId: current.ledger.projectId,
    sessionId: request.context.sessionId, instruction: request.instruction, scopeHash: observed.scopeHash, model: sequenceModel(model), workflowId,
    initialDocumentHash: current.document.contentHash, initialRevisionId: current.document.revisionId, createdAt: new Date().toISOString(), sections, skillDigests: observed.skillDigests })
  const body = { id: newId('draft_plan'), action: 'start' as const, input, ledgerHash: current.ledgerHash, pointerHash: pointer ? digest(pointer.text) : null }
  return { ...body, contentHash: digest(json(body)) }
}
export type DraftSequenceStartPlan = Awaited<ReturnType<typeof prepareDraftSequence>>
function mutations(stored: Awaited<ReturnType<typeof readDraftSequence>>, checkpoint: DraftSequenceCheckpoint) {
  const parsed = draftSequenceCheckpointSchema.parse(checkpoint), text = json(parsed), location = prefix(parsed.sequenceId)
  return [{ path: `${location}/checkpoint.json`, before: stored.checkpointFile, after: text },
    { path: `${location}/run.json`, before: stored.record, after: json({ schemaVersion: 1, sequenceId: parsed.sequenceId, projectId: parsed.projectId,
      inputHash: parsed.inputHash, planHash: parsed.planHash, checkpointHash: digest(text), status: parsed.status, updatedAt: parsed.updatedAt }) }]
}
export async function startDraftSequence(io: FileStore, plan: DraftSequenceStartPlan, skillReader?: SkillReader) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', '初稿顺序预览已改变。')
  return io.lock(async () => {
    const observed = await scope(io, skillReader), pointer = await io.read(DRAFT_SEQUENCE_POINTER), current = observed.current
    invariant(observed.scopeHash === plan.input.scopeHash && current.document.contentHash === plan.input.initialDocumentHash &&
      current.document.revisionId === plan.input.initialRevisionId && current.ledgerHash === plan.ledgerHash &&
      (pointer ? digest(pointer.text) : null) === plan.pointerHash && await workflowAssociation(io) === plan.input.workflowId,
      'DRAFT_SEQUENCE_INPUT_CHANGED', '确认期间初稿输入、稿件、目标或顺序改变。')
    invariant(!(await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先恢复未完成事务。')
    await noStageRunning(io, plan.input.projectId)
    const inputText = json(plan.input), savedPlanBody = { schemaVersion: 1 as const, sequenceId: plan.input.sequenceId, projectId: plan.input.projectId,
      inputHash: digest(inputText), sectionIds: plan.input.sections.map(row => row.sectionId) }
    const savedPlan = draftSequencePlanSchema.parse({ ...savedPlanBody, contentHash: digest(json(savedPlanBody)) })
    const checkpoint = draftSequenceCheckpointSchema.parse({ schemaVersion: 1, sequenceId: plan.input.sequenceId,
      projectId: plan.input.projectId, inputHash: digest(inputText), planHash: savedPlan.contentHash, revision: 0, status: 'waiting-input',
      expectedDocumentHash: current.document.contentHash, expectedRevisionId: current.document.revisionId, updatedAt: new Date().toISOString(),
      steps: plan.input.sections.map(row => ({ sectionId: row.sectionId, state: row.preserve ? 'preserved' : 'pending', gaps: [] })) })
    const location = prefix(plan.input.sequenceId), checkpointText = json(checkpoint)
    await commit(io, [{ path: `${location}/input.json`, before: undefined, after: inputText },
      { path: `${location}/plan.json`, before: undefined, after: json(savedPlan) },
      { path: `${location}/checkpoint.json`, before: undefined, after: checkpointText },
      { path: `${location}/run.json`, before: undefined, after: json({ schemaVersion: 1, sequenceId: plan.input.sequenceId, projectId: plan.input.projectId,
        inputHash: checkpoint.inputHash, planHash: checkpoint.planHash, checkpointHash: digest(checkpointText), status: checkpoint.status, updatedAt: checkpoint.updatedAt }) },
      { path: DRAFT_SEQUENCE_POINTER, before: pointer, after: json({ schemaVersion: 1, sequenceId: plan.input.sequenceId, projectId: plan.input.projectId }) }])
    return { sequenceId: plan.input.sequenceId }
  })
}
export async function prepareDraftSequenceAction(io: FileStore, request: z.infer<typeof draftSequenceActionRequest>, skillReader?: SkillReader) {
  request = draftSequenceActionRequest.parse(request)
  const stored = await readDraftSequence(io, request.sequenceId), pointer = await io.read(DRAFT_SEQUENCE_POINTER)
  invariant(pointer && pointerSchema.parse(JSON.parse(pointer.text)).sequenceId === request.sequenceId && !terminal(stored.checkpoint),
    'DRAFT_SEQUENCE_TERMINAL', '仅可操作当前未结束初稿顺序；旧记录保持只读。')
  invariant(request.context.projectId === stored.input.projectId && request.context.expectedLedgerRevision === stored.current.ledger.revision,
    'STALE_LEDGER_REVISION', '请重新读取当前项目。')
  let next = structuredClone(stored.checkpoint), generation
  if (request.action === 'cancel') invariant(request.reason.length >= 10, 'DRAFT_SEQUENCE_REASON_REQUIRED', '取消须说明理由，正文和所有候选保留。')
  else if (request.action === 'pause') invariant(next.status === 'waiting-input', 'DRAFT_SEQUENCE_PAUSED', '当前顺序已经暂停。')
  else {
    invariant(next.status === (request.action === 'resume' ? 'paused' : 'waiting-input'), 'DRAFT_SEQUENCE_PAUSED', '先明确恢复暂停的初稿顺序。')
    const observed = await scope(io, skillReader)
    invariant(observed.scopeHash === stored.input.scopeHash && await workflowAssociation(io) === stored.input.workflowId,
      'DRAFT_SEQUENCE_INPUT_CHANGED', '资料、大纲、要求、文风、记忆、Skill 或引导目标改变；旧顺序不扩大授权，请重新建立顺序。')
    const accepted = await acceptedChild(io, stored); next = accepted.checkpoint
    invariant(next.expectedDocumentHash === stored.current.document.contentHash && next.expectedRevisionId === stored.current.document.revisionId && !stored.current.document.externalChange,
      'DRAFT_SEQUENCE_DOCUMENT_CHANGED', '正文含未由本顺序接受的修改；保留人工稿，请重新确认剩余范围。')
    if (request.action === 'next') {
      invariant(!next.steps.some(row => row.state === 'dispatched'), 'DRAFT_SEQUENCE_AWAITING_ACCEPTANCE', '本节尚未接受；可查看建议、从运行历史恢复，或取消顺序后重新规划。拒绝不会自动付费重试。')
      const pending = next.steps.find(row => row.state === 'pending')
      if (pending) {
        generation = await prepareGeneration(io, { context: request.context, sectionId: pending.sectionId,
          instruction: stored.input.instruction + (stored.input.sections.find(row => row.sectionId === pending.sectionId)!.summary
            ? '\n这是用户明确选择的摘要／结论阶段：仅依据 context.manuscript.actualSavedManuscriptForConsistency 中实际已保存的正文总结，待补实验与结果不得写成已完成。' : '') },
          stored.input.model, skillReader, { allowStructuralGap: true })
        invariant(generation.snapshot.workflowId === stored.input.workflowId, 'DRAFT_SEQUENCE_INPUT_CHANGED', '累计目标改变，未开始本节。')
        const { contentHash: _hash, ...generationBody } = generation
        generationBody.snapshot = runSnapshotSchema.parse({ ...generationBody.snapshot, draftSequenceId: request.sequenceId })
        generation = { ...generationBody, contentHash: digest(json(generationBody)) }
        pending.state = 'dispatched'; pending.childRunId = generation.snapshot.runId; pending.childPlanHash = generation.contentHash
      } else next.status = 'completed-with-issues'
    }
  }
  if (request.action === 'pause') next.status = 'paused'
  if (request.action === 'resume') next.status = 'waiting-input'
  if (request.action === 'cancel') next.status = 'cancelled'
  next.revision++; next.updatedAt = new Date().toISOString()
  const body = { id: newId('draft_action'), action: request.action, sequenceId: request.sequenceId, sessionId: request.context.sessionId,
    projectId: stored.input.projectId, reason: request.reason, checkpointHash: digest(stored.checkpointFile.text), pointerHash: digest(pointer.text),
    ledgerHash: stored.current.ledgerHash, documentHash: stored.current.document.contentHash, next, ...(generation && { generation }) }
  return { ...body, contentHash: digest(json(body)) }
}
export type DraftSequenceActionPlan = Awaited<ReturnType<typeof prepareDraftSequenceAction>>
export async function applyDraftSequenceAction(io: FileStore, plan: DraftSequenceActionPlan, skillReader?: SkillReader) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', '初稿操作预览改变。')
  return io.lock(async () => {
    const stored = await readDraftSequence(io, plan.sequenceId), pointer = await io.read(DRAFT_SEQUENCE_POINTER)
    invariant(stored.input.projectId === plan.projectId && !terminal(stored.checkpoint) && pointer && digest(pointer.text) === plan.pointerHash &&
      digest(stored.checkpointFile.text) === plan.checkpointHash && stored.current.ledgerHash === plan.ledgerHash &&
      stored.current.document.contentHash === plan.documentHash, 'DRAFT_SEQUENCE_INPUT_CHANGED', '确认期间顺序、正文或项目数据改变。')
    if (plan.action === 'next' || plan.action === 'resume') invariant((await scope(io, skillReader)).scopeHash === stored.input.scopeHash &&
      await workflowAssociation(io) === stored.input.workflowId, 'DRAFT_SEQUENCE_INPUT_CHANGED', '确认期间真实资料或阶段资源改变。')
    await noStageRunning(io, plan.projectId)
    invariant(!(await inspectRecovery(io, stored.current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先恢复未完成事务。')
    await commit(io, [...mutations(stored, plan.next), { path: `${prefix(plan.sequenceId)}/decisions/${plan.id}.json`, before: undefined,
      after: json({ schemaVersion: 1, action: plan.action, projectId: plan.projectId, sequenceId: plan.sequenceId,
        sessionId: plan.sessionId, approvedPlanHash: plan.contentHash, previousCheckpointHash: plan.checkpointHash,
        nextCheckpointHash: digest(json(plan.next)), reason: plan.reason, childRunId: plan.generation?.snapshot.runId, decidedAt: plan.next.updatedAt }) }])
    return { sequenceId: plan.sequenceId, status: plan.next.status, childRunId: plan.generation?.snapshot.runId }
  })
}
