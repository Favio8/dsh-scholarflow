import { z } from 'zod'
import { requestContext, projectType, relativePath, hash, type RequestContext } from '../../shared/schema.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { digest } from '../../core/store/files.ts'
import { snapshot, parseConfig, CONFIG_PATH, type InitPlan } from '../../core/project/project.ts'
import { readTransactionJournals, inspectRecovery } from '../../core/store/transactions.ts'
import { HostFileStore } from '../gateway/file-store.ts'
type Host = any
export const inspectRequest = z.object({ context: requestContext }).strict()
export const prepareInitRequest = z.object({ context: requestContext, input: z.object({ title: z.string().min(1).max(300), type: projectType, language: z.enum(['zh-CN', 'en']).optional(), manuscriptDir: relativePath.optional() }).strict() }).strict()
export const initializeRequest = z.object({ context: requestContext, planId: z.string(), planHash: hash }).strict()
export interface StoredInitPlan { plan: InitPlan; context: RequestContext; peerId: string; expires: number }

export async function resolveStore(ctx: Host, context: RequestContext, signal: AbortSignal, output?: string) {
  signal.throwIfAborted()
  const workspace = ctx.workspaceRegistry.get(context.workspaceId)
  invariant(workspace, 'SESSION_BINDING_CHANGED', '宿主工作区不存在，请重新选择。')
  const observation = await ctx.sessionController.inspect(context.sessionId, signal)
  invariant(observation?.meta, 'SESSION_BINDING_CHANGED', '宿主会话不存在。')
  const target = await ctx.fs.resolve(workspace.path, { signal })
  const root = ctx.fs.processPath(target)
  invariant(!root.startsWith('\\\\'), 'PATH_OUTSIDE_ALLOWED_ROOT', '当前版本尚未验证 UNC 工作区。')
  const sessionTarget = await ctx.fs.resolve(observation.meta.cwd, { signal })
  invariant(ctx.fs.processPath(sessionTarget) === root && workspace.sessionIds.includes(context.sessionId), 'SESSION_BINDING_CHANGED', '会话不属于当前工作区。')
  let mode = observation.meta.agentPreset
  for (const event of observation.events) if (event.type === 'agent-preset/selected') mode = event.data.agentPreset
  invariant(mode === 'scholarflow', 'MODE_NOT_SCHOLARFLOW', '请为当前工作区创建 ScholarFlow 会话。')
  let manuscriptDir = output ?? 'manuscript'
  const configTarget = await ctx.fs.resolve(`${root}/.scholarflow/project.yaml`, { signal })
  invariant(ctx.fs.contains(target, configTarget), 'PATH_OUTSIDE_ALLOWED_ROOT', '项目配置链接超出工作区。')
  const stat = await ctx.fs.stat(configTarget, signal)
  let projectId: string | undefined
  const checkCopies = async (identity: string) => {
    for (const other of ctx.workspaceRegistry.list()) {
      if (other.id === workspace.id) continue
      const otherRoot = await ctx.fs.resolve(other.path, { signal })
      if (ctx.fs.processPath(otherRoot) === root) continue
      const otherConfig = await ctx.fs.resolve(`${other.path}/.scholarflow/project.yaml`, { signal })
      if (!ctx.fs.contains(otherRoot, otherConfig) || !await ctx.fs.stat(otherConfig, signal)) continue
      let candidate
      try { candidate = parseConfig(await ctx.fs.readText(otherConfig, signal)) } catch { continue }
      invariant(candidate.project.id !== identity, 'PROJECT_ID_CONFLICT', '同一宿主存在项目身份相同的副本，请先为副本建立独立身份。')
    }
  }
  if (stat) {
    const config = parseConfig(await ctx.fs.readText(configTarget, signal))
    projectId = config.project.id; manuscriptDir = config.paths.manuscriptDir
    invariant(!context.projectId || context.projectId === projectId, 'PROJECT_ID_CONFLICT', '请求项目与当前会话项目不同。')
    // Detect copies among Host registrations, without traversing raw material trees.
    await checkCopies(projectId)
  } else {
    invariant(!context.projectId, 'PROJECT_NOT_INITIALIZED', '当前工作区尚未初始化。')
    // An initialization may stop immediately after publishing its journal. Read
    // only the journal's verified config image to recover the confirmed output.
    const provisional = new HostFileStore(ctx, { canonicalRoot: root, manuscriptDir, sessionId: context.sessionId, revalidate: async () => {} }, signal)
    const journals = await readTransactionJournals(provisional)
    const configs = journals.flatMap(row => row.txn.changes.filter(change => change.path === CONFIG_PATH))
    invariant(configs.length <= 1, 'RECOVERY_CONFLICT', '多个未完成初始化配置需要人工检查。')
    if (configs[0]?.after) manuscriptDir = parseConfig(configs[0].after.text).paths.manuscriptDir
  }
  const binding = { workspaceId: workspace.id, sessionId: context.sessionId, projectId, modeId: 'scholarflow', rootFingerprint: digest(process.platform === 'win32' ? root.toLowerCase() : root) }
  const revalidate = async () => {
    const current = await ctx.sessionController.inspect(context.sessionId, signal)
    const rootNow = await ctx.fs.resolve(workspace.path, { signal })
    const sessionNow = await ctx.fs.resolve(current.meta.cwd, { signal })
    let modeNow = current.meta.agentPreset
    for (const event of current.events) if (event.type === 'agent-preset/selected') modeNow = event.data.agentPreset
    invariant(modeNow === 'scholarflow' && ctx.workspaceRegistry.get(context.workspaceId)?.sessionIds.includes(context.sessionId)
      && ctx.fs.processPath(rootNow) === root && ctx.fs.processPath(sessionNow) === root, 'SESSION_BINDING_CHANGED', '提交前会话绑定发生变化，未写入。')
    if (projectId) {
      const file = await ctx.fs.resolve(`${root}/.scholarflow/project.yaml`, { signal })
      invariant(ctx.fs.contains(rootNow, file), 'PATH_OUTSIDE_ALLOWED_ROOT', '配置链接发生变化。')
      const currentConfig = parseConfig(await ctx.fs.readText(file, signal))
      invariant(currentConfig.project.id === projectId && currentConfig.paths.manuscriptDir === manuscriptDir, 'SESSION_BINDING_CHANGED', '项目身份或输出范围已改变。')
      await checkCopies(projectId)
    }
  }
  return { io: new HostFileStore(ctx, { canonicalRoot: root, manuscriptDir, sessionId: context.sessionId, revalidate }, signal), binding, manuscriptDir }
}

