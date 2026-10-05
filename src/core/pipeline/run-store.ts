import { id } from '../../shared/schema.ts'
import { runStateSchema, runSnapshotSchema, type RunState } from '../../shared/runs.ts'
import { invariant } from '../../shared/errors.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { commit, inspectRecovery } from '../store/transactions.ts'
import { snapshot } from '../project/project.ts'
import { verifiedIdentityLineage } from '../project/identity.ts'

export const ACTIVE_RUN = '.scholarflow/runs/active.json'
export const runFile = (runId: string) => `.scholarflow/runs/${id.parse(runId)}/run.json`
export const inputFile = (runId: string) => `.scholarflow/runs/${id.parse(runId)}/input.json`
export async function readRun(io: FileStore, runId: string, projectId: string) {
  const primary = await io.read(runFile(runId)), legacyPath = `.scholarflow/runs/${id.parse(runId)}/state.json`, legacy = await io.read(legacyPath)
  invariant(primary || legacy, 'RUN_NOT_FOUND', '运行状态不存在。')
  const row = runStateSchema.parse(JSON.parse((primary ?? legacy)!.text))
  invariant(row.runId === runId && row.projectId === projectId, 'PROJECT_ID_CONFLICT', '运行状态身份不属于当前项目或运行目录。')
  // Once run.json exists it is the only authority. A preserved legacy state is
  // an archive, not an automatically synchronized second state file.
  return { run: row, file: (primary ?? legacy)!, path: primary ? runFile(runId) : legacyPath, legacy: !primary }
}
export async function readRunInput(io: FileStore, runId: string, projectId: string) {
  const primary = await io.read(inputFile(runId)), legacy = await io.read(`.scholarflow/runs/${id.parse(runId)}/snapshot.json`)
  invariant(primary || legacy, 'RUN_INPUT_MISSING', '运行输入快照缺失，不能猜测或重建。')
  const row = runSnapshotSchema.parse(JSON.parse((primary ?? legacy)!.text))
  invariant(row.runId === runId && row.projectId === projectId, 'PROJECT_ID_CONFLICT', '运行输入不属于当前项目或运行目录。')
  return { snapshot: row, file: (primary ?? legacy)!, legacy: !primary }
}
export async function inspectRuns(io: FileStore) {
  const current = await snapshot(io), rows: (RunState & { legacyStorage: boolean; inheritedArchive: boolean })[] = [], diagnostics: string[] = [], root = '.scholarflow/runs'
  const lineage = await verifiedIdentityLineage(io, current.ledger.projectId)
  if (!await io.stat(root)) return { runs: rows, diagnostics }
  const entries = await io.list(root)
  invariant(entries.length <= 1000, 'RUN_HISTORY_TOO_LARGE', '运行历史超过当前读取限额，请缩小历史范围。')
  for (const entry of entries.filter(row => row.type === 'directory' && /^run_[\w.-]+$/u.test(row.path.split('/').at(-1)!))) {
    try {
      const runId = entry.path.split('/').at(-1)!, image = await io.read(runFile(runId)) ?? await io.read(`.scholarflow/runs/${runId}/state.json`)
      invariant(image, 'RUN_NOT_FOUND', '历史运行缺失。')
      const identity = runStateSchema.parse(JSON.parse(image.text)).projectId
      invariant(lineage.projectIds.includes(identity), 'PROJECT_ID_CONFLICT', '历史运行不属于当前项目或已校验的副本来源。')
      const stored = await readRun(io, runId, identity)
      rows.push({ ...stored.run, legacyStorage: stored.legacy, inheritedArchive: identity !== current.ledger.projectId }) }
    catch { diagnostics.push('一个运行记录缺失、不合法或身份不匹配，未采用其状态。') }
  }
  return { runs: rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt)), diagnostics: [...new Set(diagnostics)] }
}
export async function prepareRunMigration(io: FileStore, runId: string) {
  const current = await snapshot(io), stored = await readRun(io, runId, current.ledger.projectId), input = await readRunInput(io, runId, current.ledger.projectId)
  invariant(stored.legacy || input.legacy, 'RUN_MIGRATION_UNNECESSARY', '该运行已经使用约定的事实源。')
  invariant(!['running', 'queued', 'waiting-input'].includes(stored.run.status), 'RUN_IN_PROGRESS', '执行中的旧运行须先结束或明确处理中断，再迁移存储。')
  const active = await io.read(ACTIVE_RUN)
  const body = { id: newId('run_migration'), projectId: current.ledger.projectId, runId, stateHash: digest(stored.file.text), inputHash: digest(input.file.text),
    statePath: stored.path, legacyState: stored.legacy, legacyInput: input.legacy, activeHash: active ? digest(active.text) : null }
  return { ...body, contentHash: digest(json(body)) }
}
export async function migrateRun(io: FileStore, plan: Awaited<ReturnType<typeof prepareRunMigration>>) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', '运行迁移计划改变。')
  return io.lock(async () => {
    const current = await snapshot(io)
    invariant(current.ledger.projectId === plan.projectId && !(await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length,
      'RECOVERY_REQUIRED', '先处理未完成事务或当前项目身份。')
    const stored = await readRun(io, plan.runId, plan.projectId), input = await readRunInput(io, plan.runId, plan.projectId), active = await io.read(ACTIVE_RUN)
    invariant(stored.legacy === plan.legacyState && input.legacy === plan.legacyInput && stored.path === plan.statePath &&
      digest(stored.file.text) === plan.stateHash && digest(input.file.text) === plan.inputHash && (active ? digest(active.text) : null) === plan.activeHash,
      'RUN_STATE_CHANGED', '确认期间运行状态或输入改变，未迁移。')
    await commit(io, [
      { path: `.scholarflow/runs/${plan.runId}/storage-history/${plan.id}.json`, before: undefined,
        after: json({ schemaVersion: 1, projectId: plan.projectId, runId: plan.runId, previousState: stored.file.text, previousInput: input.file.text, migratedAt: new Date().toISOString() }) },
      ...(stored.legacy ? [{ path: runFile(plan.runId), before: undefined, after: stored.file.text }] : []),
      ...(input.legacy ? [{ path: inputFile(plan.runId), before: undefined, after: input.file.text }] : []),
    ])
    return { runId: plan.runId, migrated: true, originalArchivesRetained: true }
  })
}
