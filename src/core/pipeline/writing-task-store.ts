import { creationSpec, writingTaskSchema, type WritingTask, type CreationSpec } from '../../shared/writing-task.ts'
import { json, newId, digest, type FileStore } from '../store/files.ts'
import { commit } from '../store/transactions.ts'
import { snapshot, mutateLedger } from '../project/project.ts'
import { parseDocument } from 'yaml'
import { CONFIG_PATH } from '../project/project.ts'
import { invariant, parseStored } from '../../shared/errors.ts'
import { z } from 'zod'
import { id } from '../../shared/schema.ts'
import { classifyNote, handledIssue, mergeIssue, progressIssue } from './task-issues.ts'

const POINTER = '.scholarflow/writing/current.json'
export const taskPath = (taskId: string) => `.scholarflow/writing/tasks/${taskId}.json`
export const specPath = '.scholarflow/writing/requirements.json'

/**
 * `notes` stays the raw audit trail the quality report reads; `issues` is the same event
 * classified for the user (SPEC v1.2 §9). One call keeps the two from drifting apart.
 */
export function noteTask(task: WritingTask, text: string, at = new Date().toISOString()) {
  task.notes.push(text)
  task.issues = mergeIssue(task.issues, classifyNote(text, at))
  return task
}
export function showProgress(task: WritingTask, input: { object: string; what: string; impact: string }) {
  task.issues = mergeIssue(task.issues, progressIssue({ ...input, at: new Date().toISOString() }))
  return task
}
export function markHandled(task: WritingTask, input: { object: string; what: string; impact: string }) {
  const resolved = handledIssue({ ...input, at: new Date().toISOString() })
  task.issues = mergeIssue(task.issues, resolved).map(row => row.key === resolved.key
    ? { ...row, group: 'handled', impact: resolved.impact, actions: [] } : row)
  return task
}

/** A fresh full review supersedes findings from its own previous review, while unrelated
 * reading failures and unknown checks stay open. Raw notes remain an audit trail. */
export function reconcileReviewIssues(task: WritingTask, object: '要求检查' | '全文审查', details: string[]) {
  const keys = new Set(details.map(detail => classifyNote(`${object}：${detail}`, task.updatedAt).key))
  for (const row of [...task.issues]) if (row.object === object && row.group === 'needs-action' && !keys.has(row.key))
    markHandled(task, { object, what: row.what, impact: '本轮完整复查已不再提出这一问题；原检查记录保留在技术详情。' })
  for (const detail of details) noteTask(task, `${object}：${detail}`)
}

export async function readWritingSpecImage(io: FileStore) {
  const file = await io.read(specPath)
  if (!file) return { spec: undefined, baseSpecHash: null }
  const row = parseStored(z.object({ schemaVersion: z.literal(1), projectId: id, spec: creationSpec }).strict(), file.text, 'WRITING_SPEC_INVALID', 'writingTask.requirements')
  invariant(row.projectId === (await snapshot(io)).ledger.projectId, 'SESSION_BINDING_CHANGED', '写作要求不属于当前论文。')
  return { spec: row.spec, baseSpecHash: digest(file.text) }
}
export async function readWritingSpec(io: FileStore) { return (await readWritingSpecImage(io)).spec }
export async function readWritingTask(io: FileStore, taskId?: string) {
  const pointer = await io.read(POINTER)
  const header = pointer ? parseStored(z.object({ taskId: id, projectId: id }).strict(), pointer.text, 'WRITING_TASK_INVALID', 'writingTask.inspect') : undefined
  if (header) invariant(header.projectId === (await snapshot(io)).ledger.projectId, 'SESSION_BINDING_CHANGED', '任务指针不属于当前论文。')
  const selected = taskId ?? header?.taskId
  if (!selected) return undefined
  const file = await io.read(taskPath(selected))
  invariant(file, 'WRITING_TASK_INVALID', '历史任务文件缺失，正文和写作要求仍可查看。')
  const state = parseStored(writingTaskSchema, file.text, 'WRITING_TASK_INVALID', 'writingTask.inspect'), current = await snapshot(io)
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
    usedSearchQueries: 0, elapsedMs: 0, owner, expectedDocumentHash: current.document.contentHash,
    questions: [], notes: [], issues: [], onlineSources: [], createdAt: time, updatedAt: time })
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
      constraint: { operator: 'min', value: Math.floor(spec.targetLength * .9), unit: spec.language === 'en' ? 'words' : 'zh-characters', countingPolicyId: 'sf-body-han-western-v1' } }
    ledger.requirements.writing_length_max = { ...ledger.requirements.writing_length, id: 'writing_length_max',
      constraint: { ...ledger.requirements.writing_length.constraint!, operator: 'max', value: Math.ceil(spec.targetLength * 1.1) } }
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
