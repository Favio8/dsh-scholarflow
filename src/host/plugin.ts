import Schema from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { applicationResult, inspectProject, inspectRequest, prepareInitRequest, initializeRequest, resolveStore, type StoredInitPlan } from './bridge/project-api.ts'
import { prepareInit, initialize, snapshot, updateProjectText, updatePresentation } from '../core/project/project.ts'
import { exportPreflightRequest, projectPresentationRequest } from '../shared/presentation.ts'
import { verifiedMemoryProjection, memoryHistory } from '../core/project/memory-entries.ts'
import { prepareProjectCopy, applyProjectCopy, copyPlanTransition, pendingCopyTransition, verifiedIdentityLineage, type ProjectCopyPlan } from '../core/project/identity.ts'
import { recover } from '../core/store/transactions.ts'
import { newId, digest, json } from '../core/store/files.ts'
import { invariant } from '../shared/errors.ts'
import { scanRequest, registerMaterialRequest, parseMaterialRequest, readMaterialRequest } from '../shared/materials.ts'
import { registerSourceRequest, confirmEvidenceRequest, upsertClaimRequest, confirmOutlineRequest } from '../shared/research.ts'
import { scanMaterials, registerMaterial, readParsed } from '../core/materials/materials.ts'
import { parseRegisteredMaterial } from '../core/materials/parse.ts'
import { parseMaterialBytes } from './parsers/parse.ts'
import { registerSource, confirmEvidence, upsertClaim, confirmOutline, saveOutline } from '../core/evidence/evidence.ts'
import type { RequestContext } from '../shared/schema.ts'
import { saveDocumentRequest, proposalRequest, applyProposalRequest, undoDocumentRequest, proposalRevisionRequest } from '../shared/document-api.ts'
import { prepareProposalRevision, publishProposalRevision, type ProposalRevisionPlan } from '../core/editing/proposal-revision.ts'
import { saveManual, rejectProposal, undoRevision, proposalImage } from '../core/editing/proposals.ts'
import { inspectManuscriptSource, prepareManuscriptAdoption, applyManuscriptAdoption, type ManuscriptAdoptionPlan } from '../core/editing/manuscript-adoption.ts'
import { wordStats } from '../core/editing/markdown.ts'
import { generationRequest, runStartRequest, runControlRequest, runStateSchema } from '../shared/runs.ts'
import { prepareGeneration, executeGeneration, type GenerationPlan } from '../core/pipeline/generation.ts'
import { draftSequenceRequest, draftSequenceActionRequest } from '../shared/draft-sequence.ts'
import { inspectDraftSequence, readDraftSequence, prepareDraftSequence, startDraftSequence, prepareDraftSequenceAction, applyDraftSequenceAction,
  type DraftSequenceStartPlan, type DraftSequenceActionPlan } from '../core/pipeline/draft-sequence.ts'
import { workflowPrepareRequest, workflowActionRequest } from '../shared/workflow.ts'
import { currentWorkflow, prepareWorkflow, startWorkflow, prepareWorkflowAction, applyWorkflowAction, type WorkflowStartPlan, type WorkflowActionPlan } from '../core/pipeline/workflow.ts'
import { workflowBudgetInfo } from '../core/pipeline/workflow-budget.ts'
import { automaticPrepareRequest, automaticActionRequest } from '../shared/workflow-automatic.ts'
import { prepareAutomatic, startAutomatic, driveAutomatic, readAutomatic, inspectAutomatic, prepareAutomaticAction, applyAutomaticAction,
  type AutomaticPlan, type AutomaticActionPlan, type AutomaticWork } from '../core/pipeline/workflow-automatic.ts'
import { selectedModel, callStageModel } from './executor/model.ts'
import { runReview, inspectReview, decideIssue } from '../core/review/review.ts'
import { prepareDelivery, createDelivery, readDelivery, type DeliveryPlan } from '../core/export/delivery.ts'
import { issueDecisionRequest, exportCreateRequest } from '../shared/review.ts'
import { requirementUpsertRequest, requirementExtractRequest, requirementConfirmRequest, requirementResolveRequest, requirementRemoveRequest, projectTextReadRequest, projectTextSaveRequest } from '../shared/requirements.ts'
import { upsertRequirement, extractRequirements, confirmRequirement, resolveRequirementConflict, removeRequirement, requirementHistory } from '../core/requirements/requirements.ts'
import { bufferWriteRequest } from '../shared/editor-buffer.ts'
import { projectTextBufferReadRequest, projectTextBufferWriteRequest } from '../shared/project-text-buffer.ts'
import { readProjectTextBuffer, writeProjectTextBuffer } from '../core/editing/project-text-buffer.ts'
import { readEditorBuffer, writeEditorBuffer } from '../core/editing/buffer.ts'
import { selectionContext } from '../core/editing/selection-context.ts'
import { selectionContextRequest } from '../shared/editing.ts'
import { searchPrepareRequest, onlineConfirmRequest, candidateDecisionRequest, lookupPrepareRequest, type ResearchProvider } from '../shared/online-research.ts'
import { crossrefProvider } from './providers/crossref.ts'
import { prepareSearch, executeSearch, listSearches, readSearch, decideCandidate, prepareLookup, executeLookup, type SearchPlan, type LookupPlan } from '../core/research/online.ts'
import { PrivateSkillLibrary } from './skills/library.ts'
import { LocalSkillSource } from './skills/local.ts'
import { skillOptions, type SkillBundle } from '../shared/skills.ts'
import { hash, relativePath } from '../shared/schema.ts'
import { githubLocation, githubSkills, type GithubDiscovery, type GithubSkillPreview } from './skills/github.ts'
import { prepareBindings, applyBindings, readBindings, currentSkillStage, selectSkillStage, type BindingPlan } from '../core/skills/bindings.ts'
import { readPrivateSkill, libraryEntry, builtinSkills } from './skills/reader.ts'
import { stage } from '../shared/schema.ts'
import type { ResourceBinding } from '../shared/skills.ts'
import { knownSkillReferences } from './skills/references.ts'
import { anchorUpsertRequest } from '../shared/editing.ts'
import { upsertAnchor } from '../core/editing/anchors.ts'
import { listProjectSkills, projectSkillEntry } from '../core/skills/project-resources.ts'
import { prepareProjectSkillCopy, applyProjectSkillCopy, type ProjectSkillCopyPlan } from '../core/skills/project-copy.ts'
import type { FileStore } from '../core/store/files.ts'
import { WritingController } from './bridge/writing-controller.ts'
import { readRun, inspectRuns, prepareRunMigration, migrateRun } from '../core/pipeline/run-store.ts'
import { prepareRunAction, validateRunAction, closeRun, readGenerationCheckpoint, type RunActionPlan } from '../core/pipeline/run-control.ts'
import { newProjectDefaultsSchema, resolveInitDefaults } from '../shared/project-defaults.ts'
import { profileImportRequest, profileReadRequest, profileCopyRequest, profileConfirmRequest, profileCopyConfirmRequest, writingProfileSchema, type WritingProfile } from '../shared/profiles.ts'
import { presetSelectionRequest, presetSaveRequest, presetUpdateRequest, presetCopyRequest, presetRenameRequest, presetRemoveRequest } from '../shared/presets.ts'
import { builtinProfiles, profileDigest, verifyProfile, profileText, prepareProfileCopy, applyProfileCopy, projectProfile, type ProfileCopyPlan } from '../core/project/profiles.ts'
import { PrivateProfileLibrary } from './profiles/library.ts'
import { PresetLibrary } from './presets/library.ts'
import { prepareManualReview, submitManualReview, type ManualReviewPlan } from '../core/review/manual.ts'
import { prepareModelReview, type ModelReviewPlan } from '../core/review/model.ts'
import { executeModelReview, readModelReviewCheckpoint, prepareModelReviewAction, linkModelReviewRetry, type ModelReviewAction } from '../core/review/model-run.ts'
import { modelReviewRequest } from '../shared/review.ts'
import { locateIssue, issueFixSelection } from '../core/review/issue-fixes.ts'
import { acceptAndRecheck } from '../core/review/fix-workflow.ts'
import { id } from '../shared/schema.ts'
import { prepareSourceRegistration, confirmSourceRegistration, type SourceRegistrationPlan } from '../core/research/source-registration.ts'
import { batchPrepareRequest, batchActionRequest, type ResearchBatchPlan } from '../shared/research-batch.ts'
import { prepareResearchBatch, executeResearchBatch, readResearchBatch, prepareResearchBatchAction, closeResearchBatch, type ResearchBatchAction } from '../core/research/batch.ts'

// Runtime-owned Cordis objects stay inside this adapter. Core never imports them.
type Host = any
export const name = 'scholarflow'
// `attachments` is required, not optional: the image channel admits every upload through it,
// and a service that is used but not declared throws the moment it is touched — which is how
// image recognition failed while every unit test, with a stand-in host, passed.
export const inject = ['fs', 'sandboxPolicy', 'workspaceRegistry', 'sessionController', 'sessions', 'settings', 'connection', 'tools', 'skills', 'systemPrompt', 'agentPresets', 'llm', 'agentDefaultModel', 'sessionProjections', 'web', 'attachments']
export const Config = Schema.object({
  defaultProjectType: Schema.union(['course-paper', 'literature-review', 'research-paper']).default('course-paper').volatile(),
  language: Schema.union(['zh', 'en']).default('zh').volatile(),
  networkEnabled: Schema.boolean().default(false).volatile(),
  maxModelCalls: Schema.number().min(1).max(40).step(1).default(40).volatile(),
})
const sessionRequest = z.object({ sessionId: z.string().min(1).max(200) }).strict()
const skillVersionSelection = z.object({ qualifiedId: z.string().min(1).max(1000), digest: hash, scope: z.enum(['library', 'builtin', 'project']) }).strict()
const mutationRevision = (context: RequestContext) => {
  invariant(context.projectId && context.expectedLedgerRevision !== undefined, 'INVALID_REQUEST', '项目变更需要项目身份和预期 ledger 版本。')
  return context.expectedLedgerRevision
}

export class ScholarFlowRemote extends TypertRemoteService {
  private writingController: WritingController
  private initPlans = new Map<string, StoredInitPlan>()
  private workflowPlans = new Map<string, { plan: WorkflowStartPlan | WorkflowActionPlan; action: boolean; context: RequestContext; peerId: string; expires: number }>()
  private automaticPlans = new Map<string, { plan: AutomaticPlan | AutomaticActionPlan; action: boolean; context: RequestContext; peerId: string; expires: number }>()
  private recoveryPlans = new Map<string, { context: StoredInitPlan['context']; peerId: string; hash: string; expires: number }>()
  private generationPlans = new Map<string, { plan: GenerationPlan; peerId: string; expires: number; selected: { provider: string; model: string; reasoningEffort?: string }; sequence?: DraftSequenceActionPlan }>()
  private draftSequencePlans = new Map<string, { plan: DraftSequenceStartPlan | DraftSequenceActionPlan; context: RequestContext; peerId: string; expires: number }>()
  private running = new Map<string, { controller: AbortController; context: RequestContext; pauseRequested: boolean }>()
  private runActionPlans = new Map<string, { plan: RunActionPlan; generation?: GenerationPlan; selected?: { provider: string; model: string; reasoningEffort?: string }; context: RequestContext; peerId: string; expires: number }>()
  private exportPlans = new Map<string, { plan: DeliveryPlan; context: RequestContext; peerId: string; expires: number }>()
  private manuscriptPlans = new Map<string, { plan: ManuscriptAdoptionPlan; context: RequestContext; peerId: string; expires: number }>()
  private identityPlans = new Map<string, { plan: ProjectCopyPlan; context: RequestContext; peerId: string; expires: number }>()
  private bootInstance = randomUUID()
  private researchProvider: ResearchProvider
  private searchPlans = new Map<string, { plan: SearchPlan; context: RequestContext; peerId: string; expires: number }>()
  private lookupPlans = new Map<string, { plan: LookupPlan; context: RequestContext; peerId: string; expires: number }>()
  private skillLibrary = new PrivateSkillLibrary()
  private profileLibrary = new PrivateProfileLibrary()
  private presetLibrary = new PresetLibrary()
  private profilePlans = new Map<string, { profile: WritingProfile; hash: string; peerId: string; expires: number }>()
  private profileCopyPlans = new Map<string, { plan: ProfileCopyPlan; context: RequestContext; peerId: string; expires: number }>()
  private manualReviewPlans = new Map<string, { plan: ManualReviewPlan; context: RequestContext; peerId: string; expires: number }>()
  private modelReviewPlans = new Map<string, { plan: ModelReviewPlan; peerId: string; expires: number; selected: { provider: string; model: string; reasoningEffort?: string } }>()
  private modelReviewActions = new Map<string, { action: ModelReviewAction; plan: ModelReviewPlan; context: RequestContext; peerId: string; expires: number; selected?: { provider: string; model: string; reasoningEffort?: string } }>()
  private proposalRevisionPlans = new Map<string, { plan: ProposalRevisionPlan; peerId: string; expires: number }>()
  private sourceRegistrationPlans = new Map<string, { plan: SourceRegistrationPlan; peerId: string; expires: number }>()
  private researchBatchPlans = new Map<string, { plan: ResearchBatchPlan; action?: ResearchBatchAction; context: RequestContext; peerId: string; expires: number }>()
  private skillSources = new Map<string, { source: LocalSkillSource; candidates: string[]; peerId: string; expires: number }>()
  private githubSources = new Map<string, { discovery: GithubDiscovery; peerId: string; expires: number }>()
  private skillPlans = new Map<string, { resource: { kind: 'local'; bundle: SkillBundle } | { kind: 'github'; preview: GithubSkillPreview }; hash: string; peerId: string; expires: number }>()
  private githubProvider: ReturnType<typeof githubSkills>
  private preparingSkill = false
  private bindingPlans = new Map<string, { plan: BindingPlan; context: RequestContext; peerId: string; expires: number }>()
  private skillCopyPlans = new Map<string, { plan: ProjectSkillCopyPlan; context: RequestContext; peerId: string; expires: number }>()
  private retirementPlans = new Map<string, { qualifiedId: string; digest: string; observationHash: string; hash: string; peerId: string; expires: number }>()
  private runMigrationPlans = new Map<string, { plan: Awaited<ReturnType<typeof prepareRunMigration>>; context: RequestContext; peerId: string; expires: number }>()
  constructor(ctx: Host) {
    super(ctx, 'scholarflow', { namespace: 'scholarflow.v1' })
    this.writingController = new WritingController(ctx, this.bootInstance)
    this.researchProvider = crossrefProvider(ctx.web)
    this.githubProvider = githubSkills(ctx.web)
    ctx.effect(() => () => this.proposalRevisionPlans.clear(), 'scholarflow: clear operator candidate previews')
    ctx.effect(() => () => this.sourceRegistrationPlans.clear(), 'scholarflow: clear source registration previews')
    ctx.effect(() => () => this.researchBatchPlans.clear(), 'scholarflow: clear multi-query previews')
    ctx.effect(() => () => this.workflowPlans.clear(), 'scholarflow: clear workflow previews')
    ctx.effect(() => () => this.skillCopyPlans.clear(), 'scholarflow: clear project Skill copy previews')
    ctx.effect(() => () => this.manuscriptPlans.clear(), 'scholarflow: clear manuscript import previews')
    ctx.effect(() => () => this.identityPlans.clear(), 'scholarflow: clear project identity previews')
    ctx.effect(() => () => this.automaticPlans.clear(), 'scholarflow: clear automatic previews')
    ctx.effect(() => () => { this.draftSequencePlans.clear(); this.generationPlans.clear() }, 'scholarflow: clear draft previews')
    ctx.effect(() => () => { for (const active of this.running.values()) active.controller.abort('plugin-unload') }, 'scholarflow: stop owned stages')
    ctx.effect(() => {
      const timer = setInterval(() => this.pruneSkills(), 60000)
      timer.unref()
      return () => { clearInterval(timer); this.skillPlans.clear(); this.skillSources.clear(); this.githubSources.clear(); this.bindingPlans.clear(); this.retirementPlans.clear(); this.runMigrationPlans.clear(); this.runActionPlans.clear(); this.profilePlans.clear(); this.profileCopyPlans.clear(); this.manualReviewPlans.clear(); this.modelReviewPlans.clear(); this.modelReviewActions.clear() }
    }, 'scholarflow: expire operator skill previews')
  }

