import { z } from 'zod'
import { id } from '../../shared/schema.ts'
import { automaticInputSchema, automaticStateSchema } from '../../shared/workflow-automatic.ts'
import { digest, type FileStore } from '../store/files.ts'
import { invariant } from '../../shared/errors.ts'
import { isDetachedProjectPointer } from '../project/identity.ts'

const pointerSchema = z.object({ schemaVersion: z.literal(1), workflowId: id, projectId: id }).strict()
const automaticPointerSchema = pointerSchema.extend({ automaticId: id }).strict()
// Called inside the ordinary stage admission/charging lock. The local scheduler
// does not create a second paid pipeline or silently own unrelated workspaces.
export async function ensureNoAutomaticExecuting(io: FileStore, projectId: string) {
  const path = '.scholarflow/workflows/current.json', goal = await io.read(path)
  if (!goal || await isDetachedProjectPointer(io, path, goal)) return
  const workflow = pointerSchema.parse(JSON.parse(goal.text))
  invariant(workflow.projectId === projectId && /^workflow_[\w]+$/u.test(workflow.workflowId), 'PROJECT_ID_CONFLICT', '活动引导身份不符。')
  const base = `.scholarflow/runs/${workflow.workflowId}/automatic`, pointer = await io.read(`${base}/current.json`)
  if (!pointer) return
  const current = automaticPointerSchema.parse(JSON.parse(pointer.text))
  invariant(current.workflowId === workflow.workflowId && current.projectId === projectId && /^automatic_[\w]+$/u.test(current.automaticId), 'AUTOMATIC_INVALID', '活动自动推进身份不符。')
  const [inputFile, stateFile] = await Promise.all([io.read(`${base}/${current.automaticId}/input.json`), io.read(`${base}/${current.automaticId}/run.json`)])
  invariant(inputFile && stateFile, 'AUTOMATIC_INVALID', '活动自动推进缺少事实源，未猜测释放。')
  const input = automaticInputSchema.parse(JSON.parse(inputFile.text)), state = automaticStateSchema.parse(JSON.parse(stateFile.text))
  invariant([input, state].every(row => row.automaticId === current.automaticId && row.workflowId === current.workflowId && row.projectId === projectId) &&
    state.inputHash === digest(inputFile.text), 'AUTOMATIC_INVALID', '活动自动推进输入或身份被修改。')
  invariant(!['queued', 'running'].includes(state.status), 'RUN_IN_PROGRESS', '当前本地自动推进仍在执行，先暂停或等待其保存，再启动独立阶段；未调用提供方。')
}
