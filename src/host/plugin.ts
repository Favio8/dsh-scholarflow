import Schema from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

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

export class ScholarFlowRemote extends TypertRemoteService {
  constructor(ctx: Host) { super(ctx, 'scholarflow', { namespace: 'scholarflow.v1' }) }

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
