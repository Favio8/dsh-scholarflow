import { randomUUID } from 'node:crypto'
import { resolveStore } from './project-api.ts'
import { snapshot } from '../../core/project/project.ts'
import { readWritingTask } from '../../core/pipeline/writing-task-store.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'
import type { RequestContext } from '../../shared/schema.ts'

// Optional host capability: older Harness can still read and export existing papers.
type Host = any
export class SessionRegistration {
  constructor(private readonly ctx: Host) {
    ctx.inject(['sessionTasks'], (owner: Host) => {
      owner.effect(() => owner.sessionTasks.register({ id: 'scholarflow', validate: (binding: Host, signal: AbortSignal) => this.validate(binding, signal) }),
        'scholarflow: confirmed paper session validator')
    })
  }

  private async validate(binding: Host, signal: AbortSignal) {
    invariant(binding.pluginId === 'scholarflow', 'SESSION_BINDING_CHANGED', '会话登记不属于 ScholarFlow。')
    const context = { requestId: `req_${randomUUID()}`, workspaceId: binding.workspaceId, sessionId: binding.sessionId, projectId: binding.projectId }
    const { io } = await resolveStore(this.ctx, context, signal)
    const task = await readWritingTask(io), project = await snapshot(io)
    invariant(task && task.id === binding.taskId && task.projectId === binding.projectId && task.sessionId === binding.sessionId,
      'SESSION_BINDING_CHANGED', '当前会话与已确认论文任务不一致，未登记历史。')
    return { title: project.config.project.title }
  }

  async sync(context: RequestContext, signal: AbortSignal) {
    const { io } = await resolveStore(this.ctx, context, signal)
    const task = await readWritingTask(io)
    // Merely opening the same folder in an independent chat grants no task binding.
    if (!task || task.sessionId !== context.sessionId) return { registered: false, reason: 'no-task-binding' }
    const service = this.ctx.get('sessionTasks')
    if (!service) throw new ScholarError('SESSION_TASKS_UNSUPPORTED', '当前 Harness 缺少论文会话登记能力，请使用配套修复版；正文和任务仍已保留。')
    const resolved = await this.ctx.sessionController.resolveAgent(context.sessionId)
    if (resolved.error) throw resolved.error
    try {
      return await service.bind({ pluginId: 'scholarflow', workspaceId: context.workspaceId, sessionId: context.sessionId,
        projectId: task.projectId, taskId: task.id }, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof ScholarError) throw error
      throw new ScholarError('SESSION_REGISTRATION_FAILED', '论文已保留，会话历史登记未完成；请重试登记。')
    }
  }

  async trySync(context: RequestContext, signal: AbortSignal) {
    try { return await this.sync(context, signal) }
    catch (error) {
      signal.throwIfAborted()
      return { registered: false, diagnostic: { code: (error as ScholarError).code ?? 'SESSION_REGISTRATION_FAILED', message: (error as Error).message } }
    }
  }
}
