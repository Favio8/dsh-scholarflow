import { z } from 'zod'
import { id } from '../../shared/schema.ts'
import { automaticInputSchema, automaticStateSchema } from '../../shared/workflow-automatic.ts'
import { automaticChildGrantSchema, type AutomaticChildGrant } from '../../shared/workflow-automatic.ts'
import { digest, type FileStore } from '../store/files.ts'
import { invariant, parseStored } from '../../shared/errors.ts'
import { isDetachedProjectPointer } from '../project/identity.ts'

const pointerSchema = z.object({ schemaVersion: z.literal(1), workflowId: id, projectId: id }).strict()
const automaticPointerSchema = pointerSchema.extend({ automaticId: id }).strict()
// Called inside the ordinary stage admission/charging lock. The local scheduler
// does not create a second paid pipeline or silently own unrelated workspaces.
export async function ensureNoAutomaticExecuting(io: FileStore, projectId: string, approvedChild?: AutomaticChildGrant) {
  const path = '.scholarflow/workflows/current.json', goal = await io.read(path)
  if (!goal || await isDetachedProjectPointer(io, path, goal)) { invariant(!approvedChild, 'AUTOMATIC_CHILD_INVALID', '原自动调度目标缺失；未发起调用。'); return }
  const workflow = parseStored(pointerSchema, goal.text, 'WORKFLOW_STATE_INVALID', 'automatic.admission')
  invariant(workflow.projectId === projectId && /^workflow_[\w]+$/u.test(workflow.workflowId), 'PROJECT_ID_CONFLICT', '活动引导身份不符。')
  const base = `.scholarflow/runs/${workflow.workflowId}/automatic`, pointer = await io.read(`${base}/current.json`)
  if (!pointer) { invariant(!approvedChild, 'AUTOMATIC_CHILD_INVALID', '原自动调度检查点缺失；未发起调用。'); return }
  const current = parseStored(automaticPointerSchema, pointer.text, 'AUTOMATIC_INVALID', 'automatic.admission')
  invariant(current.workflowId === workflow.workflowId && current.projectId === projectId && /^automatic_[\w]+$/u.test(current.automaticId), 'AUTOMATIC_INVALID', '活动自动推进身份不符。')
  const [inputFile, stateFile] = await Promise.all([io.read(`${base}/${current.automaticId}/input.json`), io.read(`${base}/${current.automaticId}/run.json`)])
  invariant(inputFile && stateFile, 'AUTOMATIC_INVALID', '活动自动推进缺少事实源，未猜测释放。')
  const input = parseStored(automaticInputSchema, inputFile.text, 'AUTOMATIC_INVALID', 'automatic.admission')
  const state = parseStored(automaticStateSchema, stateFile.text, 'AUTOMATIC_INVALID', 'automatic.admission')
  invariant([input, state].every(row => row.automaticId === current.automaticId && row.workflowId === current.workflowId && row.projectId === projectId) &&
    state.inputHash === digest(inputFile.text), 'AUTOMATIC_INVALID', '活动自动推进输入或身份被修改。')
  if (approvedChild) {
    const grant = automaticChildGrantSchema.parse(approvedChild), pending = state.steps.filter(row => row.state === 'pending')
    invariant(state.status === 'running' && pending.length === 1 && grant.workflowId === current.workflowId && grant.automaticId === current.automaticId &&
      pending[0].stepId === grant.stepId && pending[0].child?.runId === grant.runId && pending[0].child.planHash === grant.planHash &&
      (pending[0].operation === 'model-review' && input.modelReview?.runId === grant.runId && input.modelReview.planHash === grant.planHash ||
        pending[0].operation === (input.work?.kind === 'generation' ? 'model-generation' : 'research-batch') && input.work?.runId === grant.runId && input.work.planHash === grant.planHash && pending[0].stage === input.work.stage),
      'AUTOMATIC_CHILD_INVALID', '调用不属于当前已登记、已确认的唯一子步骤；未调用提供方。')
    return
  }
  invariant(!['queued', 'running'].includes(state.status), 'RUN_IN_PROGRESS', '当前自动推进仍在执行，先暂停或等待其保存，再启动独立阶段；未调用提供方。')
}
