import Schema from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { applicationResult, inspectProject, inspectRequest, prepareInitRequest, initializeRequest, resolveStore, type StoredInitPlan } from './bridge/project-api.ts'
import { prepareInit, initialize, snapshot, updateProjectText } from '../core/project/project.ts'
import { recover } from '../core/store/transactions.ts'
import { newId, digest } from '../core/store/files.ts'
import { invariant } from '../shared/errors.ts'
import { scanRequest, registerMaterialRequest, parseMaterialRequest, readMaterialRequest } from '../shared/materials.ts'
import { registerSourceRequest, confirmEvidenceRequest, upsertClaimRequest, confirmOutlineRequest } from '../shared/research.ts'
import { scanMaterials, registerMaterial, readParsed } from '../core/materials/materials.ts'
import { parseRegisteredMaterial } from '../core/materials/parse.ts'
import { parseMaterialBytes } from './parsers/parse.ts'
import { registerSource, confirmEvidence, upsertClaim, confirmOutline } from '../core/evidence/evidence.ts'
import type { RequestContext } from '../shared/schema.ts'
import { saveDocumentRequest, proposalRequest, applyProposalRequest, undoDocumentRequest } from '../shared/document-api.ts'
import { saveManual, applyProposal, rejectProposal, undoRevision, proposalImage } from '../core/editing/proposals.ts'
import { wordStats } from '../core/editing/markdown.ts'
import { generationRequest, runStartRequest, runControlRequest, runStateSchema } from '../shared/runs.ts'
import { prepareGeneration, executeGeneration, type GenerationPlan } from '../core/pipeline/generation.ts'
import { selectedModel, callStageModel } from './executor/model.ts'
import { runReview, inspectReview, decideIssue } from '../core/review/review.ts'
import { prepareDelivery, createDelivery, readDelivery, type DeliveryPlan } from '../core/export/delivery.ts'
import { issueDecisionRequest, exportCreateRequest } from '../shared/review.ts'
import { requirementUpsertRequest, requirementExtractRequest, requirementConfirmRequest, requirementResolveRequest, projectTextReadRequest, projectTextSaveRequest } from '../shared/requirements.ts'
import { upsertRequirement, extractRequirements, confirmRequirement, resolveRequirementConflict } from '../core/requirements/requirements.ts'
import { bufferWriteRequest } from '../shared/editor-buffer.ts'
import { readEditorBuffer, writeEditorBuffer } from '../core/editing/buffer.ts'
import { searchPrepareRequest, onlineConfirmRequest, candidateDecisionRequest, lookupPrepareRequest, type ResearchProvider } from '../shared/online-research.ts'
import { crossrefProvider } from './providers/crossref.ts'
import { prepareSearch, executeSearch, listSearches, readSearch, decideCandidate, prepareLookup, executeLookup, type SearchPlan, type LookupPlan } from '../core/research/online.ts'
import { PrivateSkillLibrary } from './skills/library.ts'
import { LocalSkillSource } from './skills/local.ts'
import { skillOptions, type SkillBundle } from '../shared/skills.ts'
import { hash } from '../shared/schema.ts'
import { githubLocation, githubSkills, type GithubDiscovery, type GithubSkillPreview } from './skills/github.ts'
import { prepareBindings, applyBindings, readBindings, currentSkillStage, selectSkillStage, type BindingPlan } from '../core/skills/bindings.ts'
import { readPrivateSkill, libraryEntry, builtinSkills } from './skills/reader.ts'
import { stage } from '../shared/schema.ts'
import type { ResourceBinding } from '../shared/skills.ts'
import { knownSkillReferences } from './skills/references.ts'
import { anchorUpsertRequest } from '../shared/editing.ts'
import { upsertAnchor } from '../core/editing/anchors.ts'