  @Remote('workflow.inspect')
  async workflowInspect(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal); return { ...await currentWorkflow(io), budget: await workflowBudgetInfo(io) } })
  }

  @Remote('automatic.inspect')
  async automaticInspect(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = inspectRequest.extend({ workflowId: z.string() }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal); return inspectAutomatic(io, input.workflowId) })
  }

  @Remote('automatic.prepare')
  async automaticPrepare(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = automaticPrepareRequest.parse(request)
      mutationRevision(input.context); this.pruneSkills()
      invariant(this.automaticPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有自动推进预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), current = await snapshot(io)
      invariant(current.ledger.revision === input.context.expectedLedgerRevision, 'STALE_LEDGER_REVISION', '先重新读取项目，再预览自动推进。')
      let reviewPlan: ModelReviewPlan | undefined
      if (input.modelReview) {
        const model = await selectedModel(this.ctx, input.context.sessionId, signal)
        reviewPlan = await prepareModelReview(io, { context: input.context, assessmentScope: 'cross-section' },
          { providerId: model.selected.provider, modelId: model.selected.model, ...(model.selected.reasoningEffort && { reasoningEffort: model.selected.reasoningEffort }), maxOutputTokens: model.maxOutputTokens }, binding => readPrivateSkill(binding, io))
        invariant(Math.ceil(reviewPlan.inputBytes / 3) + (reviewPlan.snapshot.modelDescriptor.maxOutputTokens ?? 4096) + 2000 <= model.contextWindow,
          'CONTEXT_WINDOW_EXCEEDED', '完整审查范围超过宿主模型上下文，没有隐式裁剪。')
      }
      let work: AutomaticWork | undefined
      if (input.searches) {
        this.requireNetwork()
        work = { kind: 'research', plan: await prepareResearchBatch(io, { context: input.context, searches: input.searches }) }
      } else if (input.generation || input.draftSequenceId || input.revision) {
        const model = await selectedModel(this.ctx, input.context.sessionId, signal)
        const descriptor = { providerId: model.selected.provider, modelId: model.selected.model, ...(model.selected.reasoningEffort && { reasoningEffort: model.selected.reasoningEffort }) }
        if (input.draftSequenceId) {
          const action = await prepareDraftSequenceAction(io, { context: input.context, sequenceId: input.draftSequenceId, action: 'next', reason: '' }, binding => readPrivateSkill(binding, io))
          invariant(action.generation, 'DRAFT_SEQUENCE_COMPLETE', '初稿顺序已无待生成章节，请在初稿页确认结束顺序。')
          invariant(action.generation.snapshot.modelDescriptor.providerId === descriptor.providerId && action.generation.snapshot.modelDescriptor.modelId === descriptor.modelId &&
            action.generation.snapshot.modelDescriptor.reasoningEffort === descriptor.reasoningEffort, 'MODEL_SELECTION_CHANGED', '当前宿主模型与原初稿顺序不同，请明确重新规划。')
          work = { kind: 'generation', plan: action.generation, sequenceAction: action }
        } else {
          const generation = input.revision ? { instruction: input.revision.instruction, reviewIssueId: input.revision.issueId, selection: issueFixSelection(current, input.revision.issueId) } : input.generation!
          work = { kind: 'generation', plan: await prepareGeneration(io, { context: input.context, ...generation }, descriptor, binding => readPrivateSkill(binding, io)) }
        }
        invariant(Math.ceil(work.plan.inputBytes / 3) + (work.plan.snapshot.modelDescriptor.maxOutputTokens ?? 16384) + 2000 <= model.contextWindow,
          'CONTEXT_WINDOW_EXCEEDED', '所列生成范围超过当前模型上下文限额，没有截掉关键证据。')
      }
      const plan = await prepareAutomatic(io, input.workflowId, input.context.sessionId, input.policy, reviewPlan, work)
      this.automaticPlans.set(plan.id, { plan, action: false, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, input: plan.input,
        ...(work && { stagePreview: work.kind === 'research' ? { destination: 'https://api.crossref.org', searches: work.plan.searches } :
          { instruction: work.plan.input.instruction, sectionId: work.plan.input.sectionId, issueId: work.plan.input.reviewIssueId,
            sourceText: work.plan.input.selection?.sourceText, evidenceIds: work.plan.evidenceIds, scope: work.plan.context.expectedScope } }),
        risks: [work ? '允许按当前原目标执行所列冻结阶段；格式修复、暂时重试与查询仍计入原任务预算，候选保存后停止审阅。' : reviewPlan ? '允许在审查阶段向所列固定宿主模型发送当前已保存全文、要求、相关定位证据、文风、批准记忆和固定 Skill；一次五项审查，格式修复和临时重试仍计入原预算。' : '当前自动推进只确认已有事实、执行已授权规则审查及工作草稿交付，不调用模型或在线检索。',
          ...(work ? [work.kind === 'research' ? '仅向 Crossref 发送所列查询、数量和年份；不发送主稿、资料、记忆或 Skill。元数据候选须另行收录和定位证据。' :
            '向所列宿主模型发送冻结的章节／选区、相关已选证据、批准记忆、文风和固定 Skill；保存候选后停下审阅，不直接写主稿。'] : []),
          ...(reviewPlan || work?.kind === 'generation' ? ['宿主会话保留请求和结果；不发送未选资料全文，不自动接受正文差异。暂停等待当前有限调用保存后停止后续调度，取消传播到调用。'] : []),
          '要求冲突、大纲未确认、主稿缺章节和未授权缺口都会停止。不会接受 AI 建议、关闭语义问题或标记可提交。',
          '步骤、执行时间和无进展上限计入原引导目标；新尝试与恢复不重置原额度。',
          '资料、实际稿件、文风、记忆或目标改变会使旧授权停止；中断登记不会自动重放。'] }
    })
  }

  @Remote('automatic.prepareAction')
  async automaticPrepareAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = automaticActionRequest.parse(request)
      mutationRevision(input.context); this.pruneSkills()
      invariant(this.automaticPlans.size < 8 && !this.running.has(input.automaticId), 'RUN_IN_PROGRESS', '请先等待原调度保存，或在原会话暂停／取消。')
      const { io } = await resolveStore(this.ctx, input.context, signal)
      const plan = await prepareAutomaticAction(io, input.workflowId, input.automaticId, input.context.sessionId, input.action, input.reason, owner => this.ownerAlive(owner))
      this.automaticPlans.set(plan.id, { plan, action: true, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, action: plan.action, automaticId: plan.automaticId, workflowId: plan.workflowId, reason: plan.reason,
        risks: ['恢复重新核对原范围，不重置步骤、时间、调用或无进展额度；旧待定登记不会自动重放。', '结束只停止这次推进，原引导目标、主稿、报告和问题均保留。'] }
    })
  }

  @Remote('automatic.confirm')
  async automaticConfirm(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.automaticPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '自动推进需要有效的操作者预览。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId && input.context.projectId === row.context.projectId,
        'SESSION_BINDING_CHANGED', '确认不属于原工作区、项目或会话。')
      signal.throwIfAborted(); const { io } = await resolveStore(this.ctx, row.context, new AbortController().signal)
      const owner = { pid: process.pid, bootInstance: this.bootInstance }, automaticId = row.action ? (row.plan as AutomaticActionPlan).automaticId : (row.plan as AutomaticPlan).input.automaticId
      const originalInput = row.action ? (await readAutomatic(io, (row.plan as AutomaticActionPlan).workflowId, automaticId)).input : (row.plan as AutomaticPlan).input
      const checkModel = async (sessionId: string, selectedSignal: AbortSignal) => {
        const model = await selectedModel(this.ctx, sessionId, selectedSignal), descriptor = (originalInput.modelReview ?? originalInput.work)!.modelDescriptor
        invariant(model.selected.provider === descriptor.providerId && model.selected.model === descriptor.modelId && model.selected.reasoningEffort === descriptor.reasoningEffort,
          'MODEL_SELECTION_CHANGED', '宿主模型选择改变，旧自动审查授权停止，请重新预览。')
        return model
      }
      if ((originalInput.modelReview || originalInput.work?.kind === 'generation') && (!row.action || (row.plan as AutomaticActionPlan).action === 'resume')) await checkModel(input.context.sessionId, signal)
      if (originalInput.work?.kind === 'research' && (!row.action || (row.plan as AutomaticActionPlan).action === 'resume')) this.requireNetwork()
      invariant(!this.running.has(automaticId), 'RUN_IN_PROGRESS', '这个调度仍在执行。')
      if (row.action) {
        const result = await applyAutomaticAction(io, row.plan as AutomaticActionPlan, owner, candidate => this.ownerAlive(candidate))
        this.automaticPlans.delete(input.planId)
        if ((row.plan as AutomaticActionPlan).action === 'close') return result
      } else { await startAutomatic(io, row.plan as AutomaticPlan, owner); this.automaticPlans.delete(input.planId) }
      const workflowId = row.action ? (row.plan as AutomaticActionPlan).workflowId : (row.plan as AutomaticPlan).input.workflowId
      const active = { controller: new AbortController(), context: row.context, pauseRequested: false }; this.running.set(automaticId, active)
      try { return { automaticId, state: await driveAutomatic(io, workflowId, automaticId, AbortSignal.any([signal, active.controller.signal]), { pauseRequested: () => active.pauseRequested }, {
        skillReader: binding => readPrivateSkill(binding, io),
        generation: async (plan, grant, childSignal, executionSessionId) => {
          const model = await checkModel(executionSessionId, childSignal)
          invariant(Math.ceil(plan.inputBytes / 3) + (plan.snapshot.modelDescriptor.maxOutputTokens ?? 16384) + 2000 <= model.contextWindow,
            'CONTEXT_WINDOW_EXCEEDED', '宿主模型实际上下文限额改变，没有发送旧范围。')
          return executeGeneration(io, plan, owner, childSignal, async call => {
            const currentModel = await checkModel(executionSessionId, call.signal)
            return callStageModel(this.ctx, currentModel.session, currentModel.selected, call)
          }, candidate => this.ownerAlive(candidate), { pauseRequested: () => false, automaticChild: grant, executionSessionId })
        },
        research: async (plan, grant, childSignal, executionSessionId) => {
          this.requireNetwork()
          return executeResearchBatch(io, plan, this.researchProvider, childSignal, owner, candidate => this.ownerAlive(candidate),
            { pauseRequested: () => false, automaticChild: grant, executionSessionId })
        },
        modelReview: async (plan, grant, childSignal, executionSessionId) => {
          const model = await checkModel(executionSessionId, childSignal)
          invariant(Math.ceil(plan.inputBytes / 3) + (plan.snapshot.modelDescriptor.maxOutputTokens ?? 4096) + 2000 <= model.contextWindow,
            'CONTEXT_WINDOW_EXCEEDED', '宿主模型实际上下文限额改变，未发送旧范围。')
          return executeModelReview(io, plan, owner, childSignal, async call => {
            const currentModel = await checkModel(executionSessionId, call.signal)
            return callStageModel(this.ctx, currentModel.session, currentModel.selected, call)
          }, candidate => this.ownerAlive(candidate), { pauseRequested: () => false, automaticChild: grant, executionSessionId })
        },
      }) } }
      finally { this.running.delete(automaticId) }
    })
  }

  @Remote('automatic.control')
  async automaticControl(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = inspectRequest.extend({ workflowId: z.string(), automaticId: z.string(), action: z.enum(['pause', 'cancel']) }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal); await readAutomatic(io, input.workflowId, input.automaticId)
      const active = this.running.get(input.automaticId)
      invariant(active && active.context.projectId === input.context.projectId && active.context.workspaceId === input.context.workspaceId && active.context.sessionId === input.context.sessionId,
        'RUN_CONTROL_UNAVAILABLE', '仅实际原执行会话可以暂停或取消这个调度。')
      if (input.action === 'pause') active.pauseRequested = true; else active.controller.abort('operator-cancel')
      return { automaticId: input.automaticId, action: input.action }
    })
  }

  @Remote('automatic.dismiss')
  async automaticDismiss(request: unknown, _signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = z.object({ planId: z.string() }).strict().parse(request), row = this.automaticPlans.get(input.planId)
      invariant(!row || row.peerId === peerId, 'INVALID_APPROVAL', '不能取消其他操作者的预览。'); this.automaticPlans.delete(input.planId); return { cancelled: true } })
  }

  @Remote('workflow.prepare')
  async workflowPrepare(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = workflowPrepareRequest.parse(request)
      mutationRevision(input.context); this.pruneSkills()
      invariant(this.workflowPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先确认或取消已有引导任务预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), current = await snapshot(io)
      invariant(current.ledger.revision === input.context.expectedLedgerRevision, 'STALE_LEDGER_REVISION', '项目已更新，请刷新后预览引导目标。')
      const plan = await prepareWorkflow(io, input.goal, input.context.sessionId)
      this.workflowPlans.set(plan.id, { plan, action: false, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, goal: plan.goal, gates: plan.gates, workflowId: plan.workflowId, budget: plan.budget, maxReviewRounds: plan.maxReviewRounds }
    })
  }

  @Remote('workflow.prepareAction')
  async workflowPrepareAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = workflowActionRequest.parse(request)
      mutationRevision(input.context); this.pruneSkills()
      invariant(this.workflowPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有引导任务预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), current = await snapshot(io)
      invariant(current.ledger.revision === input.context.expectedLedgerRevision, 'STALE_LEDGER_REVISION', '项目已更新，请刷新后预览阶段操作。')
      const plan = await prepareWorkflowAction(io, input, owner => this.ownerAlive(owner))
      this.workflowPlans.set(plan.id, { plan, action: true, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, action: plan.action, stage: plan.stage, callId: plan.callId, reason: plan.reason, gate: plan.gate }
    })
  }

  @Remote('workflow.confirm')
  async workflowConfirm(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.workflowPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '引导任务操作需要有效的操作者预览。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId && input.context.projectId === row.context.projectId,
        'SESSION_BINDING_CHANGED', '引导任务确认的会话或项目发生变化。')
      const { io } = await resolveStore(this.ctx, row.context, signal)
      const result = row.action ? await applyWorkflowAction(io, row.plan as WorkflowActionPlan, owner => this.ownerAlive(owner)) : await startWorkflow(io, row.plan as WorkflowStartPlan)
      this.workflowPlans.delete(input.planId); return result
    })
  }

  @Remote('workflow.dismiss')
  async workflowDismiss(request: unknown, _signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), { planId } = z.object({ planId: z.string().max(200) }).strict().parse(request)
      const row = this.workflowPlans.get(planId); invariant(row && row.peerId === peerId, 'INVALID_APPROVAL', '只可取消自己的引导任务预览。')
      this.workflowPlans.delete(planId); return { dismissed: true }
    })
  }

  @Remote('project.inspect')
  async projectInspect(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator()
      const result = await inspectProject(this.ctx, request, signal)
      if ('recovery' in result && result.recovery) {
        for (const [key, plan] of this.recoveryPlans) if (plan.expires < Date.now()) this.recoveryPlans.delete(key)
        invariant(this.recoveryPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有恢复计划。')
        const planId = newId('recovery')
        this.recoveryPlans.set(planId, { context: inspectRequest.parse(request).context, peerId, hash: result.recovery.planHash, expires: Date.now() + 600000 })
        return { ...result, recovery: { ...result.recovery, planId } }
      }
      return result.initialized ? result : { ...result, defaults: this.projectDefaults() }
    })
  }

  @Remote('project.recover')
  async projectRecover(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator()
      const parsed = initializeRequest.parse(request)
      const plan = this.recoveryPlans.get(parsed.planId)
      invariant(plan && plan.peerId === peerId && plan.hash === parsed.planHash && plan.expires > Date.now(), 'INVALID_APPROVAL', '请重新检查并确认宿主生成的恢复计划。')
      invariant(parsed.context.workspaceId === plan.context.workspaceId && parsed.context.sessionId === plan.context.sessionId, 'SESSION_BINDING_CHANGED', '恢复确认的会话或工作区发生变化。')
      const diagnostic = await resolveStore(this.ctx, plan.context, signal, undefined, true)
      const transition = await pendingCopyTransition(diagnostic.io)
      if (transition) await this.ensureNoCopyExecution(plan.context, transition.rootFingerprint, signal)
      const { io, manuscriptDir } = await resolveStore(this.ctx, plan.context, signal, undefined, false, transition)
      await io.lock(() => recover(io, manuscriptDir, plan.hash))
      this.recoveryPlans.delete(parsed.planId)
      return inspectProject(this.ctx, { context: { ...plan.context, ...(transition && { projectId: transition.projectId }) } }, signal)
    })
  }

  private async ensureNoCopyExecution(context: RequestContext, rootFingerprint: string, signal: AbortSignal) {
    const host: any = this.ctx
    for (const row of this.running.values()) {
      const observed = await host.sessionController.inspect(row.context.sessionId, signal)
      invariant(observed?.meta, 'RUN_IN_PROGRESS', '当前尚有无法核对绑定的执行请求；先停止调度并处理原会话。')
      const target = await host.fs.resolve(observed.meta.cwd, { signal }), path = host.fs.processPath(target)
      invariant(digest(process.platform === 'win32' ? path.toLowerCase() : path) !== rootFingerprint,
        'RUN_IN_PROGRESS', '当前实际工作区有执行中的请求；先在原会话结束执行，再改变身份。其他根目录的原请求不会被取消。')
    }
    // The actual Session/Workspace authorization is revalidated by the gateway.
    invariant(context.sessionId && context.workspaceId, 'SESSION_BINDING_CHANGED', '副本确认需要当前宿主会话。')
  }

  @Remote('project.prepareCopy')
  async projectPrepareCopy(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ context: inspectRequest.shape.context, reason: z.string().trim().min(10).max(4000) }).strict().parse(request)
      const { io, binding } = await resolveStore(this.ctx, input.context, signal, undefined, true), current = await snapshot(io)
      await this.ensureNoCopyExecution(input.context, binding.rootFingerprint, signal)
      for (const [key, row] of this.identityPlans) if (row.expires < Date.now()) this.identityPlans.delete(key)
      invariant(this.identityPlans.size < 4, 'TOO_MANY_PENDING_PLANS', '请先处理已有副本身份预览。')
      const plan = await prepareProjectCopy(io, { expectedRevision: current.ledger.revision, sourceSessionId: input.context.sessionId,
        rootFingerprint: binding.rootFingerprint, reason: input.reason })
      invariant([...this.identityPlans.values()].reduce((sum, row) => sum + Buffer.byteLength(json(row.plan)), Buffer.byteLength(json(plan))) <= 32 * 1024 * 1024,
        'PROJECT_COPY_HISTORY_LIMIT', '待确认副本预览合计超过 32 MiB，请先处理已有预览。')
      this.identityPlans.set(plan.id, { plan, context: { ...input.context, projectId: plan.oldProjectId }, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, workspaceId: binding.workspaceId, oldProjectId: plan.oldProjectId, projectId: plan.projectId,
        expectedRevision: plan.expectedRevision, title: current.config.project.title, reason: plan.reason, oldConfigText: plan.originals.find(row => row.path === '.scholarflow/project.yaml')!.text,
        newConfigText: plan.newConfigText, originals: plan.originals.filter(row => row.text !== null).map(row => ({ relativePath: row.path, contentHash: row.contentHash })),
        detachedPointers: plan.originals.filter(row => row.path.endsWith('/current.json') || row.path.endsWith('/active.json')).filter(row => row.path !== '.scholarflow/identity/current.json' && row.text !== null).map(row => row.path),
        risks: ['仅为当前实际工作区建立新身份，保留原项目与原始材料、正文、参考文件和内容 ID。',
          '原会话 ID 只保留为历史来源，不会成为副本的宿主会话绑定。旧待接受建议变为过期，旧运行和已计费／未知响应预算只归档，不取消、不退款、不重放。',
          '原审查结论保留为过期历史；副本须重新审查。新引导目标和模型额度须另行预览确认。', '写入前重新核对完整身份文件与实际会话权限；中断后仅可确认恢复这份固定事务。'] }
    })
  }

  @Remote('project.applyCopy')
  async projectApplyCopy(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = initializeRequest.parse(request), row = this.identityPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请重新预览副本身份变更。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId &&
        input.context.projectId === row.plan.oldProjectId, 'SESSION_BINDING_CHANGED', '副本确认的会话、工作区或原项目身份改变。')
      const transition = copyPlanTransition(row.plan)
      await this.ensureNoCopyExecution(row.context, transition.rootFingerprint, signal)
      const { io } = await resolveStore(this.ctx, row.context, signal, undefined, false, transition)
      this.identityPlans.delete(input.planId)
      await applyProjectCopy(io, row.plan)
      return inspectProject(this.ctx, { context: { ...row.context, projectId: row.plan.projectId } }, signal)
    })
  }

  @Remote('project.dismissCopy')
  async projectDismissCopy(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), { planId } = z.object({ planId: z.string().max(200) }).strict().parse(request)
      signal.throwIfAborted(); invariant(this.identityPlans.get(planId)?.peerId === peerId, 'INVALID_APPROVAL', '只能取消当前用户自己的副本预览。')
      this.identityPlans.delete(planId); return { dismissed: true }
    })
  }

  @Remote('project.identityHistory')
  async projectIdentityHistory(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = inspectRequest.parse(request), { io } = await resolveStore(this.ctx, input.context, signal, undefined, true)
      const current = await snapshot(io), lineage = await verifiedIdentityLineage(io, current.ledger.projectId)
      return { records: lineage.records.map(row => ({ operationId: row.operationId, oldProjectId: row.oldProjectId, projectId: row.projectId,
        sourceSessionId: row.sourceSessionId, confirmedAt: row.confirmedAt, reason: row.reason,
        originals: row.originals.filter(file => file.text !== null).map(file => ({ relativePath: file.path, contentHash: file.contentHash })) })) }
    })
  }

  @Remote('project.identityArchive')
  async projectIdentityArchive(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = inspectRequest.extend({ operationId: z.string().regex(/^project_copy_[a-f0-9]{32}$/u) }).parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal, undefined, true), current = await snapshot(io)
      const row = (await verifiedIdentityLineage(io, current.ledger.projectId)).records.find(record => record.operationId === input.operationId)
      invariant(row, 'PROJECT_COPY_ARCHIVE_INVALID', '只能下载当前实际项目已校验身份链中的不可变原始档案。')
      const text = json(row); return { operationId: row.operationId, text, contentHash: digest(text) }
    })
  }

  @Remote('project.prepareInit')
  async projectPrepareInit(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator()
      const { context, input } = prepareInitRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal, input.manuscriptDir)
      const plan = await prepareInit(io, resolveInitDefaults(input, this.projectDefaults()))
      for (const [id, row] of this.initPlans) if (row.expires < Date.now()) this.initPlans.delete(id)
      invariant(this.initPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有初始化计划。')
      this.initPlans.set(plan.id, { plan, context, peerId, expires: Date.now() + 10 * 60 * 1000 })
      return { planId: plan.id, planHash: plan.contentHash, project: plan.config.project, budget: plan.config.workflow.budget,
        files: plan.files.map(file => ({ relativePath: file.path, sizeBytes: Buffer.byteLength(file.text) })), risks: plan.risks }
    })
  }

  @Remote('project.initialize')
  async projectInitialize(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator()
      const parsed = initializeRequest.parse(request)
      const stored = this.initPlans.get(parsed.planId)
      invariant(stored && stored.expires > Date.now() && stored.peerId === peerId && stored.plan.contentHash === parsed.planHash,
        'INVALID_APPROVAL', '确认必须绑定当前宿主生成的未过期计划。')
      invariant(parsed.context.workspaceId === stored.context.workspaceId && parsed.context.sessionId === stored.context.sessionId,
        'SESSION_BINDING_CHANGED', '初始化确认不属于计划的工作区和会话。')
      const { io } = await resolveStore(this.ctx, stored.context, signal, stored.plan.config.paths.manuscriptDir)
      const projectId = await initialize(io, stored.plan)
      this.initPlans.delete(parsed.planId)
      return inspectProject(this.ctx, { context: { ...stored.context, projectId } }, signal)
    })
  }

  private requireOperator(): string {
    const ctx = this.ctx as Host
    invariant(ctx.invocation?.peer && ctx.invocation.peer === ctx.connection.operator, 'INVALID_APPROVAL', '此操作需要宿主已认证的用户界面调用。')
    return ctx.invocation.peer.id
  }

  private requireNetwork() {
    const settings = (this.ctx as Host).settings.describe({ redactSecrets: true }).find((row: Host) => row.ns === 'scholarflow')
    invariant(settings?.value.networkEnabled === true, 'NETWORK_DISABLED', '在线检索尚未开启；请先在 ScholarFlow 设置中启用，再预览本次查询发送范围。')
  }

  private projectDefaults() {
    const row = (this.ctx as Host).settings.describe({ redactSecrets: true }).find((entry: Host) => entry.ns === 'scholarflow')
    invariant(row, 'HOST_CAPABILITY_UNAVAILABLE', '宿主未提供 ScholarFlow 新项目设置，请检查插件设置能力。')
    return newProjectDefaultsSchema.parse(row.value)
  }

  private async readProfile(id: string, sourceDigest: string) {
    const builtin = builtinProfiles.find(profile => profile.id === id)
    if (builtin) { invariant(builtin.sourceDigest === sourceDigest, 'PROFILE_DIGEST_MISMATCH', '内置文风版本不同，未自动更新。'); return verifyProfile(builtin) }
    return this.profileLibrary.read(id, sourceDigest)
  }

  @Remote('profiles.library')
  async profilesLibrary(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); z.object({}).strict().parse(request)
      const library = await this.profileLibrary.list()
      return { profiles: [...builtinProfiles, ...library.profiles], diagnostics: library.diagnostics }
    })
  }

  @Remote('profiles.prepareImport')
  async profilesPrepareImport(request: unknown) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), { profile: input } = profileImportRequest.parse(request)
      invariant(!input.id || /^user_[\w.-]{1,190}$/u.test(input.id), 'PROFILE_INVALID', '自定义文风使用私有身份，内置模板不可覆盖。')
      const base = writingProfileSchema.parse({ ...input, id: input.id ?? newId('user'), scope: 'library', sourceDigest: digest('') })
      const profile = verifyProfile({ ...base, sourceDigest: profileDigest(base) })
      this.pruneSkills(); invariant(this.profilePlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有文风导入预览。')
      const planId = newId('profileimport'), hash = digest(json(profile))
      this.profilePlans.set(planId, { profile, hash, peerId, expires: Date.now() + 600000 })
      return { planId, planHash: hash, profile, risks: ['仅导入私有文风模板，不启用项目、不修改全局 Skill 或现有论文。表达偏好不授予权限，不能覆盖真实性规则。编辑模板会生成新固定版本，旧版本保留。'] }
    })
  }

  @Remote('profiles.install')
  async profilesInstall(request: unknown) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = profileConfirmRequest.parse(request), row = this.profilePlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.hash === input.planHash, 'INVALID_APPROVAL', '文风导入需确认当前用户的有效预览。')
      const result = await this.profileLibrary.install(row.profile); this.profilePlans.delete(input.planId); return result
    })
  }

  @Remote('profiles.dismiss')
  async profilesDismiss(request: unknown) {
    return applicationResult(async () => { const peerId = this.requireOperator(), { planId } = z.object({ planId: z.string() }).strict().parse(request)
      const row = this.profilePlans.get(planId) ?? this.profileCopyPlans.get(planId)
      invariant(row && row.peerId === peerId, 'INVALID_APPROVAL', '文风预览不属于当前用户。')
      this.profilePlans.delete(planId); this.profileCopyPlans.delete(planId); return { dismissed: true }
    })
  }

  @Remote('profiles.read')
  async profilesRead(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); const input = profileReadRequest.parse(request); return this.readProfile(input.id, input.sourceDigest) })
  }

  // Structure presets: a plugin-level resource. Reads are open to the operator; every
  // write is an explicit operator action and never reaches a model tool (SPEC v1.1 §6).
  @Remote('presets.list')
  async presetsList(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); z.object({}).strict().parse(request); return this.presetLibrary.list() })
  }

  @Remote('presets.read')
  async presetsRead(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); const { id } = presetSelectionRequest.parse(request); return this.presetLibrary.read(id) })
  }

  @Remote('presets.save')
  async presetsSave(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); const input = presetSaveRequest.parse(request)
      return this.presetLibrary.save(input, new Date().toISOString()) })
  }

  @Remote('presets.update')
  async presetsUpdate(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); const { id, expectedVersion, ...input } = presetUpdateRequest.parse(request)
      return this.presetLibrary.update(id, input, new Date().toISOString(), expectedVersion) })
  }

  @Remote('presets.copy')
  async presetsCopy(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); const { id, title } = presetCopyRequest.parse(request)
      return this.presetLibrary.copy(id, new Date().toISOString(), title) })
  }

  @Remote('presets.rename')
  async presetsRename(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); const { id, title } = presetRenameRequest.parse(request)
      return this.presetLibrary.rename(id, title, new Date().toISOString()) })
  }

  @Remote('presets.remove')
  async presetsRemove(request: unknown) {
    return applicationResult(async () => { this.requireOperator(); const { id } = presetRemoveRequest.parse(request); return this.presetLibrary.remove(id) })
  }

  @Remote('profiles.project')
  async profilesProject(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request), { io } = await resolveStore(this.ctx, context, signal); return projectProfile(io) })
  }

  @Remote('profiles.prepareCopy')
  async profilesPrepareCopy(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = profileCopyRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal), profile = await this.readProfile(input.id, input.sourceDigest)
      const plan = await prepareProfileCopy(io, profile, revision)
      this.pruneSkills(); invariant(this.profileCopyPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有项目文风复制预览。')
      this.profileCopyPlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, profile, copiedText: profileText(profile), previousHash: plan.baseHash,
        risks: ['将替换本项目 writing.md 并归档原文风与来源；共享模板、其他项目、正文与已核验来源不变。相关文风检查需更新，后续运行采用新文本。'] }
    })
  }

  @Remote('profiles.copyToProject')
  async profilesCopyToProject(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = profileCopyConfirmRequest.parse(request), row = this.profileCopyPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '项目文风复制需要确认有效预览。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId && input.context.projectId === row.context.projectId,
        'SESSION_BINDING_CHANGED', '文风复制的项目会话改变。')
      const { io } = await resolveStore(this.ctx, row.context, signal)
      const result = await applyProfileCopy(io, row.plan, row.context.sessionId); this.profileCopyPlans.delete(input.planId); return result
    })
  }

  private pruneSkills() {
    for (const [key, row] of this.draftSequencePlans) if (row.expires < Date.now()) this.draftSequencePlans.delete(key)
    for (const [key, row] of this.generationPlans) if (row.expires < Date.now()) this.generationPlans.delete(key)
    for (const [key, row] of this.workflowPlans) if (row.expires < Date.now()) this.workflowPlans.delete(key)
    for (const [key, row] of this.automaticPlans) if (row.expires < Date.now()) this.automaticPlans.delete(key)
    for (const [key, row] of this.researchBatchPlans) if (row.expires < Date.now()) this.researchBatchPlans.delete(key)
    for (const [key, row] of this.sourceRegistrationPlans) if (row.expires < Date.now()) this.sourceRegistrationPlans.delete(key)
    for (const [key, row] of this.proposalRevisionPlans) if (row.expires < Date.now()) this.proposalRevisionPlans.delete(key)
    for (const [key, row] of this.modelReviewPlans) if (row.expires < Date.now()) this.modelReviewPlans.delete(key)
    for (const [key, row] of this.modelReviewActions) if (row.expires < Date.now()) this.modelReviewActions.delete(key)
    for (const [key, row] of this.manualReviewPlans) if (row.expires < Date.now()) this.manualReviewPlans.delete(key)
    for (const [key, row] of this.profilePlans) if (row.expires < Date.now()) this.profilePlans.delete(key)
    for (const [key, row] of this.profileCopyPlans) if (row.expires < Date.now()) this.profileCopyPlans.delete(key)
    for (const [key, row] of this.runActionPlans) if (row.expires < Date.now()) this.runActionPlans.delete(key)
    for (const [key, row] of this.runMigrationPlans) if (row.expires < Date.now()) this.runMigrationPlans.delete(key)
    for (const [key, row] of this.skillSources) if (row.expires < Date.now()) this.skillSources.delete(key)
    for (const [key, row] of this.githubSources) if (row.expires < Date.now()) this.githubSources.delete(key)
    for (const [key, row] of this.skillPlans) if (row.expires < Date.now()) this.skillPlans.delete(key)
    for (const [key, row] of this.bindingPlans) if (row.expires < Date.now()) this.bindingPlans.delete(key)
    for (const [key, row] of this.skillCopyPlans) if (row.expires < Date.now()) this.skillCopyPlans.delete(key)
    for (const [key, row] of this.manuscriptPlans) if (row.expires < Date.now()) this.manuscriptPlans.delete(key)
    for (const [key, row] of this.retirementPlans) if (row.expires < Date.now()) this.retirementPlans.delete(key)
  }

  @Remote('skills.library')
  async skillsLibrary(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); z.object({}).strict().parse(request); signal.throwIfAborted()
      const catalog = await this.skillLibrary.list()
      const picker = (this.ctx as Host).get('directoryPicker')?.capability()
      return { ...catalog, pickerKind: picker?.kind ?? 'unavailable', location: '<DSH_HOME>/scholarflow/skills',
        executionPolicy: 'instructions-only' }
    })
  }

  @Remote('skills.project')
  async skillsProject(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = inspectRequest.parse(request), { io } = await resolveStore(this.ctx, input.context, signal)
      const current = await snapshot(io), locked = await readBindings(io, current.config), stage = await currentSkillStage(io)
      const resources = []
      for (const binding of locked.bindings) {
        try { const bundle = await readPrivateSkill(binding, io); resources.push({ binding, metadata: bundle.manifest.metadata, available: true }) }
        catch { resources.push({ binding, available: false, warning: '固定资源缺失或改变；需要重新导入原版本，未改用最新版本。' }) }
      }
      const installed = await this.skillLibrary.list()
      const projectResources = await listProjectSkills(io)
      return { resources, legacyMigration: locked.legacyMigration, stage, installed: { ...installed,
        diagnostics: [...installed.diagnostics, ...projectResources.diagnostics],
        versions: [...await builtinSkills(), ...installed.versions.map(manifest => ({ ...manifest, scope: 'library' })), ...projectResources.versions] } }
    })
  }

  private async selectedSkill(selection: z.infer<typeof skillVersionSelection>, io: FileStore) {
    const builtin = selection.scope === 'builtin' ? (await builtinSkills()).find(row => row.metadata.qualifiedId === selection.qualifiedId && row.digest === selection.digest) : undefined
    invariant(selection.scope !== 'builtin' || builtin?.origin.kind === 'builtin', 'SKILL_RESOURCE_MISSING', '所选内置固定版本不存在。')
    const binding: ResourceBinding = { bindingId: 'binding_copy_source', ...selection, enabledStages: [],
      entryPath: selection.scope === 'project' ? projectSkillEntry(selection.qualifiedId) : builtin?.origin.kind === 'builtin' ? builtin.origin.asset : libraryEntry(selection.qualifiedId, selection.digest) }
    return { binding, bundle: await readPrivateSkill(binding, io) }
  }

  @Remote('skills.readVersion')
  async skillsReadVersion(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = z.object({ context: inspectRequest.shape.context, selection: skillVersionSelection }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal), { bundle } = await this.selectedSkill(input.selection, io)
      return { selection: input.selection, metadata: bundle.manifest.metadata, instructions: bundle.instructions, files: bundle.manifest.files }
    })
  }

  @Remote('skills.prepareProjectCopy')
  async skillsPrepareProjectCopy(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.pruneSkills()
      const input = z.object({ context: inspectRequest.shape.context, selection: skillVersionSelection, instructions: z.string().max(65536).optional(),
        options: skillOptions, reason: z.string().min(1).max(4000) }).strict().parse(request)
      invariant(this.skillCopyPlans.size < 4, 'TOO_MANY_PENDING_PLANS', '请先处理已有项目 Skill 副本预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), { binding } = await this.selectedSkill(input.selection, io)
      const plan = await prepareProjectSkillCopy(io, binding, row => readPrivateSkill(row, io), { ...input.options,
        instructions: input.instructions, reason: input.reason, sessionId: input.context.sessionId })
      invariant(plan.ledgerRevision === mutationRevision(input.context) && plan.projectId === input.context.projectId, 'STALE_LEDGER_REVISION', '项目版本已变化，请刷新后预览。')
      const reserved = [...this.skillCopyPlans.values()].reduce((sum, row) => sum + row.plan.bundle.files.reduce((n, file) => n + file.bytes.byteLength, 0), 0)
      invariant(reserved + plan.bundle.files.reduce((n, file) => n + file.bytes.byteLength, 0) <= 60 * 1024 * 1024, 'TOO_MANY_PENDING_PLANS', '待确认的资源副本累计超过 60 MiB，请先确认或取消已有预览。')
      this.skillCopyPlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, source: plan.source, qualifiedId: plan.bundle.manifest.metadata.qualifiedId,
        metadata: plan.bundle.manifest.metadata, digest: plan.bundle.manifest.digest, files: plan.bundle.manifest.files, reason: plan.reason,
        previousInstructions: plan.sourceInstructions, instructions: plan.bundle.instructions,
        risks: ['完整静态资源将复制到本项目的新目录。原版本与已有绑定保留；复制后仍需另行确认启用。',
          '项目定制保留 name/description frontmatter。路由设置写入 scholarflow.json；附带脚本始终不执行。',
          '写入中断时，新文件保持未启用状态；重新预览使用新的副本位置，不覆盖残留文件。'] }
    })
  }

  @Remote('skills.applyProjectCopy')
  async skillsApplyProjectCopy(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.skillCopyPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请重新预览项目 Skill 副本。')
      invariant(input.context.sessionId === row.context.sessionId && input.context.workspaceId === row.context.workspaceId && input.context.projectId === row.plan.projectId,
        'SESSION_BINDING_CHANGED', '副本确认不属于当前项目会话。')
      const { io } = await resolveStore(this.ctx, input.context, signal)
      this.skillCopyPlans.delete(input.planId)
      return this.skillLibrary.withCatalogLock(() => applyProjectSkillCopy(io, row.plan, binding => readPrivateSkill(binding, io)))
    })
  }

  @Remote('skills.prepareBindings')
  async skillsPrepareBindings(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.pruneSkills()
      const input = z.object({ context: inspectRequest.shape.context, selections: z.array(z.object({ qualifiedId: z.string().max(1000), digest: hash, scope: z.enum(['library', 'builtin', 'project']).default('library'),
        enabledStages: z.array(stage).min(1).max(7) }).strict()).max(30) }).strict().parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      invariant(this.bindingPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请完成已有项目绑定预览。')
      const bindings: ResourceBinding[] = [], metadata = []
      for (const selection of input.selections) {
        const asset = selection.scope === 'builtin' ? (await builtinSkills()).find(row => row.metadata.qualifiedId === selection.qualifiedId && row.digest === selection.digest) : undefined
        invariant(selection.scope !== 'builtin' || asset?.origin.kind === 'builtin', 'SKILL_RESOURCE_MISSING', '所选内置版本不存在。')
        const entryPath = selection.scope === 'project' ? projectSkillEntry(selection.qualifiedId) : asset?.origin.kind === 'builtin' ? asset.origin.asset : libraryEntry(selection.qualifiedId, selection.digest)
        const bundle = await readPrivateSkill({ bindingId: 'binding_preview', qualifiedId: selection.qualifiedId, digest: selection.digest, scope: selection.scope,
          entryPath, enabledStages: selection.enabledStages }, io)
        const binding: ResourceBinding = { bindingId: newId('binding'), qualifiedId: selection.qualifiedId, digest: selection.digest, scope: selection.scope,
          entryPath, enabledStages: selection.enabledStages,
          ...(bundle.manifest.origin.kind === 'github' && { origin: { repository: bundle.manifest.origin.repository, commit: bundle.manifest.origin.commit,
            subpath: bundle.manifest.origin.subpath, ...(bundle.manifest.origin.license && { license: bundle.manifest.origin.license }) } }) }
        bindings.push(binding); metadata.push(bundle.manifest.metadata)
      }
      const plan = await prepareBindings(io, bindings, binding => readPrivateSkill(binding, io))
      invariant(plan.ledgerRevision === revision && plan.projectId === input.context.projectId, 'STALE_LEDGER_REVISION', '项目版本或身份已变化，请刷新后重新预览。')
      this.bindingPlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, bindings: plan.bindings, metadata, legacyMigration: plan.legacyMigration,
        risks: ['仅启用所列固定版本和阶段；显示的第一项优先。真实性和权限规则始终优先于 Skill。本次清单替换当前项目的启用清单，未列项将禁用。',
          '变更会使相关审查需更新、使尚未开始的旧生成计划失效；库更新不会自动更新项目绑定。',
          '既有聊天历史中的说明仍保留。完全更换行为上下文时，请创建绑定同一项目的新 ScholarFlow 会话。',
          ...(plan.legacyMigration ? ['此项目使用旧资源锁。本次确认会保留原配置和完整原锁到资源历史，再迁移为当前固定绑定格式。'] : [])] }
    })
  }

  @Remote('skills.applyBindings')
  async skillsApplyBindings(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.bindingPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请重新预览并确认项目绑定。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId && input.context.projectId === row.plan.projectId,
        'SESSION_BINDING_CHANGED', '绑定确认不属于当前项目会话。')
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return this.skillLibrary.withCatalogLock(async () => {
        for (const binding of row.plan.bindings) await readPrivateSkill(binding, io)
        signal.throwIfAborted(); this.bindingPlans.delete(input.planId)
        return applyBindings(io, row.plan)
      })
    })
  }

  @Remote('skills.prepareRetirement')
  async skillsPrepareRetirement(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.pruneSkills()
      const input = z.object({ qualifiedId: z.string().max(1000), digest: hash }).strict().parse(request)
      invariant(this.retirementPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先完成已有卸载预览。')
      const bundle = await this.skillLibrary.read(input.qualifiedId, input.digest)
      const scan = await knownSkillReferences(this.ctx, input.qualifiedId, input.digest, signal)
      if (scan.references.length) return { blocked: true, ...scan, name: bundle.manifest.metadata.displayName }
      const planId = newId('skill_retirement'), planHash = digest(JSON.stringify({ planId, ...input, observationHash: scan.observationHash }))
      this.retirementPlans.set(planId, { ...input, observationHash: scan.observationHash, hash: planHash, peerId, expires: Date.now() + 600000 })
      return { blocked: false, planId, planHash, ...scan, name: bundle.manifest.metadata.displayName, qualifiedId: input.qualifiedId, digest: input.digest }
    })
  }

  @Remote('skills.retire')
  async skillsRetire(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ planId: z.string().max(200), planHash: hash }).strict().parse(request)
      const row = this.retirementPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.hash === input.planHash, 'INVALID_APPROVAL', '请重新预览并确认此版本卸载。')
      signal.throwIfAborted(); this.retirementPlans.delete(input.planId)
      return this.skillLibrary.retire(row.qualifiedId, row.digest, async () => {
        const scan = await knownSkillReferences(this.ctx, row.qualifiedId, row.digest, signal)
        invariant(!scan.references.length, 'SKILL_VERSION_REFERENCED', '已有项目或历史运行引用此版本，未卸载。')
        invariant(scan.observationHash === row.observationHash, 'SKILL_REFERENCES_CHANGED', '确认期间本机引用状态改变，请重新预览；未卸载。')
        signal.throwIfAborted()
      })
    })
  }

  @Remote('skills.selectStage')
  async skillsSelectStage(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = z.object({ context: inspectRequest.shape.context, stage }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return selectSkillStage(io, input.stage, mutationRevision(input.context))
    })
  }

  @Remote('skills.pickLocal')
  async skillsPickLocal(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); z.object({}).strict().parse(request)
      const picker = (this.ctx as Host).get('directoryPicker')?.capability()
      invariant(picker?.kind === 'native', 'SKILL_PICKER_UNAVAILABLE', '当前 Host 没有原生目录选择器；可明确输入 Host 上的目录再扫描。')
      return { path: await picker.pick(signal) }
    })
  }

  @Remote('skills.scanLocal')
  async skillsScanLocal(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ path: z.string().min(1).max(4000) }).strict().parse(request)
      this.pruneSkills()
      invariant(this.skillSources.size < 8, 'TOO_MANY_PENDING_PLANS', '请先关闭已有来源预览。')
      const source = await LocalSkillSource.open(input.path), discovery = await source.discover(signal)
      signal.throwIfAborted()
      invariant(this.skillSources.size < 8, 'TOO_MANY_PENDING_PLANS', '已有来源预览过多。')
      const sourceId = newId('skill_source')
      this.skillSources.set(sourceId, { source, candidates: discovery.candidates.map(row => row.subpath), peerId, expires: Date.now() + 600000 })
      return { sourceId, ...discovery }
    })
  }

  @Remote('skills.prepareLocal')
  async skillsPrepareLocal(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ sourceId: z.string().max(200), subpath: z.string().max(800), options: skillOptions }).strict().parse(request)
      this.pruneSkills()
      const row = this.skillSources.get(input.sourceId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.candidates.includes(input.subpath), 'INVALID_APPROVAL', '请重新选择来源目录中的 Skill 候选。')
      invariant(!this.preparingSkill && this.skillPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请完成或取消当前 Skill 预览。')
      this.preparingSkill = true
      try {
        const bundle = await row.source.package(input.subpath, input.options, signal)
        signal.throwIfAborted()
        const planId = newId('skill_import'), planHash = digest(JSON.stringify(bundle.manifest))
        this.skillPlans.set(planId, { resource: { kind: 'local', bundle }, hash: planHash, peerId, expires: Date.now() + 600000 })
        return { planId, planHash, manifest: bundle.manifest, instructions: bundle.instructions,
          risks: ['仅复制所列静态文件到 ScholarFlow 私有库；原始来源保持不变。', '不会运行脚本、安装依赖或授予上游声明的工具权限。', '安装后仍需在具体项目中明确启用阶段及固定版本。'] }
      } finally { this.preparingSkill = false }
    })
  }

  @Remote('skills.scanGithub')
  async skillsScanGithub(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.requireNetwork(); this.pruneSkills()
      const input = z.object({ url: z.string().max(3000), ref: z.string().max(300).optional(), subpath: z.string().max(800).optional() }).strict().parse(request)
      const location = githubLocation(input.url, input.ref, input.subpath)
      invariant(this.githubSources.size < 8, 'TOO_MANY_PENDING_PLANS', '请关闭已有 GitHub 来源预览。')
      const discovery = await this.githubProvider.discover(location, AbortSignal.any([signal, AbortSignal.timeout(60000)]))
      invariant(this.githubSources.size < 8, 'TOO_MANY_PENDING_PLANS', '已有 GitHub 来源预览过多。')
      const sourceId = newId('github_source')
      this.githubSources.set(sourceId, { discovery, peerId, expires: Date.now() + 600000 })
      return { sourceId, repository: discovery.repository, ref: discovery.ref, commit: discovery.commit, subpath: discovery.subpath,
        candidates: discovery.candidates.map(subpath => ({ subpath })), warnings: discovery.warnings }
    })
  }

  @Remote('skills.prepareGithub')
  async skillsPrepareGithub(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.requireNetwork(); this.pruneSkills()
      const input = z.object({ sourceId: z.string().max(200), subpath: z.string().max(800), options: skillOptions }).strict().parse(request)
      const row = this.githubSources.get(input.sourceId)
      invariant(row && row.peerId === peerId && row.expires > Date.now(), 'INVALID_APPROVAL', '请重新扫描固定 GitHub 来源。')
      invariant(!this.preparingSkill && this.skillPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请完成或取消当前 Skill 预览。')
      this.preparingSkill = true
      try {
        const preview = await this.githubProvider.preview(row.discovery, input.subpath, input.options, AbortSignal.any([signal, AbortSignal.timeout(25000)]))
        const planId = newId('github_import'), planHash = digest(JSON.stringify(preview))
        this.skillPlans.set(planId, { resource: { kind: 'github', preview }, hash: planHash, peerId, expires: Date.now() + 600000 })
        return { planId, planHash, manifest: { metadata: preview.metadata, files: preview.files, origin: { kind: 'github', repository: row.discovery.repository,
          commit: row.discovery.commit, subpath: preview.subpath, license: row.discovery.license } }, instructions: preview.instructions,
          risks: ['确认后通过 Host 向 api.github.com 下载所列固定 Git blob；最多 200 个文件、20 MiB，Host 响应上限仍适用。',
            '不读取凭据，不克隆仓库，不运行脚本、安装依赖或启动服务；网络错误与限流会停止，需明确重新预览。',
            '私有库安装不修改项目绑定；最终摘要按全部实际下载字节计算，原分支后续变化不影响此 commit。'] }
      } finally { this.preparingSkill = false }
    })
  }

  @Remote('skills.install')
  async skillsInstall(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ planId: z.string().max(200), planHash: hash }).strict().parse(request)
      const row = this.skillPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.hash === input.planHash, 'INVALID_APPROVAL', '请重新预览并确认此固定资源版本。')
      signal.throwIfAborted()
      if (row.resource.kind === 'github') this.requireNetwork()
      this.skillPlans.delete(input.planId) // A confirmation cannot be replayed.
      const bundle = row.resource.kind === 'local' ? row.resource.bundle : await this.githubProvider.download(row.resource.preview,
        AbortSignal.any([signal, AbortSignal.timeout(120000)]))
      signal.throwIfAborted()
      return this.skillLibrary.install(bundle)
    })
  }

  @Remote('skills.dismiss')
  async skillsDismiss(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ sourceId: z.string().max(200).optional(), planId: z.string().max(200).optional() }).strict().parse(request)
      signal.throwIfAborted()
      if (input.sourceId && this.skillSources.get(input.sourceId)?.peerId === peerId) this.skillSources.delete(input.sourceId)
      if (input.sourceId && this.githubSources.get(input.sourceId)?.peerId === peerId) this.githubSources.delete(input.sourceId)
      if (input.planId && this.skillPlans.get(input.planId)?.peerId === peerId) this.skillPlans.delete(input.planId)
      if (input.planId && this.bindingPlans.get(input.planId)?.peerId === peerId) this.bindingPlans.delete(input.planId)
      if (input.planId && this.skillCopyPlans.get(input.planId)?.peerId === peerId) this.skillCopyPlans.delete(input.planId)
      if (input.planId && this.retirementPlans.get(input.planId)?.peerId === peerId) this.retirementPlans.delete(input.planId)
      return { dismissed: true }
    })
  }

  @Remote('research.prepare')
  async researchPrepare(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.requireNetwork()
      const input = searchPrepareRequest.parse(request); mutationRevision(input.context)
      const { io } = await resolveStore(this.ctx, input.context, signal), plan = await prepareSearch(io, input.search)
      for (const [key, value] of this.searchPlans) if (value.expires < Date.now()) this.searchPlans.delete(key)
      invariant(this.searchPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有检索计划。')
      this.searchPlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, provider: 'crossref', destination: 'https://api.crossref.org', search: plan.search,
        risks: ['仅发送所列查询词、数量与年份筛选；用途留在项目检索日志，不发送资料、主稿、Profile 或记忆。', '只返回元数据候选；尚未纳入来源，不下载全文，不证明论点支持。'] }
    })
  }

  private researchBatchPreview(plan: ResearchBatchPlan, action?: ResearchBatchAction) {
    return { planId: action?.id ?? plan.id, planHash: action?.contentHash ?? plan.contentHash, runId: plan.snapshot.runId,
      previousRunId: action?.runId, action: action?.action ?? 'start', searches: plan.searches, budget: plan.snapshot.budget,
      destination: 'https://api.crossref.org',
      risks: ['仅发送列出的查询词、数量与年份；用途记录在项目，不发送主稿、资料、Profile、记忆或 Skill，不调用模型。',
        '候选总量与查询预算按本次运行累计，重试和无应答的中断调用也计入查询次数；成功结果先保存，纳入来源另行确认。',
        '宿主未暴露 Retry-After 响应头：Crossref 429 会暂停所有后续调度，不能猜测自动重试窗口。请稍后再明确恢复。',
        ...(action?.action === 'resume' ? ['复用原查询计划及成功结果，不重发已完成请求；中断时无应答的查询可能重新发送，原尝试与费用预算记录保留。'] :
          action?.action === 'retry' ? ['创建关联新运行，保留原失败／取消终态；按当前配置重新发送列出的查询。'] :
          action?.action === 'close' ? ['只将原运行记为用户取消，保留全部结果和检查点，不发送请求、不修改主稿。'] : [])] }
  }

  @Remote('research.batchPrepare')
  async researchBatchPrepare(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.requireNetwork(); this.pruneSkills()
      const input = batchPrepareRequest.parse(request); mutationRevision(input.context)
      invariant(this.researchBatchPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有检索批次预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), plan = await prepareResearchBatch(io, input)
      this.researchBatchPlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return this.researchBatchPreview(plan)
    })
  }

  @Remote('research.batchPrepareAction')
  async researchBatchPrepareAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.pruneSkills(); const input = batchActionRequest.parse(request); mutationRevision(input.context)
      if (input.action !== 'close') this.requireNetwork()
      invariant(!this.running.has(input.runId), 'RUN_IN_PROGRESS', '请等待当前检索保存检查点。')
      invariant(this.researchBatchPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有检索批次预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), data = await readResearchBatch(io, input.runId)
      const action = await prepareResearchBatchAction(io, input.runId, input.action, candidate => this.ownerAlive(candidate), input.context.sessionId)
      const plan = action.retryPlan ?? data.plan
      this.researchBatchPlans.set(action.id, { plan, action, context: input.context, peerId, expires: Date.now() + 600000 })
      return { ...this.researchBatchPreview(plan, action), usedQueries: data.checkpoint.queriesUsed, candidatesReceived: data.checkpoint.candidatesReceived,
        queryStates: data.checkpoint.queries }
    })
  }

  @Remote('research.batchStart')
  async researchBatchStart(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.researchBatchPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && (row.action?.contentHash ?? row.plan.contentHash) === input.planHash,
        'INVALID_APPROVAL', '请重新预览并确认当前检索批次。')
      invariant(row.context.projectId === input.context.projectId && row.context.sessionId === input.context.sessionId && row.context.workspaceId === input.context.workspaceId,
        'SESSION_BINDING_CHANGED', '检索确认不属于当前会话和项目。')
      signal.throwIfAborted(); const { io } = await resolveStore(this.ctx, input.context, new AbortController().signal)
      if (row.action?.action === 'close') { const result = await closeResearchBatch(io, row.action, candidate => this.ownerAlive(candidate)); this.researchBatchPlans.delete(input.planId); return result }
      this.requireNetwork(); const runId = row.plan.snapshot.runId
      invariant(!this.running.has(runId), 'RUN_IN_PROGRESS', '此检索执行器仍在运行。')
      const active = { controller: new AbortController(), context: input.context, pauseRequested: false }
      this.running.set(runId, active); this.researchBatchPlans.delete(input.planId)
      try { return await executeResearchBatch(io, row.plan, this.researchProvider, AbortSignal.any([signal, active.controller.signal]),
        { pid: process.pid, bootInstance: this.bootInstance }, candidate => this.ownerAlive(candidate),
        { pauseRequested: () => active.pauseRequested, action: row.action, executionSessionId: input.context.sessionId }) }
      finally { this.running.delete(runId) }
    })
  }

  @Remote('research.batchRead')
  async researchBatchRead(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = runControlRequest.parse(request), { io } = await resolveStore(this.ctx, input.context, signal)
      const data = await readResearchBatch(io, input.runId)
      return { run: data.stored.run, checkpoint: data.checkpoint, searches: data.plan.searches }
    })
  }

  @Remote('research.batchList')
  async researchBatchList(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const { context } = inspectRequest.parse(request), { io } = await resolveStore(this.ctx, context, signal)
      const result = await inspectRuns(io)
      return { ...result, runs: result.runs.filter(row => row.stage === 'research').slice(0, 20) }
    })
  }

  @Remote('research.batchDismiss')
  async researchBatchDismiss(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ planId: id }).strict().parse(request)
      signal.throwIfAborted(); invariant(this.researchBatchPlans.get(input.planId)?.peerId === peerId, 'INVALID_APPROVAL', '检索预览不属于当前用户。')
      this.researchBatchPlans.delete(input.planId); return { dismissed: true }
    })
  }

  @Remote('research.execute')
  async researchExecute(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.requireNetwork()
      const input = onlineConfirmRequest.parse(request), row = this.searchPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请重新预览并确认此查询。')
      invariant(row.context.workspaceId === input.context.workspaceId && row.context.sessionId === input.context.sessionId && row.plan.projectId === input.context.projectId,
        'SESSION_BINDING_CHANGED', '检索确认不属于当前会话项目。')
      signal.throwIfAborted()
      const { io } = await resolveStore(this.ctx, input.context, new AbortController().signal)
      this.searchPlans.delete(input.planId)
      return executeSearch(io, row.plan, this.researchProvider, AbortSignal.any([signal, AbortSignal.timeout(25000)]), { pid: process.pid, bootInstance: this.bootInstance })
    })
  }

  @Remote('research.list')
  async researchList(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal); return listSearches(io) })
  }

  @Remote('research.read')
  async researchRead(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = z.object({ context: inspectRequest.shape.context, searchId: z.string().min(1).max(100) }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal); return (await readSearch(io, input.searchId)).record })
  }

  @Remote('research.decide')
  async researchDecide(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = candidateDecisionRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return decideCandidate(io, input.searchId, input.candidateId, input.decision, input.reason, revision) })
  }

  @Remote('sources.prepareLookup')
  async sourcesPrepareLookup(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.requireNetwork()
      const input = lookupPrepareRequest.parse(request); mutationRevision(input.context)
      const { io } = await resolveStore(this.ctx, input.context, signal), plan = await prepareLookup(io, input.sourceId)
      for (const [key, value] of this.lookupPlans) if (value.expires < Date.now()) this.lookupPlans.delete(key)
      invariant(this.lookupPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有核验计划。')
      this.lookupPlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, sourceId: plan.sourceId, doi: plan.doi, destination: 'https://api.crossref.org',
        risks: ['只向 Crossref 发送此 DOI；比较已登记标题及可比较作者和年份。', '不覆盖用户元数据或证据；身份匹配不代表正文支持。查询失败会记录不可用原因，不断言来源伪造。'] }
    })
  }

  @Remote('sources.lookup')
  async sourcesLookup(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.requireNetwork()
      const input = onlineConfirmRequest.parse(request), row = this.lookupPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.plan.contentHash === input.planHash && row.expires > Date.now(), 'INVALID_APPROVAL', '请重新预览并确认 DOI 查询。')
      invariant(row.context.projectId === input.context.projectId && row.context.sessionId === input.context.sessionId && row.context.workspaceId === input.context.workspaceId,
        'SESSION_BINDING_CHANGED', '核验确认不属于当前会话项目。')
      signal.throwIfAborted()
      const { io } = await resolveStore(this.ctx, input.context, new AbortController().signal)
      this.lookupPlans.delete(input.planId)
      return executeLookup(io, row.plan, this.researchProvider, AbortSignal.any([signal, AbortSignal.timeout(25000)]), { pid: process.pid, bootInstance: this.bootInstance })
    })
  }

  @Remote('materials.scan')
  async materialsScan(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = scanRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return scanMaterials(io, input.directory, input.cursor, input.limit) })
  }

  @Remote('document.read')
  async documentRead(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal), current = await snapshot(io)
      return { document: current.document, revision: current.ledger.revision, statistics: wordStats(current.document.text) } })
  }

  @Remote('draftSequence.inspect')
  async draftSequenceInspect(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal); return inspectDraftSequence(io) })
  }

  @Remote('draftSequence.prepare')
  async draftSequencePrepare(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = draftSequenceRequest.parse(request)
      mutationRevision(input.context); this.pruneSkills()
      invariant(this.draftSequencePlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理初稿顺序预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), model = await selectedModel(this.ctx, input.context.sessionId, signal)
      const plan = await prepareDraftSequence(io, input, { providerId: model.selected.provider, modelId: model.selected.model,
        ...(model.selected.reasoningEffort && { reasoningEffort: model.selected.reasoningEffort }), maxOutputTokens: model.maxOutputTokens ?? 16384 }, binding => readPrivateSkill(binding, io))
      this.draftSequencePlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, action: 'start', input: plan.input,
        risks: ['顺序只调度缺失或空白章节；已有正文原样保留。每节另行预览资料发送范围并审阅接受，主稿不会自动被覆盖。',
          '摘要／结论由你明确标记，排到正文之后；只依据实际保存正文。无定位证据时仅提供固定待补标记，不调用模型。',
          '计入原引导目标累计预算。资料、文风、记忆、Skill、大纲或人工稿变化会停止旧顺序，已有稿件与建议保留。'] }
    })
  }

  @Remote('draftSequence.prepareAction')
  async draftSequencePrepareAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = draftSequenceActionRequest.parse(request)
      mutationRevision(input.context); this.pruneSkills()
      const { io } = await resolveStore(this.ctx, input.context, signal), plan = await prepareDraftSequenceAction(io, input, binding => readPrivateSkill(binding, io))
      if (plan.generation) {
        const model = await selectedModel(this.ctx, input.context.sessionId, signal), frozen = (await readDraftSequence(io, input.sequenceId)).input.model
        invariant(model.selected.provider === frozen.providerId && model.selected.model === frozen.modelId &&
          model.selected.reasoningEffort === frozen.reasoningEffort, 'MODEL_SELECTION_CHANGED', '宿主模型选择与初稿顺序不同，请取消旧顺序后重新预览发送范围。')
        invariant(plan.generation.context.structuralGap === true || Math.ceil(plan.generation.inputBytes / 3) + 16384 + 2000 <= model.contextWindow,
          'CONTEXT_WINDOW_EXCEEDED', '当前实际正文与证据超出模型上下文预算，没有删掉关键输入继续。')
        invariant(this.generationPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有章节预览。')
        this.generationPlans.set(plan.generation.id, { plan: plan.generation, sequence: plan, selected: model.selected, peerId, expires: Date.now() + 600000 })
        return { ...await this.generationPreview(plan.generation, io), sequenceId: input.sequenceId }
      }
      invariant(this.draftSequencePlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理初稿顺序预览。')
      this.draftSequencePlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, action: plan.action, sequenceId: plan.sequenceId, status: plan.next.status,
        risks: ['只更新已确认顺序和真实进度，不修改正文、不接受候选、不重试付费调用。', '待补、未关闭问题、原稿与拒绝建议均保留；完成章节顺序不表示审查通过或研究完成。'] }
    })
  }

  @Remote('draftSequence.confirm')
  async draftSequenceConfirm(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.draftSequencePlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash,
        'INVALID_APPROVAL', '请重新预览初稿顺序操作。')
      invariant(row.context.sessionId === input.context.sessionId && row.context.workspaceId === input.context.workspaceId && row.context.projectId === input.context.projectId,
        'SESSION_BINDING_CHANGED', '初稿顺序确认不属于当前项目会话。')
      const { io } = await resolveStore(this.ctx, input.context, signal)
      const result = row.plan.action === 'start' ? await startDraftSequence(io, row.plan, binding => readPrivateSkill(binding, io)) :
        await applyDraftSequenceAction(io, row.plan, binding => readPrivateSkill(binding, io))
      this.draftSequencePlans.delete(input.planId); return result
    })
  }

  @Remote('draftSequence.dismiss')
  async draftSequenceDismiss(request: unknown, _signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), { planId } = z.object({ planId: id }).strict().parse(request)
      invariant(this.draftSequencePlans.get(planId)?.peerId === peerId, 'INVALID_APPROVAL', '只可取消自己的初稿操作预览。')
      this.draftSequencePlans.delete(planId); return { dismissed: true } })
  }

  @Remote('creation.materials')
  async creationMaterials(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.scan(request, signal) }) }
  @Remote('creation.suggest')
  async creationSuggest(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.suggest(request, this.requireOperator(), signal)) }
  @Remote('sources.pickExternal')
  async sourcesPickExternal(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.pickExternal(request, this.requireOperator(), signal)) }
  @Remote('sources.externalStatus')
  async sourcesExternalStatus(request: unknown) { return applicationResult(async () => this.writingController.externalStatus(request, this.requireOperator())) }
  @Remote('creation.imageCapability')
  async creationImageCapability(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.imageCapability(request, signal) }) }
  @Remote('creation.recognizeImage')
  async creationRecognizeImage(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.recognizeImage(request, this.requireOperator(), signal)) }
  @Remote('creation.prepare')
  async creationPrepare(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.prepare(request, this.requireOperator(), signal, this.projectDefaults())) }
  @Remote('creation.start')
  async creationStart(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.create(request, this.requireOperator(), signal)) }
  // v1.2 requirement chain: read every member, structure what was read, propose an outline,
  // and adopt field by field. Reads are jobs, so the wizard sees real per-member progress.
  @Remote('creation.readRequirements')
  async creationReadRequirements(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.readRequirements(request, this.requireOperator(), signal)) }
  @Remote('creation.readStatus')
  async creationReadStatus(request: unknown) { return applicationResult(async () => this.writingController.readStatus(request, this.requireOperator())) }
  @Remote('creation.stopRead')
  async creationStopRead(request: unknown) { return applicationResult(async () => this.writingController.stopRead(request, this.requireOperator())) }
  @Remote('creation.retryMember')
  async creationRetryMember(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.retryMember(request, this.requireOperator(), signal)) }
  @Remote('creation.imageModels')
  async creationImageModels(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.imageModels(request, signal) }) }
  @Remote('creation.structure')
  async creationStructure(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.structure(request, this.requireOperator(), signal)) }
  @Remote('outline.suggest')
  async outlineSuggest(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.suggestOutline(request, this.requireOperator(), signal)) }
  @Remote('candidates.list')
  async candidatesList(request: unknown) { return applicationResult(async () => { this.requireOperator(); return this.writingController.candidateList(request) }) }
  @Remote('candidates.adopt')
  async candidatesAdopt(request: unknown) { return applicationResult(async () => this.writingController.adoptCandidate(request, this.requireOperator())) }
  @Remote('candidates.discard')
  async candidatesDiscard(request: unknown) { return applicationResult(async () => this.writingController.discardCandidate(request)) }
  @Remote('task.issues')
  async taskIssues(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.taskIssues(request, signal) }) }
  @Remote('writingTask.issueAction')
  async writingTaskIssueAction(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.issueAction(request, signal) }) }
  @Remote('typography.update')
  async typographyUpdate(request: unknown, signal: AbortSignal) { return applicationResult(async () => this.writingController.preferencesTypography(request, signal)) }
  @Remote('writingTask.inspect')
  async writingTaskInspect(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.inspect(request, signal) }) }
  @Remote('writingTask.requirements')
  async writingTaskRequirements(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.requirements(request, signal) }) }
  @Remote('document.versions')
  async documentVersions(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.versions(request, signal) }) }
  @Remote('writingTask.action')
  async writingTaskAction(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.action(request, signal) }) }
  @Remote('writingTask.preferences')
  async writingTaskPreferences(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.preferences(request, signal) }) }
  @Remote('cowrite.propose')
  async cowritePropose(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.propose(request, signal) }) }
  @Remote('cowrite.list')
  async cowriteList(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.suggestions(request, signal) }) }
  @Remote('cowrite.decide')
  async cowriteDecide(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.decideSuggestion(request, signal) }) }
  @Remote('cowrite.decideBrief')
  async cowriteDecideBrief(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.decideBrief(request, signal) }) }
  @Remote('cowrite.adoptGenerated')
  async cowriteAdoptGenerated(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.adoptGenerated(request, signal) }) }
  @Remote('writingTask.format')
  async writingTaskFormat(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.format(request, signal) }) }

  @Remote('writing.dismiss')
  async writingDismiss(request: unknown, _signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), { planId } = z.object({ planId: id }).strict().parse(request)
      invariant(this.generationPlans.get(planId)?.peerId === peerId, 'INVALID_APPROVAL', '只可取消自己的生成预览。')
      this.generationPlans.delete(planId); return { dismissed: true } })
  }

  @Remote('writing.prepare')
  async writingPrepare(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => this.prepareWriting(generationRequest.parse(request), this.requireOperator(), signal))
  }

  private async prepareWriting(input: z.infer<typeof generationRequest>, peerId: string, signal: AbortSignal) {
      mutationRevision(input.context)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      const model = await selectedModel(this.ctx, input.context.sessionId, signal)
      const plan = await prepareGeneration(io, input, { providerId: model.selected.provider, modelId: model.selected.model, maxOutputTokens: model.maxOutputTokens }, binding => readPrivateSkill(binding, io))
      invariant(Math.ceil(plan.inputBytes / 3) + (plan.snapshot.modelDescriptor.maxOutputTokens ?? 4096) + 2000 <= model.contextWindow, 'CONTEXT_WINDOW_EXCEEDED', '选定范围超过模型上下文预算；请缩小章节和证据范围，未截掉关键证据继续生成。')
      for (const [key, row] of this.generationPlans) if (row.expires < Date.now()) this.generationPlans.delete(key)
      invariant(this.generationPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有生成计划。')
      this.generationPlans.set(plan.id, { plan, selected: model.selected, peerId, expires: Date.now() + 600000 })
      return this.generationPreview(plan, io)
  }

  private async generationPreview(plan: GenerationPlan, io: import('../core/store/files.ts').FileStore) {
      const input = plan.input, gap = plan.context.structuralGap === true
      return { planId: plan.id, planHash: plan.contentHash, runId: plan.snapshot.runId, model: plan.snapshot.modelDescriptor, stage: plan.snapshot.stage, structuralGap: gap,
        workflowId: plan.snapshot.workflowId, workflowBudget: await workflowBudgetInfo(io),
        inputBytes: plan.inputBytes, evidenceIds: plan.evidenceIds, budget: plan.snapshot.budget, skillDigests: plan.snapshot.skillDigests,
        scope: input.selection ? input.selection.sourceRange : plan.sectionTarget ? { startUtf16: plan.sectionTarget.startUtf16, endUtf16: plan.sectionTarget.endUtf16 } : { startUtf16: 0, endUtf16: (await snapshot(io)).document.text.length },
        sectionTarget: plan.sectionTarget, sourceText: input.selection?.sourceText, reviewIssueId: input.reviewIssueId, risks: [
          ...(input.reviewIssueId ? ['修复范围是问题所在完整段落，保留引用与人工内容；接受后先复查规则，模型问题只有明确同版本复查才能关闭。'] : []),
          ...(plan.sectionTarget ? ['本节候选仅修改上述范围；为核对摘要、结论与跨节一致性，同时向模型发送当前全部已保存主稿。待补项不能作为已有结果。'] : []),
          ...(gap ? ['本节没有可用定位证据，只创建固定待补结构建议，不发送模型请求。'] : [
            '将选定证据、当前稿件范围、项目文风、确认记忆和当前阶段固定 Skill 说明／文本参考发送给所列宿主模型提供方；本地资料模式不等于模型离线处理。',
            '宿主会话日志保留模型请求以供追溯；项目诊断日志不另存完整 Prompt。']),
          '生成结果为待审阅建议，接受前不会改写主稿。'] }
  }

  @Remote('review.locateIssue')
  async reviewLocateIssue(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = z.object({ context: inspectRequest.shape.context, issueId: id }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal), current = await snapshot(io), { issue } = locateIssue(current, input.issueId)
      return { projectId: current.ledger.projectId, issueId: issue.id, documentHash: current.document.contentHash, location: issue.location } })
  }

  @Remote('review.prepareFix')
  async reviewPrepareFix(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = z.object({ context: inspectRequest.shape.context, issueId: id,
      instruction: z.string().trim().min(1).max(12000).default('修复所列问题，保留事实、限定范围、引用和人工内容；仅返回目标完整段落候选。') }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal), current = await snapshot(io), selection = issueFixSelection(current, input.issueId)
      return this.prepareWriting(generationRequest.parse({ context: input.context, instruction: input.instruction, selection, reviewIssueId: input.issueId }), peerId, signal) })
  }

  @Remote('review.fixes')
  async reviewFixes(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request), { io } = await resolveStore(this.ctx, context, signal), current = await snapshot(io)
      const fixes: { proposalId: string; issueId: string; state: string; acceptedRevisionId?: string }[] = [], diagnostics: string[] = []
      for (const state of Object.values(current.ledger.proposalStates).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100)) {
        try { const image = await proposalImage(io, state.proposalId)
          invariant(image.proposal.projectId === current.ledger.projectId, 'PROJECT_ID_CONFLICT', '建议不属于当前项目。')
          if (image.proposal.reviewIssue) fixes.push({ proposalId: state.proposalId, issueId: image.proposal.reviewIssue.issueId, state: state.state, acceptedRevisionId: state.acceptedRevisionId })
        } catch { diagnostics.push('一个建议快照不可用，未采用其问题关联。') }
      }
      return { fixes, diagnostics } })
  }

  @Remote('anchors.upsert')
  async anchorsUpsert(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const { context, ...input } = anchorUpsertRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal)
      return upsertAnchor(io, input, mutationRevision(context))
    })
  }

  @Remote('runs.start')
  async runsStart(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = runStartRequest.parse(request), row = this.generationPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请预览并确认当前宿主生成的计划。')
      invariant(row.plan.input.context.workspaceId === input.context.workspaceId && row.plan.input.context.sessionId === input.context.sessionId && row.plan.snapshot.projectId === input.context.projectId,
        'SESSION_BINDING_CHANGED', '生成确认不属于此工作区、会话或项目。')
      const model = await selectedModel(this.ctx, input.context.sessionId, signal)
      invariant(JSON.stringify(model.selected) === JSON.stringify(row.selected), 'MODEL_SELECTION_CHANGED', '宿主模型已改变，请重新预览资料发送范围。')
      signal.throwIfAborted()
      // Persistence must settle even when the request/model signal is cancelled.
      // It still revalidates the original project binding and live Host policy.
      const { io } = await resolveStore(this.ctx, input.context, new AbortController().signal)
      const controller = new AbortController(), runId = row.plan.snapshot.runId
      invariant(!this.running.has(runId), 'RUN_IN_PROGRESS', '该运行已经开始。')
      const active = { controller, context: row.plan.input.context, pauseRequested: false }
      this.running.set(runId, active)
      this.generationPlans.delete(input.planId)
      const owner = { pid: process.pid, bootInstance: this.bootInstance }
      try {
        if (row.sequence) await applyDraftSequenceAction(io, row.sequence, binding => readPrivateSkill(binding, io))
        return await executeGeneration(io, row.plan, owner, AbortSignal.any([signal, controller.signal]),
          call => callStageModel(this.ctx, model.session, model.selected, call), candidate => this.ownerAlive(candidate),
          { pauseRequested: () => active.pauseRequested })
      } finally { this.running.delete(runId) }
    })
  }

  private ownerAlive(candidate: { pid: number; bootInstance: string }) {
    // An old plugin instance in this same PID may still be settling an aborted
    // request. A different boot token is not proof of process death.
    try { process.kill(candidate.pid, 0); return true }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
  }

  @Remote('runs.pause')
  async runsPause(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = runControlRequest.parse(request)
      await resolveStore(this.ctx, input.context, signal)
      const active = this.running.get(input.runId)
      invariant(active && active.context.projectId === input.context.projectId && active.context.workspaceId === input.context.workspaceId && active.context.sessionId === input.context.sessionId,
        'RUN_CONTROL_UNAVAILABLE', '仅原执行会话可以暂停当前调用；停止后的运行从历史预览恢复。')
      active.pauseRequested = true
      return { runId: input.runId, pauseRequested: true, detail: '当前调用结束后保存检查点，停止调度下一次工作。' }
    })
  }

  @Remote('runs.prepareAction')
  async runsPrepareAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = runControlRequest.extend({ action: z.enum(['resume', 'retry', 'close']) }).parse(request)
      mutationRevision(input.context); this.pruneSkills()
      invariant(!this.running.has(input.runId), 'RUN_IN_PROGRESS', '当前执行器尚未停止，请等待检查点保存。')
      invariant(this.runActionPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请处理已有运行操作预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), plan = await prepareRunAction(io, input.runId, input.action, candidate => this.ownerAlive(candidate))
      let generation: GenerationPlan | undefined, selected: { provider: string; model: string; reasoningEffort?: string } | undefined
      if (input.action !== 'close' && !plan.existingProposalId) {
        const model = await selectedModel(this.ctx, input.context.sessionId, signal)
        const selection: { provider: string; model: string; reasoningEffort?: string } = model.selected; selected = selection
        if (input.action === 'retry') {
          const fresh = await prepareGeneration(io, { ...plan.frozen!.input, context: input.context },
            { providerId: selection.provider, modelId: selection.model }, binding => readPrivateSkill(binding, io))
          const { contentHash: _hash, ...body } = fresh
          const linked = { ...body, parentRunId: input.runId, ...(plan.retryNotBefore && { retryNotBefore: plan.retryNotBefore }) }
          generation = { ...linked, contentHash: digest(json(linked)) }
        } else {
          generation = plan.frozen!
          invariant(generation.snapshot.modelDescriptor.providerId === selection.provider && generation.snapshot.modelDescriptor.modelId === selection.model,
            'MODEL_SELECTION_CHANGED', '恢复需要原提供方与模型；请选择原模型，或结束旧运行后为新模型预览新任务。')
        }
        invariant(Math.ceil(generation.inputBytes / 3) + (generation.snapshot.modelDescriptor.maxOutputTokens ?? 4096) + 2000 <= model.contextWindow, 'CONTEXT_WINDOW_EXCEEDED', '恢复输入超过当前模型上下文限额。')
      }
      this.runActionPlans.set(plan.id, { plan, generation, selected, context: input.context, peerId, expires: Date.now() + 600000 })
      const stored = await readRun(io, input.runId, plan.projectId)
      return { planId: plan.id, planHash: plan.contentHash, action: input.action, runId: generation?.snapshot.runId ?? input.runId, previousRunId: input.runId,
        model: generation?.snapshot.modelDescriptor, inputBytes: generation?.inputBytes, usedModelCalls: stored.run.usedModelCalls,
        budget: generation?.snapshot.budget, skillDigests: generation?.snapshot.skillDigests, existingProposalId: plan.existingProposalId, retryNotBefore: plan.retryNotBefore,
        risks: input.action === 'close' ? ['将未结束记录标记为用户取消，保留检查点和原状态历史；不调用模型、不修改主稿、不撤销已接受建议。'] :
          plan.existingProposalId ? ['恢复已保存建议的终态记录；保留建议当前接受／拒绝状态，不调用模型、不重放补丁。'] : input.action === 'retry' ?
            ['创建关联新运行，保留原失败／取消终态；按当前已确认项目输入、文风、记忆和固定 Skill 重新生成待审阅建议。', '将所列资料范围发送给当前宿主模型，只有明确接受建议才修改主稿。'] :
            ['使用冻结输入和已用预算，从最后检查点继续。保存过的有效候选将复用；中断时未保存结果的调用已计费并计入预算，继续可能需要新调用。',
              '将原已确认输入发送给所列宿主模型；采用当前会话模型推理设置。不会重放已经接受的修改。'] }
    })
  }

  @Remote('runs.confirmAction')
  async runsConfirmAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.runActionPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请重新预览当前运行操作。')
      invariant(row.context.workspaceId === input.context.workspaceId && row.context.sessionId === input.context.sessionId && row.context.projectId === input.context.projectId,
        'SESSION_BINDING_CHANGED', '运行操作不属于当前项目会话。')
      const { io } = await resolveStore(this.ctx, input.context, new AbortController().signal)
      signal.throwIfAborted()
      invariant(!this.running.has(row.plan.runId), 'RUN_IN_PROGRESS', '原执行器仍运行，未接管。')
      if (row.plan.action === 'close') { this.runActionPlans.delete(input.planId); return closeRun(io, row.plan, candidate => this.ownerAlive(candidate)) }
      const generation = row.generation ?? row.plan.frozen!
      let model: Awaited<ReturnType<typeof selectedModel>> | undefined
      if (!row.plan.existingProposalId) {
        model = await selectedModel(this.ctx, input.context.sessionId, signal)
        invariant(JSON.stringify(model.selected) === JSON.stringify(row.selected), 'MODEL_SELECTION_CHANGED', '确认期间宿主模型设置改变。')
      }
      // Retry validation has no mutation. The new run rechecks its own inputs
      // and active projection under the same project writer lock.
      if (row.plan.action === 'retry') await validateRunAction(io, row.plan, candidate => this.ownerAlive(candidate))
      const controller = new AbortController(), runId = generation.snapshot.runId
      const active = { controller, context: input.context, pauseRequested: false }
      invariant(!this.running.has(runId), 'RUN_IN_PROGRESS', '此运行已经执行。')
      this.running.set(runId, active); this.runActionPlans.delete(input.planId)
      try { return await executeGeneration(io, generation, { pid: process.pid, bootInstance: this.bootInstance }, AbortSignal.any([signal, controller.signal]),
        call => { invariant(model, 'MODEL_NOT_SELECTED', '恢复已有产物不应调用模型。'); return callStageModel(this.ctx, model.session, model.selected, call) },
        candidate => this.ownerAlive(candidate), { pauseRequested: () => active.pauseRequested, executionSessionId: input.context.sessionId,
          ...(row.plan.action === 'resume' && { resume: row.plan }), ...(row.plan.action === 'retry' && { retry: row.plan }) }) }
      finally { this.running.delete(runId) }
    })
  }

  @Remote('runs.dismissAction')
  async runsDismissAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ planId: z.string().min(1).max(200) }).strict().parse(request)
      signal.throwIfAborted(); if (this.runActionPlans.get(input.planId)?.peerId === peerId) this.runActionPlans.delete(input.planId)
      return { dismissed: true }
    })
  }

  @Remote('runs.cancel')
  async runsCancel(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = runControlRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal), active = this.running.get(input.runId)
      if (active) {
        invariant(active.context.projectId === input.context.projectId && active.context.workspaceId === input.context.workspaceId && active.context.sessionId === input.context.sessionId,
          'SESSION_BINDING_CHANGED', '取消操作不属于当前会话运行。')
        active.controller.abort('user-cancel'); return { runId: input.runId, cancellationRequested: true }
      }
      const stored = await readRun(io, input.runId, input.context.projectId!)
      return { run: stored.run, legacyStorage: stored.legacy, cancellationRequested: false }
    })
  }

  @Remote('runs.inspect')
  async runsInspect(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = runControlRequest.parse(request), { io } = await resolveStore(this.ctx, input.context, signal)
      const stored = await readRun(io, input.runId, input.context.projectId!)
      if (stored.run.stage === 'research') { const data = await readResearchBatch(io, input.runId)
        return { run: data.stored.run, legacyStorage: false, checkpoint: { usedQueries: data.checkpoint.queriesUsed, candidatesReceived: data.checkpoint.candidatesReceived } } }
      const progress = stored.run.checkpointHash ? stored.run.stage === 'review' ? (await readModelReviewCheckpoint(io, stored.run)).checkpoint : (await readGenerationCheckpoint(io, stored.run)).checkpoint : undefined
      return { run: stored.run, legacyStorage: stored.legacy, checkpoint: progress && { formatAttempts: progress.formatAttempts,
        transientRetries: progress.transientRetries ?? 0, retryNotBefore: progress.retryNotBefore, savedCandidate: !!progress.output } }
    })
  }

  @Remote('runs.list')
  async runsList(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const { context } = inspectRequest.parse(request), { io } = await resolveStore(this.ctx, context, signal)
      return inspectRuns(io)
    })
  }

  @Remote('runs.prepareMigration')
  async runsPrepareMigration(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = runControlRequest.parse(request)
      mutationRevision(input.context); this.pruneSkills()
      invariant(this.runMigrationPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请完成已有运行迁移预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), plan = await prepareRunMigration(io, input.runId)
      this.runMigrationPlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, runId: plan.runId, stateHash: plan.stateHash, inputHash: plan.inputHash,
        risks: ['复制当前已结束／暂停／中断运行的状态与输入到 SPEC 约定的 run.json 和 input.json，保留完整旧记录及迁移历史。',
          '不会调用模型、重放建议或修改主稿；迁移存储不代表已经恢复执行。'] }
    })
  }

  @Remote('runs.migrate')
  async runsMigrate(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.runMigrationPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请重新预览并确认当前运行存储迁移。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId && input.context.projectId === row.plan.projectId,
        'SESSION_BINDING_CHANGED', '迁移确认不属于当前项目和会话。')
      const { io } = await resolveStore(this.ctx, input.context, signal)
      signal.throwIfAborted(); this.runMigrationPlans.delete(input.planId)
      return migrateRun(io, row.plan)
    })
  }

  @Remote('runs.dismissMigration')
  async runsDismissMigration(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ planId: z.string().min(1).max(200) }).strict().parse(request)
      signal.throwIfAborted()
      if (this.runMigrationPlans.get(input.planId)?.peerId === peerId) this.runMigrationPlans.delete(input.planId)
      return { dismissed: true }
    })
  }

  @Remote('document.inspectImport')
  async documentInspectImport(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = z.object({ context: inspectRequest.shape.context, sourcePath: relativePath }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return inspectManuscriptSource(io, input.sourcePath)
    })
  }

  @Remote('document.prepareImport')
  async documentPrepareImport(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.pruneSkills()
      const input = z.object({ context: inspectRequest.shape.context, sourcePath: relativePath, sourceHash: hash,
        mappings: z.record(z.string().min(1).max(200), z.string().regex(/^sf_[a-zA-Z0-9_]+$/u)), reason: z.string().min(1).max(4000) }).strict().parse(request)
      invariant(this.manuscriptPlans.size < 4, 'TOO_MANY_PENDING_PLANS', '请先处理已有稿件采用预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal)
      const plan = await prepareManuscriptAdoption(io, { ...input, sessionId: input.context.sessionId })
      invariant(plan.projectId === input.context.projectId && plan.ledgerRevision === mutationRevision(input.context), 'STALE_LEDGER_REVISION', '项目改变，请刷新后重新预览采用方案。')
      this.manuscriptPlans.set(plan.id, { plan, context: input.context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, sourcePath: plan.sourcePath, sourceHash: plan.sourceHash, destinationPath: plan.destinationPath,
        beforeHash: plan.beforeHash, baseRevisionId: plan.baseRevisionId, beforeText: plan.beforeText, text: plan.text,
        mappings: plan.mappings, resourceChanges: plan.resourceChanges, unmanagedMarkers: plan.unmanagedMarkers,
        reason: plan.reason, risks: ['确认会创建主稿的新修订与来源快照，保留当前稿件备份；所选原稿不修改。',
          '相对资源地址已按原稿所在目录重新计算，保持指向同一项目内目标；不读取、复制图片，也不下载外部地址。',
          '非项目引用／数字标记保留为待核对文本，不生成来源，不纳入自动 BibTeX。已有参考文献段落保留为原稿文本。',
          '图片导出仍受当前导出能力限制；导入与学术真实性核验是不同操作。已存在的未提交编辑不会自动写入此稿件。'] }
    })
  }

  @Remote('document.applyImport')
  async documentApplyImport(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = onlineConfirmRequest.parse(request), row = this.manuscriptPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请重新预览已有稿件的完整采用差异。')
      invariant(input.context.sessionId === row.context.sessionId && input.context.workspaceId === row.context.workspaceId && input.context.projectId === row.plan.projectId,
        'SESSION_BINDING_CHANGED', '稿件采用确认不属于当前会话项目。')
      const { io } = await resolveStore(this.ctx, input.context, signal)
      this.manuscriptPlans.delete(input.planId)
      return applyManuscriptAdoption(io, row.plan)
    })
  }

  @Remote('document.dismissImport')
  async documentDismissImport(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = z.object({ planId: id }).strict().parse(request)
      signal.throwIfAborted(); invariant(this.manuscriptPlans.get(input.planId)?.peerId === peerId, 'INVALID_APPROVAL', '稿件采用预览不属于当前用户。')
      this.manuscriptPlans.delete(input.planId); return { dismissed: true } })
  }

  @Remote('document.saveManual')
  async documentSaveManual(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = saveDocumentRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return saveManual(io, input.text, input.baseHash, revision) })
  }

  @Remote('editor.bufferRead')
  async editorBufferRead(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal)
      return readEditorBuffer(io, context.sessionId) })
  }

  @Remote('editor.selectionContext')
  async editorSelectionContext(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context, selection } = selectionContextRequest.parse(request)
      const { io, binding } = await resolveStore(this.ctx, context, signal)
      return { binding, snapshot: await selectionContext(io, selection) } })
  }

  @Remote('editor.bufferWrite')
  async editorBufferWrite(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context, ...input } = bufferWriteRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal)
      return writeEditorBuffer(io, context.sessionId, input) })
  }

  @Remote('review.run')
  async reviewRun(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const revision = mutationRevision(context), { io } = await resolveStore(this.ctx, context, signal)
      return runReview(io, revision) })
  }

  @Remote('review.prepareModel')
  async reviewPrepareModel(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = modelReviewRequest.parse(request); mutationRevision(input.context); this.pruneSkills()
      invariant(this.modelReviewPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有模型审查预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), model = await selectedModel(this.ctx, input.context.sessionId, signal)
      const plan = await prepareModelReview(io, input, { providerId: model.selected.provider, modelId: model.selected.model,
        ...(model.selected.reasoningEffort && { reasoningEffort: model.selected.reasoningEffort }), maxOutputTokens: model.maxOutputTokens }, binding => readPrivateSkill(binding, io))
      invariant(Math.ceil(plan.inputBytes / 3) + (plan.snapshot.modelDescriptor.maxOutputTokens ?? 4096) + 2000 <= model.contextWindow, 'CONTEXT_WINDOW_EXCEEDED', '完整审查范围超过模型上下文预算，请缩小稿件；未隐式删掉关键证据。')
      this.modelReviewPlans.set(plan.id, { plan, peerId, selected: model.selected, expires: Date.now() + 600000 })
      return this.reviewPreview(plan)
    })
  }

  private reviewPreview(plan: ModelReviewPlan) {
    return { planId: plan.id, planHash: plan.contentHash, runId: plan.snapshot.runId, model: plan.snapshot.modelDescriptor, inputBytes: plan.inputBytes,
      workflowId: plan.snapshot.workflowId,
      documentHash: plan.snapshot.documentHash, evidenceIds: plan.context.evidence.map(item => item.id), sourceIds: plan.context.sources.map(source => source.id),
      blocks: plan.context.blocks.length, budget: plan.snapshot.budget, skillDigests: plan.snapshot.skillDigests,
      assessments: plan.context.semanticScope ? ['论证', '文风', '跨节术语', '贡献项', '摘要／结论与实际正文'] : ['论证', '文风（旧冻结范围，跨节检查未执行）'],
      risks: ['向所列宿主模型发送当前全部已保存主稿、项目要求、相关论点、有效已选定位证据、已确认记忆、文风与本审查阶段固定 Skill 说明；本地模式不代表模型离线处理。',
        '只生成同版审查与问题，不修改正文或升级来源身份；未知项和未关闭问题保持可见。暂停／恢复保留调用统计，已有产物不重放。',
        '宿主会话保存模型请求与结果以供追溯，项目诊断不另存完整 Prompt；阶段最多一次格式修复和两次临时错误重试。'] }
  }

  @Remote('review.dismissModel')
  async reviewDismissModel(request: unknown) {
    return applicationResult(async () => { const peerId = this.requireOperator(), { planId } = z.object({ planId: z.string() }).strict().parse(request)
      invariant(this.modelReviewPlans.get(planId)?.peerId === peerId, 'INVALID_APPROVAL', '模型审查预览不属于当前用户。')
      this.modelReviewPlans.delete(planId); return { dismissed: true }
    })
  }

  @Remote('review.startModel')
  async reviewStartModel(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = runStartRequest.parse(request), row = this.modelReviewPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '模型审查须确认当前有效预览。')
      invariant(input.context.workspaceId === row.plan.input.context.workspaceId && input.context.sessionId === row.plan.input.context.sessionId && input.context.projectId === row.plan.snapshot.projectId,
        'SESSION_BINDING_CHANGED', '模型审查确认的项目与会话改变。')
      const model = await selectedModel(this.ctx, input.context.sessionId, signal)
      invariant(json(model.selected) === json(row.selected), 'MODEL_SELECTION_CHANGED', '宿主模型选择改变，请重新预览审查发送范围。')
      signal.throwIfAborted(); const { io } = await resolveStore(this.ctx, input.context, new AbortController().signal), runId = row.plan.snapshot.runId
      invariant(!this.running.has(runId), 'RUN_IN_PROGRESS', '此审查已经执行。')
      const active = { controller: new AbortController(), context: row.plan.input.context, pauseRequested: false }; this.running.set(runId, active); this.modelReviewPlans.delete(input.planId)
      try { const result = await executeModelReview(io, row.plan, { pid: process.pid, bootInstance: this.bootInstance }, AbortSignal.any([signal, active.controller.signal]),
        call => callStageModel(this.ctx, model.session, model.selected, call), candidate => this.ownerAlive(candidate), { pauseRequested: () => active.pauseRequested })
        return { ...result, ...await inspectReview(io) }
      } finally { this.running.delete(runId) }
    })
  }

  @Remote('review.prepareAction')
  async reviewPrepareAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = runControlRequest.extend({ action: z.enum(['resume', 'retry']) }).parse(request); mutationRevision(input.context); this.pruneSkills()
      invariant(this.modelReviewActions.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有审查恢复预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), action = await prepareModelReviewAction(io, input.runId, input.action, candidate => this.ownerAlive(candidate))
      let plan = action.frozen, selected: { provider: string; model: string; reasoningEffort?: string } | undefined
      if (!action.existingReportId) {
        const model = await selectedModel(this.ctx, input.context.sessionId, signal), selection: { provider: string; model: string; reasoningEffort?: string } = model.selected; selected = selection
        if (input.action === 'resume') invariant(selection.provider === plan.snapshot.modelDescriptor.providerId && selection.model === plan.snapshot.modelDescriptor.modelId &&
          selection.reasoningEffort === plan.snapshot.modelDescriptor.reasoningEffort, 'MODEL_SELECTION_CHANGED', '恢复须使用原审查的提供方、模型和推理设置；请恢复宿主选择或明确新建重试。')
        else plan = linkModelReviewRetry(await prepareModelReview(io, { context: input.context }, { providerId: selection.provider, modelId: selection.model,
          ...(selection.reasoningEffort && { reasoningEffort: selection.reasoningEffort }) }, binding => readPrivateSkill(binding, io)), action)
        invariant(Math.ceil(plan.inputBytes / 3) + (plan.snapshot.modelDescriptor.maxOutputTokens ?? 4096) + 2000 <= model.contextWindow, 'CONTEXT_WINDOW_EXCEEDED', '恢复的完整审查输入超过当前模型上下文预算。')
      }
      this.modelReviewActions.set(action.id, { action, plan, context: input.context, peerId, selected, expires: Date.now() + 600000 })
      return { ...this.reviewPreview(plan), planId: action.id, planHash: action.contentHash, action: input.action, originalRunId: action.runId,
        existingReportId: action.existingReportId, retryNotBefore: action.retryNotBefore, recoveredCalls: (await readRun(io, action.runId, action.projectId)).run.usedModelCalls }
    })
  }

  @Remote('review.confirmAction')
  async reviewConfirmAction(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = runStartRequest.parse(request), row = this.modelReviewActions.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.action.contentHash === input.planHash, 'INVALID_APPROVAL', '审查恢复须确认有效预览。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId && input.context.projectId === row.context.projectId,
        'SESSION_BINDING_CHANGED', '审查恢复项目或会话改变。')
      const model = row.action.existingReportId ? undefined : await selectedModel(this.ctx, input.context.sessionId, signal)
      invariant(!model || json(model.selected) === json(row.selected), 'MODEL_SELECTION_CHANGED', '确认期间宿主模型选择改变。')
      signal.throwIfAborted(); const { io } = await resolveStore(this.ctx, input.context, new AbortController().signal), runId = row.plan.snapshot.runId
      invariant(!this.running.has(runId), 'RUN_IN_PROGRESS', '原审查仍在执行。')
      const active = { controller: new AbortController(), context: row.context, pauseRequested: false }; this.running.set(runId, active); this.modelReviewActions.delete(input.planId)
      try { const result = await executeModelReview(io, row.plan, { pid: process.pid, bootInstance: this.bootInstance }, AbortSignal.any([signal, active.controller.signal]),
        call => { invariant(model, 'RUN_ARTIFACT_EXISTS', '已有报告恢复不能再次调用模型。'); return callStageModel(this.ctx, model.session, model.selected, call) }, candidate => this.ownerAlive(candidate),
        { pauseRequested: () => active.pauseRequested, executionSessionId: input.context.sessionId, ...(row.action.action === 'resume' ? { resume: row.action } : { retry: row.action }) })
        return { ...result, ...await inspectReview(io) }
      } finally { this.running.delete(runId) }
    })
  }

  @Remote('review.dismissAction')
  async reviewDismissAction(request: unknown) {
    return applicationResult(async () => { const peerId = this.requireOperator(), { planId } = z.object({ planId: z.string() }).strict().parse(request)
      invariant(this.modelReviewActions.get(planId)?.peerId === peerId, 'INVALID_APPROVAL', '审查恢复预览不属于当前用户。'); this.modelReviewActions.delete(planId); return { dismissed: true }
    })
  }

  @Remote('review.prepareManual')
  async reviewPrepareManual(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), { context } = inspectRequest.passthrough().parse(request)
      mutationRevision(context); this.pruneSkills(); invariant(this.manualReviewPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有人工复核预览。')
      const { io } = await resolveStore(this.ctx, context, signal), plan = await prepareManualReview(io, request)
      this.manualReviewPlans.set(plan.id, { plan, context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, reviewId: plan.parentReport.id, documentHash: plan.parentReport.documentHash,
        assessments: plan.request.assessments, risks: ['人工结果只覆盖同版稿件的所列检查，保留依据和原审查记录；未知项不自动通过。', '不得以人工确认绕过缺失实验、过期材料、引用不存在或其他确定性阻塞；正文、证据支持关系与来源核验状态不改变。'] }
    })
  }

  @Remote('review.submitManual')
  async reviewSubmitManual(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { const peerId = this.requireOperator(), input = profileCopyConfirmRequest.parse(request), row = this.manualReviewPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '人工复核需确认当前用户的有效预览。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId && input.context.projectId === row.context.projectId,
        'SESSION_BINDING_CHANGED', '人工复核项目或会话改变。')
      const { io } = await resolveStore(this.ctx, row.context, signal), result = await submitManualReview(io, row.plan, row.context.sessionId)
      this.manualReviewPlans.delete(input.planId); return { ...result, ...await inspectReview(io) }
    })
  }

  @Remote('review.dismissManual')
  async reviewDismissManual(request: unknown) {
    return applicationResult(async () => { const peerId = this.requireOperator(), { planId } = z.object({ planId: z.string() }).strict().parse(request)
      invariant(this.manualReviewPlans.get(planId)?.peerId === peerId, 'INVALID_APPROVAL', '人工复核预览不属于当前用户。')
      this.manualReviewPlans.delete(planId); return { dismissed: true }
    })
  }

  @Remote('requirements.upsert')
  async requirementsUpsert(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = requirementUpsertRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return upsertRequirement(io, input.requirement, mutationRevision(input.context), input.changeReason) })
  }

  @Remote('requirements.extract')
  async requirementsExtract(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = requirementExtractRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return extractRequirements(io, input.materialId, mutationRevision(input.context)) })
  }

  @Remote('requirements.remove')
  async requirementsRemove(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = requirementRemoveRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return removeRequirement(io, input.requirementId, input.reason, mutationRevision(input.context)) })
  }

  @Remote('requirements.history')
  async requirementsHistory(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal); return requirementHistory(io) })
  }

  @Remote('requirements.confirm')
  async requirementsConfirm(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = requirementConfirmRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return confirmRequirement(io, input.requirementId, input.countingPolicyId, mutationRevision(input.context)) })
  }

  @Remote('requirements.resolveConflict')
  async requirementsResolveConflict(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = requirementResolveRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return resolveRequirementConflict(io, input.requirementIds, input.selectedId, input.reason, mutationRevision(input.context)) })
  }

  @Remote('project.readText')
  async projectReadText(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = projectTextReadRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal), file = await io.read(input.path)
      invariant(file && Buffer.byteLength(file.text) <= 65536, 'PROJECT_TEXT_UNAVAILABLE', '项目指令文件缺失或超过 64 KiB。')
      return { path: input.path, text: file.text, contentHash: digest(file.text), ...(input.path.includes('/context/') &&
        { memory: await verifiedMemoryProjection(io, (await snapshot(io)).ledger, input.path, file.text) }) } })
  }

  @Remote('project.memoryHistory')
  async projectMemoryHistory(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = projectTextReadRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal), current = await snapshot(io)
      return memoryHistory(io, current.ledger.projectId, input.path) })
  }

  @Remote('project.bufferRead')
  async projectBufferRead(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context, path } = projectTextBufferReadRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal)
      return readProjectTextBuffer(io, context.sessionId, path) })
  }

  @Remote('project.bufferWrite')
  async projectBufferWrite(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context, path, ...input } = projectTextBufferWriteRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal)
      return writeProjectTextBuffer(io, context.sessionId, path, input) })
  }

  @Remote('project.saveText')
  async projectSaveText(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = projectTextSaveRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return updateProjectText(io, input.path, input.text, input.baseHash, mutationRevision(input.context), input.context.sessionId, input.changeReason) })
  }

  @Remote('project.updatePresentation')
  async projectUpdatePresentation(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const { context, baseConfigHash, ...input } = projectPresentationRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal)
      return updatePresentation(io, mutationRevision(context), baseConfigHash, input)
    })
  }

  @Remote('review.inspect')
  async reviewInspect(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal)
      return inspectReview(io) })
  }

  @Remote('review.decideIssue')
  async reviewDecideIssue(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = issueDecisionRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return decideIssue(io, input.issueId, input.state, input.reason, revision) })
  }

  @Remote('writing.locateSectionEvidence')
  async writingLocateSectionEvidence(request: unknown, signal: AbortSignal) { return applicationResult(async () => { this.requireOperator(); return this.writingController.locateSectionEvidence(request, signal) }) }
  @Remote('export.preflight')
  async exportPreflight(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), { context, format } = exportPreflightRequest.parse(request), { io } = await resolveStore(this.ctx, context, signal)
      const plan = await prepareDelivery(io, format)
      for (const [key, row] of this.exportPlans) if (row.expires < Date.now()) this.exportPlans.delete(key)
      invariant(this.exportPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有导出计划。')
      this.exportPlans.set(plan.id, { plan, context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.planHash, documentHash: plan.documentHash, revisionId: plan.revisionId,
        reviewState: plan.reviewState, reviewedAllowed: plan.reviewedAllowed, sourceIds: plan.sourceIds, unresolvedIssueIds: plan.unresolvedIssueIds,
        format: plan.format, formats: plan.formats, formatNotes: plan.formatNotes, limitations: plan.limitations }
    })
  }

  @Remote('export.create')
  async exportCreate(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = exportCreateRequest.parse(request), row = this.exportPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.planHash === input.planHash, 'INVALID_APPROVAL', '请重新预检并确认宿主生成的导出计划。')
      invariant(input.context.workspaceId === row.context.workspaceId && input.context.sessionId === row.context.sessionId && input.context.projectId === row.context.projectId,
        'SESSION_BINDING_CHANGED', '导出确认的项目或会话发生变化。')
      const { io } = await resolveStore(this.ctx, input.context, signal)
      const result = await createDelivery(io, row.plan, input.deliveryType, mutationRevision(input.context))
      this.exportPlans.delete(input.planId); return result
    })
  }

  @Remote('export.read')
  async exportRead(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator()
      const input = z.object({ context: inspectRequest.shape.context, deliveryId: z.string().regex(/^delivery_[\w]+$/) }).strict().parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return readDelivery(io, input.deliveryId) })
  }

  @Remote('document.undo')
  async documentUndo(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = undoDocumentRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return undoRevision(io, input.revisionId, input.baseHash, revision) })
  }

  @Remote('edits.list')
  async editsList(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context } = inspectRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal), { ledger } = await snapshot(io)
      return { states: Object.values(ledger.proposalStates).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50) } })
  }

  @Remote('edits.read')
  async editsRead(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = proposalRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal), { ledger } = await snapshot(io)
      invariant(ledger.proposalStates[input.proposalId], 'PROPOSAL_NOT_FOUND', '建议不属于当前项目。')
      const image = await proposalImage(io, input.proposalId)
      return { proposal: image.proposal, proposalHash: image.contentHash, state: ledger.proposalStates[input.proposalId] } })
  }

  @Remote('edits.prepareRevision')
  async editsPrepareRevision(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = proposalRevisionRequest.parse(request)
      mutationRevision(input.context); this.pruneSkills()
      invariant(this.proposalRevisionPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有候选编辑预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), plan = await prepareProposalRevision(io, input)
      this.proposalRevisionPlans.set(plan.id, { plan, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, proposal: plan.proposal, reason: plan.input.reason,
        risks: ['仅发布新的待审阅候选并保留原建议。无需模型调用；接受前核对规则、事实变化和引用，规则通过不能证明学术真实性。'] }
    })
  }

  @Remote('edits.publishRevision')
  async editsPublishRevision(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = runStartRequest.parse(request), row = this.proposalRevisionPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请确认有效的候选编辑校验预览。')
      const expected = row.plan.input.context
      invariant(input.context.workspaceId === expected.workspaceId && input.context.sessionId === expected.sessionId && input.context.projectId === expected.projectId && input.context.expectedLedgerRevision === expected.expectedLedgerRevision,
        'SESSION_BINDING_CHANGED', '候选编辑确认的会话或项目版本改变。')
      const { io } = await resolveStore(this.ctx, expected, signal), result = await publishProposalRevision(io, row.plan, expected.sessionId)
      this.proposalRevisionPlans.delete(input.planId)
      return { ...result, proposal: row.plan.proposal, state: 'pending' }
    })
  }

  @Remote('edits.dismissRevision')
  async editsDismissRevision(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ planId: id }).strict().parse(request), row = this.proposalRevisionPlans.get(input.planId)
      signal.throwIfAborted(); invariant(row && row.peerId === peerId, 'INVALID_APPROVAL', '候选编辑预览不属于当前用户。')
      this.proposalRevisionPlans.delete(input.planId); return { dismissed: true }
    })
  }

  @Remote('edits.apply')
  async editsApply(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = applyProposalRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return acceptAndRecheck(io, input.proposalId, revision, input.proposalHash) })
  }

  @Remote('edits.reject')
  async editsReject(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = proposalRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return rejectProposal(io, input.proposalId, revision) })
  }

  @Remote('materials.register')
  async materialsRegister(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = registerMaterialRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return registerMaterial(io, input, revision) })
  }

  @Remote('materials.parse')
  async materialsParse(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = parseMaterialRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return parseRegisteredMaterial(io, input.materialId, revision, signal, (bytes, mediaType) => parseMaterialBytes(bytes, mediaType, signal, input.range)) })
  }

  @Remote('materials.read')
  async materialsRead(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = readMaterialRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return readParsed(io, input.materialId) })
  }

  @Remote('sources.prepareRegistration')
  async sourcesPrepareRegistration(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = registerSourceRequest.parse(request); mutationRevision(input.context); this.pruneSkills()
      invariant(this.sourceRegistrationPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请先处理已有来源登记预览。')
      const { io } = await resolveStore(this.ctx, input.context, signal), plan = await prepareSourceRegistration(io, input)
      this.sourceRegistrationPlans.set(plan.id, { plan, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, source: plan.input.source, matches: plan.matches,
        risks: ['仅登记所列来源元数据，不查询网络、不核验出版身份、不迁移证据或合并正文引用。', '无版本号的 arXiv 标识指向最新版本，不能据此把不同本地文本视为相同。'] }
    })
  }

  @Remote('sources.confirmRegistration')
  async sourcesConfirmRegistration(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = runStartRequest.extend({ reason: z.string().trim().max(4000).default('') }).parse(request), row = this.sourceRegistrationPlans.get(input.planId)
      invariant(row && row.peerId === peerId && row.expires > Date.now() && row.plan.contentHash === input.planHash, 'INVALID_APPROVAL', '请确认有效的来源登记预览。')
      const expected = row.plan.input.context
      invariant(input.context.workspaceId === expected.workspaceId && input.context.sessionId === expected.sessionId && input.context.projectId === expected.projectId && input.context.expectedLedgerRevision === expected.expectedLedgerRevision,
        'SESSION_BINDING_CHANGED', '来源确认的项目、会话或版本改变。')
      const { io } = await resolveStore(this.ctx, expected, signal), result = await confirmSourceRegistration(io, row.plan, input.reason, expected.sessionId)
      this.sourceRegistrationPlans.delete(input.planId); return result
    })
  }

  @Remote('sources.dismissRegistration')
  async sourcesDismissRegistration(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = z.object({ planId: id }).strict().parse(request), row = this.sourceRegistrationPlans.get(input.planId)
      signal.throwIfAborted(); invariant(row && row.peerId === peerId, 'INVALID_APPROVAL', '来源预览不属于当前用户。')
      this.sourceRegistrationPlans.delete(input.planId); return { dismissed: true }
    })
  }

  @Remote('sources.register')
  async sourcesRegister(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = registerSourceRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return registerSource(io, input.source, revision) })
  }

  @Remote('evidence.confirm')
  async evidenceConfirm(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const { context, ...input } = confirmEvidenceRequest.parse(request)
      const revision = mutationRevision(context), { io } = await resolveStore(this.ctx, context, signal)
      return confirmEvidence(io, input, revision) })
  }

  @Remote('claims.upsert')
  async claimsUpsert(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = upsertClaimRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return upsertClaim(io, input.claim, revision) })
  }

  @Remote('outline.confirm')
  async outlineConfirm(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = confirmOutlineRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return confirmOutline(io, input.outline, revision, input.expectedOutlineVersion) })
  }

  @Remote('outline.save')
  async outlineSave(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = confirmOutlineRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return saveOutline(io, input.outline, revision, input.expectedOutlineVersion, 'draft') })
  }

  @Remote
  diagnostics() {
    const ctx = this.ctx as Host
    return { version: '1.0.0', protocol: 1, node: process.versions.node,
      services: Object.fromEntries(['fs', 'sandboxPolicy', 'sessionController', 'workspaceRegistry', 'settings', 'llm']
        .map(key => [key, !!ctx.get(key)])),
      settings: ctx.settings.describe({ redactSecrets: true }).filter((row: Host) => row.ns === 'scholarflow'),
      workspaces: ctx.workspaceRegistry.list().map((w: Host) => ({ id: w.id, title: w.title, sessionIds: [...w.sessionIds] })),
    }
  }

  // A G0-only endpoint. Never exposed in normal desktop processes or to model tools.
  @Remote
  async verifyPresetSwitch(request: unknown) {
    this.requireOperator()
    invariant(process.env.SCHOLARFLOW_G0_VERIFY === '1', 'UNSUPPORTED_DSH_CAPABILITY', '此接口仅供隔离 G0 验证。')
    const ctx = this.ctx as Host, { sessionId } = sessionRequest.parse(request)
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (resolved.error) throw resolved.error
    const agent = resolved.agent
    const original = ctx.agentPresets.composedPreset(agent.ctx)
    invariant(original === 'standard', 'INVALID_REQUEST', '测试只允许使用空白 standard 会话。')
    let dispose: (() => void) | undefined
    try {
      await ctx.agentPresets.select(agent, 'scholarflow')
      const academicTools = ctx.tools.schemas(agent).map((tool: Host) => tool.name)
      // Prove a tool registered after the preset mounted is masked too.
      const template = ctx.tools.get(academicTools[0], agent)
      dispose = ctx.tools.register({ ...template, name: 'TEST_ONLY_late_global', description: 'TEST_ONLY never executed',
        execute: async () => { throw new Error('TEST_ONLY forbidden body') } })
      const lateGlobalHidden = !ctx.tools.schemas(agent).some((tool: Host) => tool.name === 'TEST_ONLY_late_global')
      dispose?.(); dispose = undefined
      await ctx.agentPresets.select(agent, 'standard')
      const ordinaryTools = ctx.tools.schemas(agent).map((tool: Host) => tool.name)
      const ordinaryPrompt = await ctx.systemPrompt.assemble({ scope: agent, agent })
      return { academicTools, lateGlobalHidden, ordinaryTools,
        ordinaryPolicyAbsent: !ordinaryPrompt.sections.some((section: Host) => section.name === 'scholarflow:policy') }
    } finally {
      dispose?.()
      if (ctx.agentPresets.composedPreset(agent.ctx) !== original) await ctx.agentPresets.select(agent, original)
    }
  }

  @Remote
  async verifyOrdinaryCatalog(request: unknown, signal: AbortSignal) {
    this.requireOperator()
    invariant(process.env.SCHOLARFLOW_G0_VERIFY === '1', 'UNSUPPORTED_DSH_CAPABILITY', '此接口仅供隔离 G0 验证。')
    const ctx = this.ctx as Host, { sessionId } = sessionRequest.parse(request)
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (resolved.error) throw resolved.error
    const agent = resolved.agent
    invariant(ctx.agentPresets.composedPreset(agent.ctx) === 'standard', 'INVALID_REQUEST', '目录检查仅限普通会话。')
    const observed = await ctx.skills.snapshot({ cwd: agent.session.header.cwd, scope: agent, signal })
    // The actual tool-skill consumer advertises only model-invocable entries.
    // Return routing metadata only, never instructions or private paths.
    return { complete: observed.complete, entries: observed.skills.filter((skill: Host) => skill.invocation.modelInvocable)
      .map((skill: Host) => ({ name: skill.name, description: skill.description, provider: skill.provider })) }
  }

  @Remote
  async verifyAcademicTools(request: unknown, signal: AbortSignal) {
    this.requireOperator()
    invariant(process.env.SCHOLARFLOW_G0_VERIFY === '1', 'UNSUPPORTED_DSH_CAPABILITY', '此接口仅供隔离 G0 验证。')
    const ctx = this.ctx as Host, { sessionId } = sessionRequest.parse(request)
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (resolved.error) throw resolved.error
    const agent = resolved.agent
    const call = (name: string, args: unknown) => ctx.tools.execute({ callId: newId('call'), name, arguments: args, agent, signal })
    const inspect = await call('scholar_project', { action: 'inspect' })
    const manuscript = await call('scholar_manuscript', { action: 'read' })
    const forged = await call('scholar_project', { action: 'inspect', workspaceId: 'workspace_TEST_ONLY_forged', root: 'C:/' })
    const shell = await call('bash', { command: 'echo TEST_ONLY_FORBIDDEN' })
    const prompt = await ctx.systemPrompt.assemble({ scope: agent, agent, signal })
    return { projectId: inspect.value?.data?.project?.id, inspectOk: !inspect.isError && inspect.value?.ok === true,
      manuscriptOk: !manuscript.isError && manuscript.value?.ok === true,
      documentHash: manuscript.value?.data?.documentHash,
      forgedDenied: forged.isError || forged.value?.ok === false,
      shellDenied: shell.isError,
      scopedPolicy: prompt.sections.length === 1 && prompt.sections[0].name === 'scholarflow:policy',
      promptTools: prompt.tools.map((tool: Host) => tool.name) }
  }

  @Remote
  async verifySkillScope(request: unknown, signal: AbortSignal) {
    this.requireOperator()
    invariant(process.env.SCHOLARFLOW_G0_VERIFY === '1', 'UNSUPPORTED_DSH_CAPABILITY', '此接口仅供隔离 G0 验证。')
    const ctx = this.ctx as Host, input = z.object({ sessionId: z.string(), bindingId: z.string() }).strict().parse(request)
    const resolved = await ctx.sessionController.resolveAgent(input.sessionId)
    if (resolved.error) throw resolved.error
    const call = (args: unknown) => ctx.tools.execute({ callId: newId('call'), name: 'scholar_skill', arguments: args, agent: resolved.agent, signal })
    const list = await call({ action: 'list' }), read = await call({ action: 'read', bindingId: input.bindingId })
    const script = await call({ action: 'read', bindingId: input.bindingId, resourcePath: 'scripts/no-run.js' })
    return { stage: list.value?.data?.stage, skills: list.value?.data?.skills, readOk: !read.isError && read.value?.ok === true,
      readError: read.value?.error?.code, contentHash: read.value?.data?.content ? digest(read.value.data.content) : undefined,
      scriptDenied: script.value?.ok === false }
  }

  @Remote
  async verifyGateway(request: unknown, signal: AbortSignal) {
    const ctx = this.ctx as Host
    this.requireOperator()
    if (process.env.SCHOLARFLOW_G0_VERIFY !== '1')
      throw new Error('UNSUPPORTED_DSH_CAPABILITY: verification requires isolated authenticated G0 Host')
    const { sessionId } = sessionRequest.parse(request)
    const { meta } = await ctx.sessionController.inspect(sessionId, signal)
    const root = await ctx.fs.resolve(meta.cwd, { signal })
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (resolved.error) throw resolved.error
    const session = resolved.agent.session
    if (!session || session.header.cwd !== meta.cwd) throw new Error('SESSION_BINDING_CHANGED')
    const policy = ctx.sandboxPolicy.resolve({ session })
    const relativePath = `.scholarflow-g0/verified-${randomUUID()}.txt`
    const target = await ctx.fs.resolve(join(meta.cwd, relativePath), { signal })
    if (!ctx.fs.contains(root, target)) throw new Error('PATH_OUTSIDE_ALLOWED_ROOT')
    const outcome = await ctx.fs.writeText(target, 'ScholarFlow G0 authorized filesystem verification\n',
      { kind: 'createIfAbsent' }, signal, policy)
    const read = await ctx.fs.readText(target, signal)
    const prompt = await ctx.systemPrompt.assemble({ scope: resolved.agent, agent: resolved.agent, signal })
    return { sessionId, mode: policy.mode, relativePath, root: meta.cwd, target: target.displayPath, version: outcome.version,
      recovered: read === 'ScholarFlow G0 authorized filesystem verification\n',
      allowedTools: ctx.tools.schemas(resolved.agent).map((tool: Host) => tool.name),
      hasAcademicPolicy: prompt.sections.some((section: Host) => section.name === 'scholarflow:policy'),
      globalToolCount: ctx.tools.schemas().length }
  }
}

export function apply(ctx: Host) {
  ctx.effect(() => ctx.settings.configure({ auto: false }), 'scholarflow: settings policy')
  ctx.plugin(ScholarFlowRemote)
}
