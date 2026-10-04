import { z } from 'zod'
import { parseDocument } from 'yaml'
import { snapshot, mutateLedger, invalidateReviews, CONFIG_PATH, parseConfig } from '../project/project.ts'
import { digest, newId, json, type FileStore } from '../store/files.ts'
import type { Mutation } from '../store/transactions.ts'
import { resourceLockSchema, resourceBindingSchema, type ResourceBinding, type SkillBundle } from '../../shared/skills.ts'
import { stage, type ProjectConfig } from '../../shared/schema.ts'
import { verifySkill } from './package.ts'
import { invariant } from '../../shared/errors.ts'

export const RESOURCE_LOCK = '.scholarflow/resources.lock.json'
const legacyLock = z.object({ schemaVersion: z.literal(1), projectId: z.string(), skills: z.array(z.unknown()), profiles: z.array(z.unknown()) }).strict()
export type SkillReader = (binding: ResourceBinding) => Promise<SkillBundle>
export type SkillStage = z.infer<typeof stage>
const STAGE_PATH = '.scholarflow/skills/current-stage.json'
const stageRecord = z.object({ schemaVersion: z.literal(1), projectId: z.string(), stage, selectedAt: z.string() }).strict()
export async function currentSkillStage(io: FileStore) {
  const current = await snapshot(io), file = await io.read(STAGE_PATH)
  if (!file) return { stage: 'drafting' as const, source: 'default' }
  const row = stageRecord.parse(JSON.parse(file.text))
  invariant(row.projectId === current.ledger.projectId, 'PROJECT_ID_CONFLICT', 'Skill 调用阶段不属于当前项目。')
  return { stage: row.stage, source: 'operator' }
}
export async function selectSkillStage(io: FileStore, selectedStage: SkillStage, revision: number) {
  return mutateLedger(io, revision, async ledger => [{ path: STAGE_PATH, before: await io.read(STAGE_PATH),
    after: json(stageRecord.parse({ schemaVersion: 1, projectId: ledger.projectId, stage: selectedStage, selectedAt: new Date().toISOString() })) }])
}
export interface BindingPlan { id: string; contentHash: string; projectId: string; configHash: string; lockHash: string; ledgerHash: string;
  ledgerRevision: number; bindings: ResourceBinding[]; legacyMigration: boolean }

export async function readBindings(io: FileStore, config: ProjectConfig) {
  const file = await io.read(RESOURCE_LOCK)
  invariant(file, 'SKILL_RESOURCE_LOCK_MISSING', '项目资源锁缺失，未重建或采用其他版本。')
  const raw: unknown = JSON.parse(file.text), current = resourceLockSchema.safeParse(raw)
  if (current.success) {
    invariant(current.data.projectId === config.project.id, 'PROJECT_ID_CONFLICT', '资源锁不属于当前项目。')
    const keys = current.data.bindings.map(binding => binding.bindingId)
    invariant(new Set(keys).size === keys.length && keys.length === config.skills.bindings.length
      && config.skills.bindings.every((row, index) => row.ref === current.data.bindings[index].bindingId && json(row.stages) === json(current.data.bindings[index].enabledStages)),
      'SKILL_BINDING_MISMATCH', '项目配置与资源锁的启用清单或优先顺序不同，请明确重新绑定。')
    return { bindings: current.data.bindings, legacyMigration: false, file }
  }
  const legacy = legacyLock.safeParse(raw)
  invariant(legacy.success && legacy.data.projectId === config.project.id && legacy.data.skills.length === 0 && config.skills.bindings.length === 0,
    'SKILL_RESOURCE_LOCK_INVALID', '资源锁无效或包含无法解析的旧绑定；保留原文件，请检查后迁移。')
  return { bindings: [] as ResourceBinding[], legacyMigration: true, file }
}

export async function prepareBindings(io: FileStore, bindings: ResourceBinding[], reader: SkillReader): Promise<BindingPlan> {
  const current = await snapshot(io), previous = await readBindings(io, current.config)
  bindings = z.array(resourceBindingSchema).max(30).parse(bindings)
  invariant(new Set(bindings.map(row => row.bindingId)).size === bindings.length && new Set(bindings.map(row => row.qualifiedId)).size === bindings.length,
    'SKILL_BINDING_CONFLICT', '同一 Skill 只能选择一个固定版本；优先顺序需明确。')
  for (const binding of bindings) {
    invariant(binding.enabledStages.length > 0 && new Set(binding.enabledStages).size === binding.enabledStages.length, 'SKILL_STAGE_INVALID', '启用阶段不能为空或重复。')
    const bundle = verifySkill(await reader(binding))
    invariant(bundle.manifest.metadata.qualifiedId === binding.qualifiedId && bundle.manifest.digest === binding.digest, 'SKILL_DIGEST_MISMATCH', '实际资源与所选版本不同。')
  }
  const body = { id: newId('skill_bindings'), projectId: current.config.project.id, configHash: current.configHash, lockHash: digest(previous.file.text),
    ledgerHash: current.ledgerHash, ledgerRevision: current.ledger.revision, bindings, legacyMigration: previous.legacyMigration }
  return { ...body, contentHash: digest(json(body)) }
}

