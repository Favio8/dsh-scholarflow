import { z } from 'zod'
import { parseDocument } from 'yaml'
import { id, hash, ledgerSchema } from '../../shared/schema.ts'
import { resourceLockSchema } from '../../shared/skills.ts'
import { projectProfileSourceSchema } from '../../shared/profiles.ts'
import { digest, json, newId, type FileStore, type FileImage } from '../store/files.ts'
import { commit, inspectRecovery, readTransactionJournals } from '../store/transactions.ts'
import { snapshot, parseConfig, parseLedger, CONFIG_PATH, LEDGER_PATH } from './project.ts'
import { MEMORY_APPROVALS, memoryApprovalsSchema } from './memory.ts'
import { readBindings } from '../skills/bindings.ts'
import { invariant, parseStored } from '../../shared/errors.ts'

export const IDENTITY_CURRENT = '.scholarflow/identity/current.json'
export const detachedPaths = ['.scholarflow/runs/active.json', '.scholarflow/workflows/current.json',
  '.scholarflow/drafting/current.json', '.scholarflow/reviews/current.json'] as const
const headerPaths = ['.scholarflow/project.yaml', '.scholarflow/data/ledger.json', '.scholarflow/resources.lock.json', MEMORY_APPROVALS,
  '.scholarflow/profiles/writing-source.json', '.scholarflow/skills/current-stage.json'] as const
const ownedPaths = z.enum([...headerPaths, ...detachedPaths, IDENTITY_CURRENT])
const archivePath = (operationId: string) => {
  invariant(/^project_copy_[a-f0-9]{32}$/u.test(operationId), 'PROJECT_COPY_INVALID', '副本操作身份无效。')
  return `.scholarflow/identity/history/${operationId}.json`
}
const pointerSchema = z.object({ schemaVersion: z.literal(1), projectId: id, operationId: id, recordHash: hash }).strict()
const originalSchema = z.object({ path: ownedPaths, text: z.string().nullable(), contentHash: hash.nullable() }).strict()
const recordSchema = z.object({ schemaVersion: z.literal(1), operation: z.literal('bind-project-copy'), operationId: id,
  oldProjectId: id, projectId: id, sourceSessionId: id, rootFingerprint: hash, reason: z.string().trim().min(10).max(4000),
  confirmedAt: z.iso.datetime(), originals: z.array(originalSchema).length(11), newConfigText: z.string(),
  documentHash: hash, referencesHash: hash, retainedContentIds: z.literal(true), oldExecutionDetached: z.literal(true) }).strict()
const detachedSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('project-copy-detached'), projectId: id,
  operationId: id, recordHash: hash, path: z.enum(detachedPaths), previousHash: hash }).strict()
export type IdentityRecord = z.infer<typeof recordSchema>

export interface IdentityTransition { oldProjectId: string; projectId: string; oldConfigHash: string; newConfigHash: string; rootFingerprint: string }
export const copyPlanTransition = (plan: ProjectCopyPlan): IdentityTransition => ({ oldProjectId: plan.oldProjectId, projectId: plan.projectId,
  oldConfigHash: plan.originals.find(row => row.path === CONFIG_PATH)!.contentHash!, newConfigHash: digest(plan.newConfigText), rootFingerprint: plan.rootFingerprint })

