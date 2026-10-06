import { creationSpec, writingTaskSchema, type WritingTask, type CreationSpec } from '../../shared/writing-task.ts'
import { json, newId, type FileStore } from '../store/files.ts'
import { commit } from '../store/transactions.ts'
import { snapshot, mutateLedger } from '../project/project.ts'
import { parseDocument } from 'yaml'
import { CONFIG_PATH } from '../project/project.ts'
import { invariant } from '../../shared/errors.ts'

const POINTER = '.scholarflow/writing/current.json'
export const taskPath = (taskId: string) => `.scholarflow/writing/tasks/${taskId}.json`
export const specPath = '.scholarflow/writing/requirements.json'
export async function readWritingSpec(io: FileStore) { const file = await io.read(specPath); return file ? creationSpec.parse(JSON.parse(file.text).spec) : undefined }
export async function readWritingTask(io: FileStore, taskId?: string) {
  const pointer = await io.read(POINTER)
  const selected = taskId ?? (pointer && JSON.parse(pointer.text).taskId)
  if (!selected) return undefined
  const file = await io.read(taskPath(selected))
  if (!file) return undefined
  const state = writingTaskSchema.parse(JSON.parse(file.text)), current = await snapshot(io)
  invariant(state.projectId === current.ledger.projectId, 'SESSION_BINDING_CHANGED', '写作任务不属于当前论文。')
  return state
}
export async function saveWritingTask(io: FileStore, state: WritingTask) {
  await io.lock(async () => {
    const path = taskPath(state.id), before = await io.read(path)
    if (before) invariant(JSON.parse(before.text).revision === state.revision, 'WRITING_TASK_CHANGED', '任务已由另一操作更新，请重新读取。')
    state.revision++; state.updatedAt = new Date().toISOString()
    await commit(io, [{ path, before, after: json(writingTaskSchema.parse(state)) }])
  })
  return state
}
export async function createWritingTask(io: FileStore, spec: CreationSpec, sessionId: string, owner: string) {
  const current = await snapshot(io), previous = await readWritingTask(io)
  invariant(!previous || ['completed', 'cancelled', 'failed'].includes(previous.status), 'WRITING_IN_PROGRESS', '此论文已有写作任务，请继续原任务。')
  const time = new Date().toISOString()
  const state = writingTaskSchema.parse({ schemaVersion: 1, id: newId('writing'), projectId: current.ledger.projectId, sessionId, spec,
    status: 'queued', stage: 'materials', revision: 0, materialIndex: 0, sectionIndex: 0, usedModelCalls: 0,
    modelCallAllowance: current.config.workflow.budget.maxModelCalls, usedSearchQueries: 0,
    elapsedMs: 0, owner, expectedDocumentHash: current.document.contentHash, questions: [], notes: [], onlineSources: [], createdAt: time, updatedAt: time })
  await io.lock(async () => { await commit(io, [{ path: taskPath(state.id), before: undefined, after: json(state) },
    { path: POINTER, before: await io.read(POINTER), after: json({ taskId: state.id, projectId: state.projectId }) },
    { path: specPath, before: await io.read(specPath), after: json({ schemaVersion: 1, projectId: state.projectId, spec }) }]) })
  return state
}
export async function saveWritingSpec(io: FileStore, spec: CreationSpec, revision: number) {
  return mutateLedger(io, revision, async (ledger, config) => {
    const now = new Date().toISOString()
    ledger.requirements.writing_brief = { id: 'writing_brief', kind: 'other', description: spec.requirements,
      origin: { type: 'user' }, confirmation: 'confirmed', verificationMethod: 'model-assisted', confirmedAt: now }
    ledger.requirements.writing_length = { id: 'writing_length', kind: 'length', description: `目标篇幅约 ${spec.targetLength} ${spec.language === 'en' ? '词' : '汉字'}`,
      origin: { type: 'user' }, confirmation: 'confirmed', verificationMethod: 'deterministic', confirmedAt: now,
      constraint: { operator: 'min', value: Math.floor(spec.targetLength * .8), unit: spec.language === 'en' ? 'words' : 'zh-characters' } }
    if (/(?:禁止|不允许|不得)\s*(?:使用\s*)?(?:AI|人工智能|生成式)/i.test(spec.requirements))
      ledger.requirements.writing_ai_policy = { id: 'writing_ai_policy', kind: 'ai-policy', description: spec.requirements, origin: { type: 'user' }, confirmation: 'confirmed', verificationMethod: 'manual', confirmedAt: now, constraint: { operator: 'equals', value: 'forbidden' } }
    else delete ledger.requirements.writing_ai_policy
    ledger.requirements.writing_format = { id: 'writing_format', kind: 'format', description: `提交格式：${spec.format}`,
      origin: { type: 'user' }, confirmation: 'confirmed', verificationMethod: 'manual', confirmedAt: now }
    const before = (await io.read(CONFIG_PATH))!, yaml = parseDocument(before.text)
    yaml.setIn(['materials', 'include'], [...new Set([...spec.materials, ...config.materials.include.filter(path => path.startsWith('.scholarflow/cache/writing-assets/'))])])
    yaml.setIn(['output', 'defaultFormat'], spec.format)
    return [{ path: specPath, before: await io.read(specPath), after: json({ schemaVersion: 1, projectId: ledger.projectId, spec }) }, { path: CONFIG_PATH, before, after: yaml.toString() }]
  })
}
export async function dirtyWritingBuffers(io: FileStore) {
  if (!await io.stat('.scholarflow/drafts/editor-buffers')) return false
  const rows = await io.list('.scholarflow/drafts/editor-buffers')
  for (const row of rows.filter(row => row.type === 'file' && row.path.endsWith('.json'))) {
    const file = await io.read(row.path)
    if (file && JSON.parse(file.text).state === 'dirty') return true
  }
  return false
}
