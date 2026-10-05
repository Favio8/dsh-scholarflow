import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { invariant, ScholarError } from '../../shared/errors.ts'
import type { ModelCall } from '../../core/pipeline/generation.ts'

type Host = any
export async function selectedModel(ctx: Host, sessionId: string, signal: AbortSignal) {
  const resolved = await ctx.sessionController.resolveAgent(sessionId)
  if (resolved.error) throw resolved.error
  const agent = resolved.agent
  const projection = ctx.sessionProjections?.stateOf(agent.session, 'modelSelection')
  invariant(projection, 'UNSUPPORTED_DSH_CAPABILITY', '宿主没有可验证的会话模型选择投影。')
  const selected = structuredClone(projection.pending ?? projection.lastUsed ?? ctx.agentDefaultModel.currentSelection())
  invariant(selected?.provider && selected.model, 'MODEL_NOT_SELECTED', '请先在 DSH 中选择当前会话模型。')
  const info = await ctx.llm.resolveModelInfo(selected.provider, selected.model, signal)
  invariant(info.context?.contextWindow, 'UNSUPPORTED_DSH_CAPABILITY', '宿主没有返回该模型的上下文限额，无法安全规划输入范围。')
  return { selected, contextWindow: info.context.contextWindow as number, session: agent.session }
}

export async function callStageModel(ctx: Host, session: Host, selected: { provider: string; model: string; reasoningEffort?: string }, call: ModelCall) {
  const messages = [createSystemMessage(call.system), createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text',
    text: JSON.stringify({ instruction: call.instruction, ...(call.repair && { formatRepair: call.repair }), researchData: call.context }) }] })]
  const maxTokens = call.maxTokens ?? 4096
  invariant(Number.isInteger(maxTokens) && maxTokens >= 1 && maxTokens <= 32768, 'MODEL_OUTPUT_BUDGET_INVALID', '阶段输出预算不合法，未发送模型请求。')
  const request = { ...selected, sessionId: session.id, maxTokens, temperature: 0.3, messages }
  // The SDK requires every model-visible input to be reconstructable from the
  // owning session log. No raw prompt is duplicated into project diagnostic logs.
  session.append('scholarflow/stage-model-request', { runId: call.runId, request })
  invariant(await ctx.sessions.flush(session), 'UNSUPPORTED_DSH_CAPABILITY', '宿主未确认请求日志持久化；未调用模型。')
  let text = '', finish: Host, usage: Host
  for await (const chunk of ctx.llm.stream({ ...request, signal: call.signal })) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
      invariant(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'MODEL_OUTPUT_TOO_LARGE', '模型输出超过阶段限额。')
    } else if (chunk.type === 'finish') finish = chunk.reason
    else if (chunk.type === 'usage') usage = chunk.usage
  }
  session.append('scholarflow/stage-model-result', { runId: call.runId, text, finish: finish?.kind ?? 'missing', ...(usage && { usage }) })
  await ctx.sessions.flush(session)
  if (finish?.kind === 'aborted' || call.signal.aborted) throw new ScholarError('CANCELLED', '宿主模型调用已取消。')
  if (finish?.kind === 'max-tokens') throw new ScholarError('MODEL_OUTPUT_LIMIT_REACHED', '模型消耗了本次输出预算但未完整返回结果；已保留计费次数，请预览新的运行。')
  if (finish?.kind === 'error') {
    const code = /^[A-Z_]{1,64}$/.test(finish.failure?.code ?? '') ? finish.failure.code : 'MODEL_CALL_FAILED'
    const facts: Record<string, number> = {}, failure = finish.failure
    if (Number.isInteger(failure?.status) && failure.status >= 100 && failure.status <= 599) facts.status = failure.status
    if (Number.isFinite(failure?.providerRetryAfterMs) && failure.providerRetryAfterMs > 0) facts.providerRetryAfterMs = failure.providerRetryAfterMs
    throw new ScholarError(code, '宿主模型调用失败；请在 DSH 中检查模型、凭据或服务状态。', facts)
  }
  invariant(finish?.kind === 'stop' && text.trim(), 'MODEL_OUTPUT_INCOMPLETE', '模型输出未正常结束或为空；未应用任何正文修改。')
  return text
}