function publicationTexts(record: IdentityRecord) {
  const originals = new Map(record.originals.map(row => [row.path as string, row.text])), previous = (path: string) => originals.get(path) ?? null
  const config = parseConfig(previous(CONFIG_PATH)!), oldLedger = parseLedger(previous(LEDGER_PATH)!)
  invariant(config.project.id === record.oldProjectId && oldLedger.projectId === record.oldProjectId &&
    json(parseConfig(record.newConfigText)) === json({ ...config, project: { ...config.project, id: record.projectId } }),
    'PROJECT_COPY_ARCHIVE_INVALID', '身份变更原稿身份或配置范围不符。')
  const ledger = structuredClone(oldLedger); ledger.projectId = record.projectId; ledger.revision++
  for (const state of Object.values(ledger.proposalStates)) if (state.state === 'pending') { state.state = 'stale'; state.updatedAt = record.confirmedAt }
  for (const issue of Object.values(ledger.reviewIssues)) { issue.stale = true; if (issue.state === 'proposed-fix') issue.state = 'open' }
  const recordText = json(record), recordHash = digest(recordText)
  const texts = [{ path: CONFIG_PATH, before: previous(CONFIG_PATH), after: record.newConfigText },
    { path: archivePath(record.operationId), before: null as string | null, after: recordText }]
  for (const path of headerPaths.filter(path => path !== CONFIG_PATH && path !== LEDGER_PATH)) {
    const text = previous(path)
    if (text === null) continue
    const value = JSON.parse(text)
    invariant(value.projectId === record.oldProjectId, 'PROJECT_COPY_ARCHIVE_INVALID', '原始身份侧车属于其他项目。')
    value.projectId = record.projectId
    if (path.endsWith('resources.lock.json')) {
      const lock = resourceLockSchema.safeParse(value)
      invariant(lock.success || value.schemaVersion === 1 && Array.isArray(value.skills) && value.skills.length === 0 && Array.isArray(value.profiles) &&
        Object.keys(value).sort().join(',') === 'profiles,projectId,schemaVersion,skills' && !config.skills.bindings.length,
        'PROJECT_COPY_ARCHIVE_INVALID', '原资源锁格式无效。')
      if (lock.success) invariant(json(config.skills.bindings) === json(lock.data.bindings.map(row => ({ ref: row.bindingId, stages: row.enabledStages }))),
        'PROJECT_COPY_ARCHIVE_INVALID', '原资源锁与启用清单不同。')
    }
    if (path === MEMORY_APPROVALS) memoryApprovalsSchema.parse(value)
    if (path.endsWith('writing-source.json')) projectProfileSourceSchema.parse(value)
    if (path.endsWith('current-stage.json')) invariant(value.schemaVersion === 1 && ['requirements', 'research', 'outline', 'drafting', 'review', 'revision', 'delivery'].includes(value.stage) &&
      typeof value.selectedAt === 'string' && Object.keys(value).sort().join(',') === 'projectId,schemaVersion,selectedAt,stage', 'PROJECT_COPY_ARCHIVE_INVALID', '原 Skill 阶段格式无效。')
    texts.push({ path, before: text, after: json(value) })
  }
  for (const path of detachedPaths) {
    const text = previous(path)
    if (text !== null) texts.push({ path, before: text, after: json(detachedSchema.parse({ schemaVersion: 1, kind: 'project-copy-detached',
      projectId: record.projectId, operationId: record.operationId, recordHash, path, previousHash: digest(text) })) })
  }
  texts.push({ path: IDENTITY_CURRENT, before: previous(IDENTITY_CURRENT), after: json(pointerSchema.parse({ schemaVersion: 1,
    projectId: record.projectId, operationId: record.operationId, recordHash })) }, { path: LEDGER_PATH, before: previous(LEDGER_PATH), after: json(ledgerSchema.parse(ledger)) })
  invariant(Buffer.byteLength(json(texts)) <= 12 * 1024 * 1024, 'PROJECT_COPY_HISTORY_LIMIT', '身份事务超过可安全恢复的大小限额。')
  return texts
}

// A duplicate-root recovery exemption is derived only from a complete, exact
// copy publication journal. Arbitrary project transactions never receive it.
export async function pendingCopyTransition(io: FileStore): Promise<IdentityTransition | undefined> {
  const journals = await readTransactionJournals(io), candidates = journals.filter(row => row.txn.changes.some(change => /^\.scholarflow\/identity\/history\/project_copy_[a-f0-9]{32}\.json$/u.test(change.path)))
  if (!candidates.length) return undefined
  invariant(candidates.length === 1 && journals.length === 1, 'RECOVERY_CONFLICT', '副本身份恢复不能混合多个未完成事务。')
  const row = candidates[0], pointer = row.txn.changes.find(change => change.path === IDENTITY_CURRENT)?.after
  invariant(pointer, 'PROJECT_COPY_ARCHIVE_INVALID', '副本恢复缺少新身份索引快照。')
  const parsed = parseStored(pointerSchema, pointer.text, 'PROJECT_COPY_ARCHIVE_INVALID', 'project.recover'), archive = row.txn.changes.find(change => change.path === archivePath(parsed.operationId))
  invariant(archive?.after && archive.before === null, 'PROJECT_COPY_ARCHIVE_INVALID', '副本恢复缺少不可变原始档案。')
  const record = validatedRecord(archive.after.text, parsed), expected = publicationTexts(record).map(change => ({ path: change.path,
    before: change.before === null ? null : { text: change.before, hash: digest(change.before) }, after: { text: change.after, hash: digest(change.after) } }))
  invariant(json(expected) === json(row.txn.changes), 'PROJECT_COPY_ARCHIVE_INVALID', '副本恢复目标不是完整、固定的身份变更，未授予重复身份写入例外。')
  return { oldProjectId: record.oldProjectId, projectId: record.projectId, rootFingerprint: record.rootFingerprint,
    oldConfigHash: record.originals.find(image => image.path === CONFIG_PATH)!.contentHash!, newConfigHash: digest(record.newConfigText) }
}

