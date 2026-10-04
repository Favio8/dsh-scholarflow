import { PrivateSkillLibrary } from './library.ts'
import { digest } from '../../core/store/files.ts'
import { invariant } from '../../shared/errors.ts'
import type { ResourceBinding } from '../../shared/skills.ts'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { packageSkill } from '../../core/skills/package.ts'
import type { SkillStage } from '../../core/skills/bindings.ts'
import type { SkillMetadata } from '../../shared/skills.ts'
import type { FileStore } from '../../core/store/files.ts'
import { resolveProjectSkill } from '../../core/skills/project-resources.ts'

const library = new PrivateSkillLibrary()
const builtinDefinitions: { name: string; capabilities: SkillMetadata['capabilities']; stages: SkillStage[] }[] = [
  { name: 'evidence-grounded-writing', capabilities: ['draft-section'], stages: ['drafting'] },
  { name: 'selection-preserving-revision', capabilities: ['selection-transform'], stages: ['revision'] },
  { name: 'literature-synthesis', capabilities: ['planning', 'draft-section', 'review'], stages: ['outline', 'drafting', 'review'] },
  { name: 'research-results-integrity', capabilities: ['draft-section', 'review'], stages: ['drafting', 'review'] },
]
async function builtinResource(qualifiedId: string) {
  const definition = builtinDefinitions.find(row => `builtin:${row.name}` === qualifiedId)
  invariant(definition, 'SKILL_RESOURCE_MISSING', '内置资源身份不存在。')
  const entry = `academic-skills/${definition.name}/SKILL.md`
  const root = dirname(fileURLToPath(import.meta.resolve('dsh-scholarflow/package.json')))
  return packageSkill(qualifiedId, [{ relativePath: 'SKILL.md', bytes: new Uint8Array(await readFile(join(root, entry))) }],
    { kind: 'builtin', asset: entry }, { capabilities: definition.capabilities, suggestedStages: definition.stages })
}
export async function builtinSkills() {
  const versions = []
  for (const definition of builtinDefinitions) versions.push({ ...(await builtinResource(`builtin:${definition.name}`)).manifest, scope: 'builtin' as const })
  return versions
}
export const libraryEntry = (qualifiedId: string, hash: string) => `${digest(qualifiedId).slice(7)}/${hash.slice(7)}/files/SKILL.md`
export async function readPrivateSkill(binding: ResourceBinding, io?: FileStore) {
  if (binding.scope === 'project') {
    invariant(io, 'SKILL_RESOURCE_UNAVAILABLE', '项目资源需要当前会话验证的工作区网关，不能从其他项目代取。')
    return resolveProjectSkill(io, binding)
  }
  if (binding.scope === 'builtin') {
    const bundle = await builtinResource(binding.qualifiedId)
    invariant(bundle.manifest.digest === binding.digest && bundle.manifest.origin.kind === 'builtin' && bundle.manifest.origin.asset === binding.entryPath,
      'SKILL_DIGEST_MISMATCH', '内置资源版本改变，请明确迁移；未自动更新绑定。')
    return bundle
  }
  invariant(binding.scope === 'library', 'SKILL_RESOURCE_UNAVAILABLE', '此资源类型尚未接入；不会从全局 Skill 目录代取。')
  invariant(binding.entryPath === libraryEntry(binding.qualifiedId, binding.digest), 'SKILL_RESOURCE_PATH_INVALID', '固定资源的入口路径与身份不同。')
  return library.read(binding.qualifiedId, binding.digest)
}