// Runtime-owned Cordis objects stay inside this adapter. Core never imports them.
type Host = any
export const name = 'scholarflow'
export const inject = ['fs', 'sandboxPolicy', 'workspaceRegistry', 'sessionController', 'sessions', 'settings', 'connection', 'tools', 'systemPrompt', 'agentPresets', 'llm', 'agentDefaultModel', 'sessionProjections', 'web']
export const Config = Schema.object({
  defaultProjectType: Schema.union(['course-paper', 'literature-review', 'research-paper']).default('course-paper').volatile(),
  language: Schema.union(['zh', 'en']).default('zh').volatile(),
  networkEnabled: Schema.boolean().default(false).volatile(),
  maxModelCalls: Schema.number().min(1).max(40).default(40).volatile(),
})
const sessionRequest = z.object({ sessionId: z.string().min(1).max(200) }).strict()
const mutationRevision = (context: RequestContext) => {
  invariant(context.projectId && context.expectedLedgerRevision !== undefined, 'INVALID_REQUEST', '项目变更需要项目身份和预期 ledger 版本。')
  return context.expectedLedgerRevision
}

export class ScholarFlowRemote extends TypertRemoteService {
  private initPlans = new Map<string, StoredInitPlan>()
  private recoveryPlans = new Map<string, { context: StoredInitPlan['context']; peerId: string; hash: string; expires: number }>()
  private generationPlans = new Map<string, { plan: GenerationPlan; peerId: string; expires: number; selected: { provider: string; model: string; reasoningEffort?: string } }>()
  private running = new Map<string, { controller: AbortController; context: RequestContext }>()
  private exportPlans = new Map<string, { plan: DeliveryPlan; context: RequestContext; peerId: string; expires: number }>()
  private bootInstance = randomUUID()
  private researchProvider: ResearchProvider
  private searchPlans = new Map<string, { plan: SearchPlan; context: RequestContext; peerId: string; expires: number }>()
  private lookupPlans = new Map<string, { plan: LookupPlan; context: RequestContext; peerId: string; expires: number }>()
  private skillLibrary = new PrivateSkillLibrary()
  private skillSources = new Map<string, { source: LocalSkillSource; candidates: string[]; peerId: string; expires: number }>()
  private githubSources = new Map<string, { discovery: GithubDiscovery; peerId: string; expires: number }>()
  private skillPlans = new Map<string, { resource: { kind: 'local'; bundle: SkillBundle } | { kind: 'github'; preview: GithubSkillPreview }; hash: string; peerId: string; expires: number }>()
  private githubProvider: ReturnType<typeof githubSkills>
  private preparingSkill = false
  private bindingPlans = new Map<string, { plan: BindingPlan; context: RequestContext; peerId: string; expires: number }>()
  private retirementPlans = new Map<string, { qualifiedId: string; digest: string; observationHash: string; hash: string; peerId: string; expires: number }>()
  constructor(ctx: Host) {
    super(ctx, 'scholarflow', { namespace: 'scholarflow.v1' })
    this.researchProvider = crossrefProvider(ctx.web)
    this.githubProvider = githubSkills(ctx.web)
    ctx.effect(() => () => { for (const active of this.running.values()) active.controller.abort('plugin-unload') }, 'scholarflow: stop owned stages')
    ctx.effect(() => {
      const timer = setInterval(() => this.pruneSkills(), 60000)
      timer.unref()
      return () => { clearInterval(timer); this.skillPlans.clear(); this.skillSources.clear(); this.githubSources.clear(); this.bindingPlans.clear(); this.retirementPlans.clear() }
    }, 'scholarflow: expire operator skill previews')
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
      return result
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
      const { io, manuscriptDir } = await resolveStore(this.ctx, plan.context, signal)
      await io.lock(() => recover(io, manuscriptDir, plan.hash))
      this.recoveryPlans.delete(parsed.planId)
      return inspectProject(this.ctx, { context: plan.context }, signal)
    })
  }

  @Remote('project.prepareInit')
  async projectPrepareInit(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator()
      const { context, input } = prepareInitRequest.parse(request)
      const { io } = await resolveStore(this.ctx, context, signal, input.manuscriptDir)
      const plan = await prepareInit(io, input)
      for (const [id, row] of this.initPlans) if (row.expires < Date.now()) this.initPlans.delete(id)
      invariant(this.initPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有初始化计划。')
      this.initPlans.set(plan.id, { plan, context, peerId, expires: Date.now() + 10 * 60 * 1000 })
      return { planId: plan.id, planHash: plan.contentHash, project: plan.config.project,
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

  private pruneSkills() {
    for (const [key, row] of this.skillSources) if (row.expires < Date.now()) this.skillSources.delete(key)
    for (const [key, row] of this.githubSources) if (row.expires < Date.now()) this.githubSources.delete(key)
    for (const [key, row] of this.skillPlans) if (row.expires < Date.now()) this.skillPlans.delete(key)
    for (const [key, row] of this.bindingPlans) if (row.expires < Date.now()) this.bindingPlans.delete(key)
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
        try { const bundle = await readPrivateSkill(binding); resources.push({ binding, metadata: bundle.manifest.metadata, available: true }) }
        catch { resources.push({ binding, available: false, warning: '固定资源缺失或改变；需要重新导入原版本，未改用最新版本。' }) }
      }
      const installed = await this.skillLibrary.list()
      return { resources, legacyMigration: locked.legacyMigration, stage, installed: { ...installed,
        versions: [...await builtinSkills(), ...installed.versions.map(manifest => ({ ...manifest, scope: 'library' }))] } }
    })
  }

  @Remote('skills.prepareBindings')
  async skillsPrepareBindings(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(); this.pruneSkills()
      const input = z.object({ context: inspectRequest.shape.context, selections: z.array(z.object({ qualifiedId: z.string().max(1000), digest: hash, scope: z.enum(['library', 'builtin']).default('library'),
        enabledStages: z.array(stage).min(1).max(7) }).strict()).max(30) }).strict().parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      invariant(this.bindingPlans.size < 8, 'TOO_MANY_PENDING_PLANS', '请完成已有项目绑定预览。')
      const bindings: ResourceBinding[] = [], metadata = []
      for (const selection of input.selections) {
        const asset = selection.scope === 'builtin' ? (await builtinSkills()).find(row => row.metadata.qualifiedId === selection.qualifiedId && row.digest === selection.digest) : undefined
        invariant(selection.scope !== 'builtin' || asset?.origin.kind === 'builtin', 'SKILL_RESOURCE_MISSING', '所选内置版本不存在。')
        const entryPath = asset?.origin.kind === 'builtin' ? asset.origin.asset : libraryEntry(selection.qualifiedId, selection.digest)
        const bundle = await readPrivateSkill({ bindingId: 'binding_preview', qualifiedId: selection.qualifiedId, digest: selection.digest, scope: selection.scope,
          entryPath, enabledStages: selection.enabledStages })
        const binding: ResourceBinding = { bindingId: newId('binding'), qualifiedId: selection.qualifiedId, digest: selection.digest, scope: selection.scope,
          entryPath, enabledStages: selection.enabledStages,
          ...(bundle.manifest.origin.kind === 'github' && { origin: { repository: bundle.manifest.origin.repository, commit: bundle.manifest.origin.commit,
            subpath: bundle.manifest.origin.subpath, ...(bundle.manifest.origin.license && { license: bundle.manifest.origin.license }) } }) }
        bindings.push(binding); metadata.push(bundle.manifest.metadata)
      }
      const plan = await prepareBindings(io, bindings, readPrivateSkill)
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
        for (const binding of row.plan.bindings) await readPrivateSkill(binding)
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
      return executeSearch(io, row.plan, this.researchProvider, AbortSignal.any([signal, AbortSignal.timeout(25000)]))
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
      return executeLookup(io, row.plan, this.researchProvider, AbortSignal.any([signal, AbortSignal.timeout(25000)]))
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

  @Remote('writing.prepare')
  async writingPrepare(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), input = generationRequest.parse(request)
      mutationRevision(input.context)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      const model = await selectedModel(this.ctx, input.context.sessionId, signal)
      const plan = await prepareGeneration(io, input, { providerId: model.selected.provider, modelId: model.selected.model }, readPrivateSkill)
      invariant(plan.inputBytes + 6096 <= model.contextWindow, 'CONTEXT_WINDOW_EXCEEDED', '选定范围超过模型上下文预算；请缩小章节和证据范围，未截掉关键证据继续生成。')
      for (const [key, row] of this.generationPlans) if (row.expires < Date.now()) this.generationPlans.delete(key)
      invariant(this.generationPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有生成计划。')
      this.generationPlans.set(plan.id, { plan, selected: model.selected, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.contentHash, runId: plan.snapshot.runId, model: plan.snapshot.modelDescriptor, stage: plan.snapshot.stage,
        inputBytes: plan.inputBytes, evidenceIds: plan.evidenceIds, budget: plan.snapshot.budget, skillDigests: plan.snapshot.skillDigests,
        scope: input.selection ? input.selection.sourceRange : plan.sectionTarget ? { startUtf16: plan.sectionTarget.startUtf16, endUtf16: plan.sectionTarget.endUtf16 } : { startUtf16: 0, endUtf16: (await snapshot(io)).document.text.length },
        sectionTarget: plan.sectionTarget, sourceText: input.selection?.sourceText, risks: [
          ...(plan.sectionTarget ? ['本节候选仅修改上述范围；为核对摘要、结论与跨节一致性，同时向模型发送当前全部已保存主稿。待补项不能作为已有结果。'] : []),
          '将选定证据、当前稿件范围、项目文风、确认记忆和当前阶段固定 Skill 说明／文本参考发送给所列宿主模型提供方；本地资料模式不等于模型离线处理。',
          '生成结果为待审阅建议，接受前不会改写主稿。宿主会话日志保留模型请求以供追溯；项目诊断日志不另存完整 Prompt。'] }
    })
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
      this.running.set(runId, { controller, context: row.plan.input.context })
      this.generationPlans.delete(input.planId)
      const owner = { pid: process.pid, bootInstance: this.bootInstance }
      try {
        return await executeGeneration(io, row.plan, owner, AbortSignal.any([signal, controller.signal]),
          call => callStageModel(this.ctx, model.session, model.selected, call), candidate => {
            if (candidate.pid === process.pid) return candidate.bootInstance === this.bootInstance
            try { process.kill(candidate.pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
          })
      } finally { this.running.delete(runId) }
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
      const file = await io.read(`.scholarflow/runs/${input.runId}/state.json`)
      invariant(file, 'RUN_NOT_FOUND', '运行不存在。')
      return { run: runStateSchema.parse(JSON.parse(file.text)), cancellationRequested: false }
    })
  }

  @Remote('runs.inspect')
  async runsInspect(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      this.requireOperator(); const input = runControlRequest.parse(request), { io } = await resolveStore(this.ctx, input.context, signal)
      const file = await io.read(`.scholarflow/runs/${input.runId}/state.json`)
      invariant(file, 'RUN_NOT_FOUND', '运行尚未登记或不存在。')
      return { run: runStateSchema.parse(JSON.parse(file.text)) }
    })
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

  @Remote('requirements.upsert')
  async requirementsUpsert(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = requirementUpsertRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return upsertRequirement(io, input.requirement, mutationRevision(input.context)) })
  }

  @Remote('requirements.extract')
  async requirementsExtract(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = requirementExtractRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return extractRequirements(io, input.materialId, mutationRevision(input.context)) })
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
      return { path: input.path, text: file.text, contentHash: digest(file.text) } })
  }

  @Remote('project.saveText')
  async projectSaveText(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = projectTextSaveRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return updateProjectText(io, input.path, input.text, input.baseHash, mutationRevision(input.context), input.context.sessionId) })
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

  @Remote('export.preflight')
  async exportPreflight(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => {
      const peerId = this.requireOperator(), { context } = inspectRequest.parse(request), { io } = await resolveStore(this.ctx, context, signal)
      const plan = await prepareDelivery(io)
      for (const [key, row] of this.exportPlans) if (row.expires < Date.now()) this.exportPlans.delete(key)
      invariant(this.exportPlans.size < 100, 'TOO_MANY_PENDING_PLANS', '请先处理已有导出计划。')
      this.exportPlans.set(plan.id, { plan, context, peerId, expires: Date.now() + 600000 })
      return { planId: plan.id, planHash: plan.planHash, documentHash: plan.documentHash, revisionId: plan.revisionId,
        reviewState: plan.reviewState, reviewedAllowed: plan.reviewedAllowed, sourceIds: plan.sourceIds, unresolvedIssueIds: plan.unresolvedIssueIds,
        formats: plan.formats, limitations: plan.limitations }
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

  @Remote('edits.apply')
  async editsApply(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = applyProposalRequest.parse(request)
      const revision = mutationRevision(input.context), { io } = await resolveStore(this.ctx, input.context, signal)
      return applyProposal(io, input.proposalId, revision, input.proposalHash) })
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

  @Remote
  diagnostics() {
    const ctx = this.ctx as Host
    return { version: '0.1.0-dev', protocol: 1, node: process.versions.node,
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
