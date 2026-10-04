import { projectSkillSidecar, type ResourceBinding, type SkillFile, type SkillManifest } from '../../shared/skills.ts'
import { relativePath } from '../../shared/schema.ts'
import { invariant } from '../../shared/errors.ts'
import { snapshot } from '../project/project.ts'
import { type FileStore } from '../store/files.ts'
import { packageSkill, MAX_SKILL_BYTES, MAX_SKILL_FILES } from './package.ts'
import { sensitivePath } from '../materials/materials.ts'

const ROOT = '.scholarflow/skills'
const segment = (part: string) => { invariant(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/u.test(part), 'SKILL_RESOURCE_PATH_INVALID', '项目资源命名空间和标识必须是普通单层目录名。'); relativePath.parse(part); return part }
export const projectSkillEntry = (qualifiedId: string) => {
  const parts = qualifiedId.split(':')
  invariant(parts.length === 3 && parts[0] === 'project', 'SKILL_RESOURCE_PATH_INVALID', '项目资源身份必须为 project:namespace:id。')
  return `${ROOT}/${segment(parts[1])}/${segment(parts[2])}/SKILL.md`
}
function capable(io: FileStore) {
  invariant(io.resourceStat && io.readResourceBytes, 'SKILL_RESOURCE_UNAVAILABLE', '当前文件网关未验证项目静态资源读取能力，未代用原始资料或全局目录。')
  return { stat: io.resourceStat.bind(io), bytes: io.readResourceBytes.bind(io) }
}
export async function readProjectSkill(io: FileStore, qualifiedId: string, chargeBytes?: (size: number) => void) {
  const capability = capable(io), entry = projectSkillEntry(qualifiedId), root = entry.slice(0, -'/SKILL.md'.length)
  const parts = qualifiedId.split(':'), current = await snapshot(io)
  invariant((await capability.stat(root))?.type === 'directory', 'SKILL_RESOURCE_MISSING', '项目 Skill 目录不存在。')
  const files: SkillFile[] = [], seen = new Set<string>(); let total = 0, directories = 0
  const visit = async (directory: string, prefix: string, depth: number) => {
    invariant(++directories <= 400 && depth <= 16, 'SKILL_PACKAGE_TOO_LARGE', '项目 Skill 目录树过大。')
    invariant((await capability.stat(directory))?.type === 'directory', 'SKILL_SOURCE_LINK', '项目 Skill 目录不是普通目录。')
    const rows = await io.list(directory)
    invariant(rows.length <= 200, 'SKILL_PACKAGE_TOO_LARGE', '项目 Skill 单个目录内容过多。')
    for (const row of rows) {
      invariant(row.path.startsWith(directory + '/') && !row.path.slice(directory.length + 1).includes('/'), 'SKILL_RESOURCE_PATH_INVALID', '资源清单返回了非直属路径。')
      const name = row.path.slice(directory.length + 1), path = prefix ? `${prefix}/${name}` : name
      relativePath.parse(path)
      invariant(!sensitivePath(path) && !path.split('/').some(part => ['.git', '.hg', '.svn', 'node_modules'].includes(part.toLowerCase())), 'SKILL_PATH_INVALID', '项目 Skill 包含敏感内容或依赖目录。')
      const key = path.normalize('NFC').toLowerCase()
      invariant(!seen.has(key), 'SKILL_PATH_INVALID', '项目 Skill 含路径大小写或 Unicode 别名。'); seen.add(key)
      const info = await capability.stat(row.path)
      invariant(info, 'SKILL_SOURCE_CHANGED', '项目 Skill 清单读取期间发生变化。')
      if (info.type === 'directory') { await visit(row.path, path, depth + 1); continue }
      invariant(info.type === 'file', 'SKILL_SOURCE_LINK', '项目 Skill 含链接或特殊文件。')
      if (['SKILL.md', 'scholarflow.json'].includes(path)) invariant(info.size <= 65536, 'SKILL_INSTRUCTIONS_INVALID', '项目说明或侧车超过 64 KiB，未读取内容。')
      total += info.size
      invariant(total <= MAX_SKILL_BYTES && files.length < MAX_SKILL_FILES, 'SKILL_PACKAGE_TOO_LARGE', '项目 Skill 最多 200 个文件、20 MiB。')
      chargeBytes?.(info.size)
      files.push({ relativePath: path, bytes: await capability.bytes(row.path, Math.max(1, info.size)) })
    }
  }
  await visit(root, '', 0)
  const sidecar = files.find(file => file.relativePath === 'scholarflow.json')
  invariant(sidecar && sidecar.bytes.byteLength <= 65536, 'SKILL_METADATA_REQUIRED', '项目 Skill 需要 scholarflow.json 侧车声明 schemaVersion、capabilities 与 suggestedStages；不修改上游 SKILL.md。')
  const options = projectSkillSidecar.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(sidecar.bytes)))
  return packageSkill(qualifiedId, files, { kind: 'project', projectId: current.ledger.projectId, namespace: parts[1], resourceId: parts[2] },
    { capabilities: options.capabilities, suggestedStages: options.suggestedStages })
}
export async function resolveProjectSkill(io: FileStore, binding: ResourceBinding) {
  invariant(binding.scope === 'project' && binding.entryPath === projectSkillEntry(binding.qualifiedId), 'SKILL_RESOURCE_PATH_INVALID', '项目固定绑定不能指向其他资源路径。')
  const bundle = await readProjectSkill(io, binding.qualifiedId)
  invariant(bundle.manifest.digest === binding.digest, 'SKILL_DIGEST_MISMATCH', '项目资源字节或侧车路由改变；请明确预览新版本绑定，未自动采用。')
  return bundle
}
export async function listProjectSkills(io: FileStore) {
  const capability = capable(io), versions: (SkillManifest & { scope: 'project' })[] = [], diagnostics: string[] = []
  if (!await capability.stat(ROOT)) return { versions, diagnostics }
  const rootEntries = await io.list(ROOT)
  invariant(rootEntries.length <= 1000, 'SKILL_DISCOVERY_TOO_LARGE', '项目 Skill 根目录内容过多。')
  const namespaces = rootEntries.filter(row => row.type === 'directory')
  invariant(namespaces.length <= 100, 'SKILL_DISCOVERY_TOO_LARGE', '项目 Skill 命名空间过多。')
  let count = 0, remainingBytes = MAX_SKILL_BYTES
  for (const namespace of namespaces) {
    let resources
    try {
      segment(namespace.path.split('/').at(-1)!)
      invariant((await capability.stat(namespace.path))?.type === 'directory', 'SKILL_SOURCE_LINK', '项目命名空间不是普通目录。')
      resources = await io.list(namespace.path)
    } catch { diagnostics.push('一个项目 Skill 命名空间不合法或含链接，未读取其中资源。'); continue }
    invariant(resources.length <= 200, 'SKILL_DISCOVERY_TOO_LARGE', '项目 Skill 命名空间内容过多。')
    for (const resource of resources.filter(row => row.type === 'directory')) {
      invariant(++count <= 100, 'SKILL_DISCOVERY_TOO_LARGE', '项目 Skill 候选过多。')
      const qualifiedId = `project:${namespace.path.split('/').at(-1)}:${resource.path.split('/').at(-1)}`
      try { const bundle = await readProjectSkill(io, qualifiedId, size => {
        invariant(size <= remainingBytes, 'SKILL_DISCOVERY_TOO_LARGE', '项目 Skill 清单累计内容读取超过 20 MiB，请减少资源或范围。'); remainingBytes -= size
      }); versions.push({ ...bundle.manifest, scope: 'project' as const }) }
      catch { diagnostics.push('一个项目 Skill 缺失、不合法、含链接或超出能力限额，未列为可启用资源。') }
    }
  }
  return { versions, diagnostics: [...new Set(diagnostics)] }
}
