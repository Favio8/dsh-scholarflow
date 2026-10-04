import Schema from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { applicationResult, inspectProject, inspectRequest, prepareInitRequest, initializeRequest, resolveStore, type StoredInitPlan } from './bridge/project-api.ts'
import { prepareInit, initialize } from '../core/project/project.ts'
import { recover } from '../core/store/transactions.ts'
import { newId } from '../core/store/files.ts'
import { invariant } from '../shared/errors.ts'
import { scanRequest, registerMaterialRequest, parseMaterialRequest, readMaterialRequest } from '../shared/materials.ts'
import { registerSourceRequest, confirmEvidenceRequest, upsertClaimRequest, confirmOutlineRequest } from '../shared/research.ts'
import { scanMaterials, registerMaterial, readParsed } from '../core/materials/materials.ts'
import { parseRegisteredMaterial } from '../core/materials/parse.ts'
import { parseMaterialBytes } from './parsers/parse.ts'
import { registerSource, confirmEvidence, upsertClaim, confirmOutline } from '../core/evidence/evidence.ts'
import type { RequestContext } from '../shared/schema.ts'

// Runtime-owned Cordis objects stay inside this adapter. Core never imports them.
type Host = any
export const name = 'scholarflow'
export const inject = ['fs', 'sandboxPolicy', 'workspaceRegistry', 'sessionController', 'sessions', 'settings', 'connection', 'tools']
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
  constructor(ctx: Host) { super(ctx, 'scholarflow', { namespace: 'scholarflow.v1' }) }

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

  @Remote('materials.scan')
  async materialsScan(request: unknown, signal: AbortSignal) {
    return applicationResult(async () => { this.requireOperator(); const input = scanRequest.parse(request)
      const { io } = await resolveStore(this.ctx, input.context, signal)
      return scanMaterials(io, input.directory, input.cursor, input.limit) })
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
  async verifyGateway(request: unknown, signal: AbortSignal) {
    const ctx = this.ctx as Host
    if (process.env.SCHOLARFLOW_G0_VERIFY !== '1' || !ctx.invocation?.peer)
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
    return { sessionId, mode: policy.mode, relativePath, root: meta.cwd, target: target.displayPath, version: outcome.version,
      recovered: read === 'ScholarFlow G0 authorized filesystem verification\n',
      allowedTools: ctx.tools.schemas(resolved.agent).map((tool: Host) => tool.name),
      globalToolCount: ctx.tools.schemas().length }
  }
}

export function apply(ctx: Host) {
  ctx.effect(() => ctx.settings.configure({ auto: false }), 'scholarflow: settings policy')
  ctx.plugin(ScholarFlowRemote)
}