function validatedRecord(text: string, pointer: z.infer<typeof pointerSchema>) {
  invariant(Buffer.byteLength(text) <= 8 * 1024 * 1024 && digest(text) === pointer.recordHash,
    'PROJECT_COPY_ARCHIVE_INVALID', '副本身份历史缺失、过大或摘要改变；未采用历史权限或身份。')
  const parsed = recordSchema.safeParse(JSON.parse(text))
  invariant(parsed.success, 'PROJECT_COPY_ARCHIVE_INVALID', '副本身份历史未通过校验。')
  const record = parsed.data
  invariant(record.operationId === pointer.operationId && record.projectId === pointer.projectId && record.oldProjectId !== record.projectId &&
    new Set(record.originals.map(row => row.path)).size === 11 && record.originals.every(row => row.text === null ? row.contentHash === null : digest(row.text) === row.contentHash),
    'PROJECT_COPY_ARCHIVE_INVALID', '副本身份或原始文件摘要不符。')
  const oldConfig = record.originals.find(row => row.path === CONFIG_PATH)!, oldLedger = record.originals.find(row => row.path === LEDGER_PATH)!
  invariant(oldConfig.text && oldLedger.text && parseConfig(oldConfig.text).project.id === record.oldProjectId &&
    parseLedger(oldLedger.text).projectId === record.oldProjectId && parseConfig(record.newConfigText).project.id === record.projectId,
    'PROJECT_COPY_ARCHIVE_INVALID', '原项目和新项目身份无法从原始快照校验。')
  return record
}

// Ancestry authorizes historical DISPLAY only. It never widens session bindings,
// filesystem permissions, execution, proposal acceptance or paid-call budgets.
export async function verifiedIdentityLineage(io: Pick<FileStore, 'read' | 'stat'>, projectId: string) {
  const file = await io.read(IDENTITY_CURRENT), records: IdentityRecord[] = []
  if (!file) return { records, projectIds: [projectId] }
  let text: string | null = file.text, expected = projectId, totalBytes = 0
  const seen = new Set<string>()
  while (text !== null) {
    invariant(records.length < 16, 'PROJECT_COPY_HISTORY_LIMIT', '副本身份链超过 16 层读取限额，原历史保留。')
    const result = pointerSchema.safeParse(JSON.parse(text))
    invariant(result.success && result.data.projectId === expected && !seen.has(expected), 'PROJECT_COPY_ARCHIVE_INVALID', '副本身份链不能校验或包含循环。')
    seen.add(expected)
    const path = archivePath(result.data.operationId), info = await io.stat(path)
    invariant(info?.type === 'file' && info.size <= 8 * 1024 * 1024 && (totalBytes += info.size) <= 32 * 1024 * 1024,
      'PROJECT_COPY_HISTORY_LIMIT', '副本身份档案缺失、不是普通文件或超出 32 MiB 总读取限额。')
    const archive = await io.read(path)
    invariant(archive, 'PROJECT_COPY_ARCHIVE_INVALID', '副本身份原始档案缺失。')
    const record = validatedRecord(archive.text, result.data); records.push(record)
    text = record.originals.find(row => row.path === IDENTITY_CURRENT)!.text; expected = record.oldProjectId
  }
  invariant(!seen.has(expected), 'PROJECT_COPY_ARCHIVE_INVALID', '副本身份链重复了原始项目。')
  const observed = await io.read(IDENTITY_CURRENT)
  invariant(observed?.text === file.text && observed.version === file.version, 'PROJECT_COPY_CHANGED', '读取期间当前副本身份链改变，请重新读取。')
  return { records, projectIds: [projectId, ...records.map(row => row.oldProjectId)] }
}