export async function applyBindings(io: FileStore, plan: BindingPlan) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', 'Skill 绑定计划发生改变。')
  return mutateLedger(io, plan.ledgerRevision, async (ledger, config) => {
    invariant(ledger.projectId === plan.projectId, 'PROJECT_ID_CONFLICT', '绑定计划不属于当前项目。')
    const previous = await readBindings(io, config), configFile = await io.read(CONFIG_PATH)
    invariant(configFile && digest(configFile.text) === plan.configHash && digest(previous.file.text) === plan.lockHash
      && (await snapshot(io)).ledgerHash === plan.ledgerHash, 'STALE_RESOURCE_VERSION', '确认期间配置、资源锁或项目发生变化，未覆盖。')
    const document = parseDocument(configFile.text, { uniqueKeys: true })
    // Edit only the plugin-owned binding key; preserve unknown YAML and comments.
    document.setIn(['skills', 'bindings'], plan.bindings.map(row => ({ ref: row.bindingId, stages: row.enabledStages })))
    const nextConfig = document.toString(); parseConfig(nextConfig)
    const lock = resourceLockSchema.parse({ schemaVersion: 1, projectId: ledger.projectId, bindings: plan.bindings, resolvedAt: new Date().toISOString() })
    const historyPath = `.scholarflow/resource-lock-history/${plan.id}.json`
    const mutations: Mutation[] = [{ path: historyPath, before: undefined, after: json({ schemaVersion: 1, projectId: ledger.projectId,
      changedAt: new Date().toISOString(), planId: plan.id, previousConfig: configFile.text, previousResourceLock: previous.file.text, nextBindings: plan.bindings }) },
    { path: CONFIG_PATH, before: configFile, after: nextConfig }, { path: RESOURCE_LOCK, before: previous.file, after: json(lock) }]
    invalidateReviews(ledger)
    return mutations
  })
}

export async function resolveStageSkills(io: FileStore, selectedStage: SkillStage, reader?: SkillReader, selectedBindingId?: string) {
  const current = await snapshot(io), locked = await readBindings(io, current.config)
  const bindings = locked.bindings.filter(row => row.enabledStages.includes(selectedStage) && (!selectedBindingId || row.bindingId === selectedBindingId))
  invariant(!selectedBindingId || bindings.length === 1, 'SKILL_STAGE_DENIED', '所选 Skill 未在此项目阶段启用。')
  invariant(!bindings.length || reader, 'SKILL_BINDING_UNAVAILABLE', '当前阶段需要固定 Skill 读取器，不能忽略启用项。')
  const resources = []
  for (const binding of bindings) {
    const bundle = verifySkill(await reader!(binding))
    invariant(bundle.manifest.metadata.qualifiedId === binding.qualifiedId && bundle.manifest.digest === binding.digest, 'SKILL_DIGEST_MISMATCH', '固定资源身份发生变化。')
    if (selectedBindingId) invariant(selectedStage === 'revision' && bundle.manifest.metadata.compatibility === 'compatible'
      && bundle.manifest.metadata.capabilities.includes('selection-transform'), 'SKILL_SELECTION_UNAVAILABLE', '此固定版本不是兼容的选区改写 Skill。')
    const references: { relativePath: string; content: string; hash: string }[] = [], warnings = [...bundle.manifest.metadata.warnings]
    let total = 0
    for (const file of bundle.files) {
      if (!/^references\/.*\.(?:md|txt|json|yaml|yml)$/iu.test(file.relativePath)) continue
      if (total + file.bytes.byteLength > 65536) { warnings.push(`静态参考 ${file.relativePath} 超出本阶段 64 KiB 参考预算，未注入。`); continue }
      try { const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes); total += file.bytes.byteLength
        references.push({ relativePath: file.relativePath, content, hash: digest(file.bytes) }) } catch { warnings.push(`静态参考 ${file.relativePath} 不是 UTF-8，未注入。`) }
    }
    resources.push({ priority: resources.length + 1, bindingId: binding.bindingId, qualifiedId: binding.qualifiedId, digest: binding.digest,
      metadata: structuredClone(bundle.manifest.metadata), instructions: bundle.instructions, references, warnings })
  }
  return { resources, resourceLockHash: digest(locked.file.text) }
}
