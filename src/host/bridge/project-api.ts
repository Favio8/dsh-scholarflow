import { z } from 'zod'
import { requestContext, hash, type RequestContext } from '../../shared/schema.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { digest } from '../../core/store/files.ts'
import { snapshot, parseConfig, CONFIG_PATH, type InitPlan } from '../../core/project/project.ts'
import { readTransactionJournals, inspectRecovery } from '../../core/store/transactions.ts'
import { HostFileStore } from '../gateway/file-store.ts'
import { initInputSchema } from '../../shared/project-defaults.ts'
import { readonlyEnvelope, inspectCompatibility, schemaVersionOf } from '../../core/project/compatibility.ts'
import { inspectDamagedProject } from '../../core/project/diagnostics.ts'
import { readBindings } from '../../core/skills/bindings.ts'
import { pendingCopyTransition, type IdentityTransition } from '../../core/project/identity.ts'
type Host = any
export const inspectRequest = z.object({ context: requestContext }).strict()
export const prepareInitRequest = z.object({ context: requestContext, input: initInputSchema }).strict()
export const initializeRequest = z.object({ context: requestContext, planId: z.string(), planHash: hash }).strict()
export interface StoredInitPlan { plan: InitPlan; context: RequestContext; peerId: string; expires: number }

async function inspectSession(ctx: Host, sessionId: string, signal: AbortSignal) {
  try { return await ctx.sessionController.inspect(sessionId, signal) }
  catch (error) {
    signal.throwIfAborted()
    if (error instanceof ScholarError) throw error
    // The pinned Host may wrap a format refusal. Classify by the failed seam,
    // not private SDK text, and keep raw-log paths and content out of responses.
    throw new ScholarError('SESSION_READ_FAILED', '当前会话读取失败。原日志与项目文件已保留；可重试连接，或在同一工作区新建 ScholarFlow 会话读取项目。')
  }
}

