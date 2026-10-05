import { snapshot, mutateLedger } from '../project/project.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { invariant } from '../../shared/errors.ts'
import { projectSkillSidecar, type ResourceBinding, type SkillBundle } from '../../shared/skills.ts'
import { packageSkill, verifySkill, MAX_INSTRUCTION_BYTES } from './package.ts'
import { projectSkillEntry, readProjectSkill } from './project-resources.ts'
import type { SkillReader } from './bindings.ts'

export interface ProjectSkillCopyPlan {
  id: string; contentHash: string; projectId: string; configHash: string; ledgerHash: string; ledgerRevision: number;
  source: ResourceBinding; sourceManifest: SkillBundle['manifest']; sourceInstructions: string; bundle: SkillBundle; reason: string; sessionId: string;
}
const hashBody = (plan: Omit<ProjectSkillCopyPlan, 'contentHash'>) => {
  const { bundle, ...body } = plan
  return digest(json({ ...body, bundle: bundle.manifest }))
}
export async function prepareProjectSkillCopy(io: FileStore, source: ResourceBinding, reader: SkillReader,
  input: { instructions?: string; capabilities: string[]; suggestedStages: string[]; reason: string; sessionId: string }): Promise<ProjectSkillCopyPlan> {
  invariant(io.createResourceBytes, 'SKILL_RESOURCE_WRITE_UNAVAILABLE', '当前宿主未验证完整静态资源创建能力。')
  invariant(input.reason.trim().length > 0 && input.reason.length <= 4000, 'INVALID_REQUEST', '请填写项目定制或复制的说明，最多 4000 字符。')
  const current = await snapshot(io), original = verifySkill(await reader(source))
  invariant(original.manifest.digest === source.digest && original.manifest.metadata.qualifiedId === source.qualifiedId,
    'SKILL_DIGEST_MISMATCH', '所选源版本的实际字节不同。')
  const options = projectSkillSidecar.parse({ schemaVersion: 1, capabilities: input.capabilities, suggestedStages: input.suggestedStages })
  const resourceId = newId('skill'), qualifiedId = `project:copies:${resourceId}`
  const files = original.files.filter(file => file.relativePath !== 'scholarflow.json').map(file => ({ relativePath: file.relativePath, bytes: new Uint8Array(file.bytes) }))
  if (input.instructions !== undefined) {
    invariant(Buffer.byteLength(input.instructions) <= MAX_INSTRUCTION_BYTES, 'SKILL_INSTRUCTIONS_INVALID', '项目说明最多 64 KiB。')
    files.find(file => file.relativePath === 'SKILL.md')!.bytes = new TextEncoder().encode(input.instructions)
  }
  files.push({ relativePath: 'scholarflow.json', bytes: new TextEncoder().encode(json(options)) })
  const bundle = packageSkill(qualifiedId, files, { kind: 'project', projectId: current.ledger.projectId, namespace: 'copies', resourceId },
    { capabilities: options.capabilities, suggestedStages: options.suggestedStages })
  const body = { id: newId('skill_copy'), projectId: current.ledger.projectId, configHash: current.configHash, ledgerHash: current.ledgerHash,
    ledgerRevision: current.ledger.revision, source: structuredClone(source), sourceManifest: structuredClone(original.manifest), sourceInstructions: original.instructions, bundle,
    reason: input.reason.trim(), sessionId: input.sessionId }
  return { ...body, contentHash: hashBody(body) }
}
export async function applyProjectSkillCopy(io: FileStore, plan: ProjectSkillCopyPlan, reader: SkillReader) {
  const { contentHash, ...body } = plan
  verifySkill(plan.bundle)
  invariant(hashBody(body) === contentHash && plan.bundle.manifest.origin.kind === 'project'
    && plan.bundle.manifest.origin.projectId === plan.projectId, 'INVALID_APPROVAL', '项目 Skill 副本计划发生改变。')
  invariant(io.createResourceBytes, 'SKILL_RESOURCE_WRITE_UNAVAILABLE', '当前文件网关不能安全创建完整资源。')
  const entry = projectSkillEntry(plan.bundle.manifest.metadata.qualifiedId), root = entry.slice(0, -'/SKILL.md'.length)
  return mutateLedger(io, plan.ledgerRevision, async ledger => {
    const current = await snapshot(io)
    invariant(ledger.projectId === plan.projectId && current.configHash === plan.configHash && current.ledgerHash === plan.ledgerHash,
      'STALE_RESOURCE_VERSION', '项目、配置或数据已变化，请重新预览副本。')
    const source = verifySkill(await reader(plan.source))
    invariant(source.manifest.digest === plan.source.digest && source.manifest.metadata.qualifiedId === plan.source.qualifiedId
      && json(source.manifest.files) === json(plan.sourceManifest.files), 'SKILL_DIGEST_MISMATCH', '复制前源版本发生变化，未创建副本。')
    invariant(!await io.stat(root), 'OUTPUT_PATH_CONFLICT', '副本位置已存在，未覆盖或接续未知文件。')
    // Every byte is frozen by the preview. No metadata binds this tree until all
    // files pass read-back verification; aborted copies remain inert/unbound.
    const ordered = [...plan.bundle.files].sort((a, b) => Number(a.relativePath === 'scholarflow.json') - Number(b.relativePath === 'scholarflow.json'))
    for (const file of ordered) await io.createResourceBytes!(`${root}/${file.relativePath}`, file.bytes)
    const actual = await readProjectSkill(io, plan.bundle.manifest.metadata.qualifiedId)
    invariant(actual.manifest.digest === plan.bundle.manifest.digest, 'SKILL_DIGEST_MISMATCH', '完整副本复核失败，未提交来源记录或启用。')
    return [{ path: `.scholarflow/skill-copy-history/${plan.id}.json`, before: undefined, after: json({ schemaVersion: 1, projectId: plan.projectId,
      operationId: plan.id, confirmedAt: new Date().toISOString(), sourceSessionId: plan.sessionId, reason: plan.reason, source: plan.source,
      sourceManifest: plan.sourceManifest, copiedManifest: actual.manifest,
      previousInstructions: source.instructions, currentInstructions: actual.instructions, bindingChanged: false }) }]
  })
}