export async function applicationResult<T>(operation: () => Promise<T>) {
  try { return { ok: true as const, data: await operation() } }
  catch (error) {
    if (error instanceof ScholarError) return { ok: false as const, error: { code: error.code, message: error.message, retryable: false, details: error.details } }
    if (error instanceof z.ZodError) return { ok: false as const, error: { code: 'INVALID_REQUEST', message: '请求未通过校验。', retryable: false, details: { fields: error.issues.map(i => i.path.join('.')) } } }
    const code = (error as { code?: string }).code
    return { ok: false as const, error: { code: code?.startsWith('FS_') ? code : 'OPERATION_FAILED',
      message: code === 'FS_SANDBOX_DENIED' ? '宿主文件权限拒绝写入；请在 DSH 中检查当前会话权限。' : '操作未完成，现有文件已保留。', retryable: false } }
  }
}

export async function inspectProject(ctx: Host, request: unknown, signal: AbortSignal) {
  const { context } = inspectRequest.parse(request)
  const { io, binding, manuscriptDir } = await resolveStore(ctx, context, signal)
  const recovery = await inspectRecovery(io, manuscriptDir)
  if (recovery.pending.length) return { binding, initialized: false, metadataExists: true, recovery: {
    planHash: recovery.contentHash, transactions: recovery.pending.map(row => ({ id: row.txn.id, createdAt: row.txn.createdAt,
      files: row.txn.changes.map((change, i) => ({ relativePath: change.path, status: row.images[i] && digest(row.images[i]!.text) === change.after?.hash ? 'published' : 'pending' })) })),
  } }
  if (!await io.stat(CONFIG_PATH)) return { binding, initialized: false, metadataExists: !!await io.stat('.scholarflow') }
  return { binding, initialized: true, ...await snapshot(io) }
}