export async function resolveStore(ctx: Host, context: RequestContext, signal: AbortSignal, output?: string, readonlyFuture = false, identityTransition?: IdentityTransition) {
  signal.throwIfAborted()
  const workspace = ctx.workspaceRegistry.get(context.workspaceId)
  invariant(workspace, 'SESSION_BINDING_CHANGED', '宿主工作区不存在，请重新选择。')
  const observation = await inspectSession(ctx, context.sessionId, signal)
  invariant(observation?.meta, 'SESSION_BINDING_CHANGED', '宿主会话不存在。')
  const target = await ctx.fs.resolve(workspace.path, { signal })
  const root = ctx.fs.processPath(target)
  const rootFingerprint = digest(process.platform === 'win32' ? root.toLowerCase() : root)
  invariant(!identityTransition || identityTransition.rootFingerprint === rootFingerprint, 'SESSION_BINDING_CHANGED', '副本身份确认不属于当前实际工作区。')
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
  let bindingDiagnostic: { code: string; message: string } | undefined
  const identityCopies: Array<{ workspaceId: string; rootFingerprint: string }> = []
  const checkCopies = async (identity: string) => {
    const copies: typeof identityCopies = []
    for (const other of ctx.workspaceRegistry.list()) {
      if (other.id === workspace.id) continue
      const otherRoot = await ctx.fs.resolve(other.path, { signal })
      const otherPath = ctx.fs.processPath(otherRoot)
      if (process.platform === 'win32' ? otherPath.toLowerCase() === root.toLowerCase() : otherPath === root) continue
      const otherConfig = await ctx.fs.resolve(`${other.path}/.scholarflow/project.yaml`, { signal })
      const otherInfo = await ctx.fs.stat(otherConfig, signal)
      if (!ctx.fs.contains(otherRoot, otherConfig) || !otherInfo || otherInfo.type !== 'file' || otherInfo.size > 2 * 1024 * 1024) continue
      let candidate
      let otherText: string
      try { otherText = await ctx.fs.readText(otherConfig, signal) } catch (error) { if (signal.aborted) throw error; continue }
      try { candidate = parseConfig(otherText) } catch {
        // A safely validated identity envelope still conflicts when its policy
        // schema is newer; it never supplies effective settings or permissions.
        try { candidate = readonlyEnvelope(otherText) } catch { continue }
      }
      if (candidate.project.id === identity) copies.push({ workspaceId: other.id,
        rootFingerprint: digest(process.platform === 'win32' ? otherPath.toLowerCase() : otherPath) })
    }
    invariant(readonlyFuture || identityTransition?.oldProjectId === identity || !copies.length, 'PROJECT_ID_CONFLICT', '同一宿主存在项目身份相同的副本，请先为副本建立独立身份。')
    identityCopies.splice(0, identityCopies.length, ...copies)
    if (copies.length) bindingDiagnostic = { code: 'PROJECT_ID_CONFLICT', message: '同一宿主注册了身份相同的另一份项目。当前工作区仅可查看原文件；须明确选择要绑定为副本的工作区，再建立独立身份。' }
  }
  if (stat) {
    let configText = ''
    let config
    try { configText = await ctx.fs.readText(configTarget, signal); config = parseConfig(configText) }
    catch (error) {
      if (!readonlyFuture || signal.aborted) throw error
      let original: ReturnType<typeof readonlyEnvelope> | undefined
      try { original = readonlyEnvelope(configText) } catch { /* No guessed identity or output reads. */ }
      config = { project: original?.project, paths: { manuscriptDir: original?.paths?.manuscriptDir ?? 'manuscript' } }
      if (!(error instanceof ScholarError && error.code === 'PROJECT_SCHEMA_TOO_NEW' && original))
        bindingDiagnostic = { code: 'PROJECT_CONFIG_INVALID', message: '项目配置无法安全解释，原文件保留。' }
    }
    projectId = config.project?.id; manuscriptDir = config.paths.manuscriptDir
    invariant(!projectId || !context.projectId || context.projectId === projectId || identityTransition &&
      context.projectId === identityTransition.oldProjectId && projectId === identityTransition.projectId, 'PROJECT_ID_CONFLICT', '请求项目与当前会话项目不同。')
    if (identityTransition) invariant(projectId === identityTransition.oldProjectId && digest(configText) === identityTransition.oldConfigHash ||
      projectId === identityTransition.projectId && digest(configText) === identityTransition.newConfigHash,
      'PROJECT_COPY_CHANGED', '副本身份过渡配置不是已确认的原始或目标字节。')
    // Detect copies among Host registrations, without traversing raw material trees.
    if (projectId) await checkCopies(projectId)
  } else {
    invariant(!context.projectId, 'PROJECT_NOT_INITIALIZED', '当前工作区尚未初始化。')
    // An initialization may stop immediately after publishing its journal. Read
    // only the journal's verified config image to recover the confirmed output.
    const provisional = new HostFileStore(ctx, { canonicalRoot: root, manuscriptDir, sessionId: context.sessionId, revalidate: async () => {} }, signal)
    let journals: Awaited<ReturnType<typeof readTransactionJournals>> = []
    try { journals = await readTransactionJournals(provisional) } catch (error) {
      if (!readonlyFuture || signal.aborted) throw error
      bindingDiagnostic = { code: 'RECOVERY_CONFLICT', message: '未完成初始化的事务记录无法安全解释，原文件保留。' }
    }
    const configs = journals.flatMap(row => row.txn.changes.filter(change => change.path === CONFIG_PATH))
    invariant(configs.length <= 1, 'RECOVERY_CONFLICT', '多个未完成初始化配置需要人工检查。')
    if (configs[0]?.after) {
      try { manuscriptDir = parseConfig(configs[0].after.text).paths.manuscriptDir } catch (error) {
        if (!readonlyFuture) throw error
        bindingDiagnostic = { code: 'RECOVERY_CONFLICT', message: '初始化事务内的配置无法安全解释，未恢复或重建。' }
      }
    }
  }
  const binding = { workspaceId: workspace.id, sessionId: context.sessionId, projectId, modeId: 'scholarflow', rootFingerprint }
  const revalidate = async () => {
    const current = await inspectSession(ctx, context.sessionId, signal)
    const rootNow = await ctx.fs.resolve(workspace.path, { signal })
    const sessionNow = await ctx.fs.resolve(current.meta.cwd, { signal })
    let modeNow = current.meta.agentPreset
    for (const event of current.events) if (event.type === 'agent-preset/selected') modeNow = event.data.agentPreset
    invariant(modeNow === 'scholarflow' && ctx.workspaceRegistry.get(context.workspaceId)?.sessionIds.includes(context.sessionId)
      && ctx.fs.processPath(rootNow) === root && ctx.fs.processPath(sessionNow) === root, 'SESSION_BINDING_CHANGED', '提交前会话绑定发生变化，未写入。')
    if (projectId) {
      const file = await ctx.fs.resolve(`${root}/.scholarflow/project.yaml`, { signal })
      invariant(ctx.fs.contains(rootNow, file), 'PATH_OUTSIDE_ALLOWED_ROOT', '配置链接发生变化。')
      const currentText = await ctx.fs.readText(file, signal), currentConfig = parseConfig(currentText)
      const identityMatches = identityTransition
        ? currentConfig.project.id === identityTransition.oldProjectId && digest(currentText) === identityTransition.oldConfigHash ||
          currentConfig.project.id === identityTransition.projectId && digest(currentText) === identityTransition.newConfigHash
        : currentConfig.project.id === projectId
      invariant(identityMatches && currentConfig.paths.manuscriptDir === manuscriptDir, 'SESSION_BINDING_CHANGED', '项目身份或输出范围已改变。')
      if (!readonlyFuture) for (const path of ['.scholarflow/data/ledger.json', '.scholarflow/resources.lock.json']) {
        const headerTarget = await ctx.fs.resolve(`${root}/${path}`, { signal })
        invariant(ctx.fs.contains(rootNow, headerTarget), 'PATH_OUTSIDE_ALLOWED_ROOT', '项目版本记录链接发生变化。')
        if (await ctx.fs.stat(headerTarget, signal)) invariant((schemaVersionOf(await ctx.fs.readText(headerTarget, signal)) ?? 1) <= 1,
          'PROJECT_SCHEMA_TOO_NEW', '提交前项目记录或资源锁升级，当前插件已停止写入。')
      }
      await checkCopies(currentConfig.project.id)
    }
  }
  const io = new HostFileStore(ctx, { canonicalRoot: root, manuscriptDir, sessionId: context.sessionId, revalidate, readOnly: readonlyFuture }, signal)
  if (!readonlyFuture && projectId) for (const path of ['.scholarflow/data/ledger.json', '.scholarflow/resources.lock.json'])
    invariant((schemaVersionOf((await io.read(path))?.text) ?? 1) <= 1, 'PROJECT_SCHEMA_TOO_NEW', '项目记录或资源锁版本过新；请只读查看原文件，当前操作已停止。')
  if (!readonlyFuture && projectId && !(await inspectRecovery(io, manuscriptDir)).pending.length) {
    const current = await snapshot(io); await readBindings(io, current.config)
  }
  return { io, binding, manuscriptDir, bindingDiagnostic, identityCopies }
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
  const { io, binding, manuscriptDir, bindingDiagnostic, identityCopies } = await resolveStore(ctx, context, signal, undefined, true)
  if (bindingDiagnostic) {
    let recovery: Awaited<ReturnType<typeof inspectRecovery>> | undefined
    if (identityCopies.length) {
      try { const transition = await pendingCopyTransition(io)
        if (transition && transition.rootFingerprint === binding.rootFingerprint) recovery = await inspectRecovery(io, manuscriptDir)
      } catch { /* Damaged copy journals remain diagnostic originals, never write exemptions. */ }
    }
    return { binding, initialized: false, metadataExists: true,
      ...(identityCopies.length && { identityConflict: { projectId: binding.projectId, workspaceId: binding.workspaceId, copies: identityCopies } }),
      ...(recovery?.pending.length && { recovery: { planHash: recovery.contentHash, copyIdentity: true,
        transactions: recovery.pending.map(row => ({ id: row.txn.id, createdAt: row.txn.createdAt,
          files: row.txn.changes.map((change, i) => ({ relativePath: change.path, status: row.images[i] && digest(row.images[i]!.text) === change.after?.hash ? 'published' : 'pending' })) })) } }),
      readonly: await inspectDamagedProject(io, bindingDiagnostic) }
  }
  try {
    const compatibility = await inspectCompatibility(io)
    if (compatibility) return { binding, initialized: false, metadataExists: true, readonly: compatibility }
    const recovery = await inspectRecovery(io, manuscriptDir)
    if (recovery.pending.length) return { binding, initialized: false, metadataExists: true, recovery: {
      planHash: recovery.contentHash, transactions: recovery.pending.map(row => ({ id: row.txn.id, createdAt: row.txn.createdAt,
        files: row.txn.changes.map((change, i) => ({ relativePath: change.path, status: row.images[i] && digest(row.images[i]!.text) === change.after?.hash ? 'published' : 'pending' })) })),
    } }
    if (!await io.stat(CONFIG_PATH)) return { binding, initialized: false, metadataExists: !!await io.stat('.scholarflow') }
    const current = await snapshot(io)
    try { await readBindings(io, current.config) } catch (error) {
      if (error instanceof ScholarError) throw error
      throw new ScholarError('SKILL_RESOURCE_LOCK_INVALID', '资源锁无法安全解释，原文件保留。')
    }
    return { binding, initialized: true, ...current }
  } catch (error) {
    if (!(error instanceof ScholarError) || !['PROJECT_CONFIG_INVALID', 'PROJECT_LEDGER_INVALID', 'RECOVERY_CONFLICT', 'PROJECT_ID_CONFLICT', 'DOCUMENT_NOT_FOUND', 'SKILL_RESOURCE_LOCK_INVALID', 'SKILL_RESOURCE_LOCK_MISSING', 'SKILL_BINDING_MISMATCH'].includes(error.code)) throw error
    return { binding, initialized: false, metadataExists: true, readonly: await inspectDamagedProject(io, { code: error.code, message: error.message }) }
  }
}