// Keep the actual FileImage for subsequent CAS publication. A detached pointer
// is an explicit archived fact, not a missing file or a guessed terminal run.
export async function isDetachedProjectPointer(io: FileStore, path: typeof detachedPaths[number], file: FileImage | undefined) {
  if (!file) return false
  let value: any
  try { value = JSON.parse(file.text) } catch { return false }
  if (value?.kind !== 'project-copy-detached') return false
  const result = detachedSchema.safeParse(value)
  invariant(result.success && result.data.path === path, 'PROJECT_COPY_ARCHIVE_INVALID', '已归档索引未通过校验；未将损坏记录当作空索引。')
  const config = await io.read(CONFIG_PATH)
  invariant(config && parseConfig(config.text).project.id === result.data.projectId, 'PROJECT_ID_CONFLICT', '归档索引不属于当前项目。')
  const lineage = await verifiedIdentityLineage(io, result.data.projectId), current = lineage.records[0]
  invariant(current && current.operationId === result.data.operationId && digest(json(current)) === result.data.recordHash &&
    current.originals.find(row => row.path === path)?.contentHash === result.data.previousHash,
    'PROJECT_COPY_ARCHIVE_INVALID', '归档索引与不可变副本原始记录不一致。')
  return true
}

export interface ProjectCopyPlan {
  id: string; contentHash: string; oldProjectId: string; projectId: string; expectedRevision: number;
  sourceSessionId: string; rootFingerprint: string; reason: string; originals: z.infer<typeof originalSchema>[];
  newConfigText: string; documentHash: string; referencesHash: string
}
export async function prepareProjectCopy(io: FileStore, input: { sourceSessionId: string; rootFingerprint: string; reason: string; expectedRevision: number }): Promise<ProjectCopyPlan> {
  id.parse(input.sourceSessionId); hash.parse(input.rootFingerprint)
  invariant(input.reason.trim().length >= 10 && input.reason.length <= 4000, 'PROJECT_COPY_REASON_REQUIRED', '请说明将当前工作区独立绑定为副本的理由。')
  const current = await snapshot(io)
  invariant(current.ledger.revision === input.expectedRevision, 'STALE_LEDGER_REVISION', '副本项目已改变，请重新读取。')
  invariant(!(await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '先处理未完成事务，再改变项目身份。')
  await readBindings(io, current.config)
  const lineage = await verifiedIdentityLineage(io, current.ledger.projectId)
  invariant(lineage.records.length < 16, 'PROJECT_COPY_HISTORY_LIMIT', '副本身份链已达读取限额，未丢弃历史后继续变更。')
  const originals: ProjectCopyPlan['originals'] = []
  for (const path of [...headerPaths, ...detachedPaths, IDENTITY_CURRENT]) {
    const info = await io.stat(path)
    invariant(!info || info.type === 'file' && info.size <= 2 * 1024 * 1024, 'PROJECT_COPY_HISTORY_LIMIT', '一份身份文件不是普通文件或超过 2 MiB 副本预览限额。')
    const file = await io.read(path); originals.push({ path: ownedPaths.parse(path), text: file?.text ?? null, contentHash: file ? digest(file.text) : null })
  }
  invariant(originals.find(row => row.path === CONFIG_PATH)?.contentHash === current.configHash && originals.find(row => row.path === LEDGER_PATH)?.contentHash === current.ledgerHash,
    'STALE_LEDGER_REVISION', '读取副本原始身份期间项目改变。')
  const approvals = originals.find(row => row.path === MEMORY_APPROVALS)!.text
  if (approvals) invariant(parseStored(memoryApprovalsSchema, approvals, 'PROJECT_COPY_ARCHIVE_INVALID', 'project.copy').projectId === current.ledger.projectId, 'PROJECT_ID_CONFLICT', '原记忆确认记录身份不符。')
  const profile = originals.find(row => row.path === '.scholarflow/profiles/writing-source.json')!.text
  if (profile) invariant(parseStored(projectProfileSourceSchema, profile, 'PROJECT_COPY_ARCHIVE_INVALID', 'project.copy').projectId === current.ledger.projectId, 'PROJECT_ID_CONFLICT', '原文风来源身份不符。')
  const skillStage = originals.find(row => row.path === '.scholarflow/skills/current-stage.json')!.text
  if (skillStage) {
    const row = JSON.parse(skillStage)
    invariant(row?.schemaVersion === 1 && row.projectId === current.ledger.projectId && ['requirements', 'research', 'outline', 'drafting', 'review', 'revision', 'delivery'].includes(row.stage) &&
      typeof row.selectedAt === 'string' && Object.keys(row).sort().join(',') === 'projectId,schemaVersion,selectedAt,stage', 'PROJECT_COPY_INVALID', '原 Skill 阶段记录无法校验。')
  }
  const references = await io.read(current.config.paths.references)
  invariant(references, 'PROJECT_COPY_INVALID', '当前参考文件缺失，未重建或猜测正文版本。')
  const projectId = newId('prj'), yaml = parseDocument(originals.find(row => row.path === CONFIG_PATH)!.text!)
  yaml.setIn(['project', 'id'], projectId); const newConfigText = yaml.toString(); parseConfig(newConfigText)
  const body = { id: newId('project_copy'), oldProjectId: current.ledger.projectId, projectId, expectedRevision: current.ledger.revision,
    sourceSessionId: input.sourceSessionId, rootFingerprint: input.rootFingerprint, reason: input.reason.trim(), originals, newConfigText,
    documentHash: current.document.contentHash, referencesHash: digest(references.text) }
  return { ...body, contentHash: digest(json(body)) }
}

export async function applyProjectCopy(io: FileStore, plan: ProjectCopyPlan) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash && plan.projectId !== plan.oldProjectId, 'INVALID_APPROVAL', '副本确认计划改变。')
  z.array(originalSchema).length(11).parse(plan.originals)
  invariant(new Set(plan.originals.map(row => row.path)).size === 11, 'INVALID_APPROVAL', '副本原始文件清单重复或不完整。')
  return io.lock(async () => {
    const current = await snapshot(io)
    invariant(current.ledger.projectId === plan.oldProjectId && current.ledger.revision === plan.expectedRevision && current.document.contentHash === plan.documentHash &&
      digest((await io.read(current.config.paths.references))?.text ?? '') === plan.referencesHash,
      'STALE_LEDGER_REVISION', '确认期间副本身份、正文或参考文件改变，未重新绑定。')
    invariant(!(await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '副本变更前出现未完成事务，未改变身份。')
    await verifiedIdentityLineage(io, plan.oldProjectId)
    invariant(json(parseConfig(plan.newConfigText)) === json({ ...current.config, project: { ...current.config.project, id: plan.projectId } }),
      'INVALID_APPROVAL', '副本操作只能改变项目身份，不能更换输出路径、策略或其他设置。')
    const before = new Map<string, FileImage | undefined>()
    for (const original of plan.originals) {
      const file = await io.read(original.path)
      invariant((file ? digest(file.text) : null) === original.contentHash && (file?.text ?? null) === original.text, 'PROJECT_COPY_CHANGED', '确认期间副本原始记录改变，未覆盖。')
      before.set(original.path, file)
    }
    const confirmedAt = new Date().toISOString()
    const record = recordSchema.parse({ schemaVersion: 1, operation: 'bind-project-copy', operationId: plan.id, oldProjectId: plan.oldProjectId,
      projectId: plan.projectId, sourceSessionId: plan.sourceSessionId, rootFingerprint: plan.rootFingerprint, reason: plan.reason, confirmedAt,
      originals: plan.originals, newConfigText: plan.newConfigText, documentHash: plan.documentHash, referencesHash: plan.referencesHash,
      retainedContentIds: true, oldExecutionDetached: true })
    const recordText = json(record), archive = archivePath(plan.id)
    invariant(Buffer.byteLength(recordText) <= 8 * 1024 * 1024 && !await io.stat(archive), 'PROJECT_COPY_HISTORY_LIMIT', '副本历史过大或路径已存在，原始记录保留。')
    const mutations = publicationTexts(record).map(row => ({ path: row.path, before: before.get(row.path), after: row.after }))
    await commit(io, mutations)
    return { projectId: plan.projectId, operationId: plan.id, retainedContentIds: true, oldExecutionDetached: true }
  })
}
