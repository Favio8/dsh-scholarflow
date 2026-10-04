import { parseDocument } from 'yaml'
import { z } from 'zod'
import { skillOptions, skillMetadataSchema, skillManifestSchema, type SkillBundle, type SkillFile, type SkillOrigin, type SkillMetadata } from '../../shared/skills.ts'
import { relativePath } from '../../shared/schema.ts'
import { digest, json } from '../store/files.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'
import { sensitivePath } from '../materials/materials.ts'

export const MAX_SKILL_FILES = 200, MAX_SKILL_BYTES = 20 * 1024 * 1024, MAX_INSTRUCTION_BYTES = 65536
const frontmatter = z.object({ name: z.string().min(1).max(64), description: z.string().min(1).max(1024) }).passthrough()
const scripted = /(?:^|\/)scripts\/|\.(?:py|sh|bat|cmd|ps1|js|ts|mjs|cjs|exe|dll|so|dylib|wasm)$/iu

export function describeInstructions(original: string, qualifiedId: string, options: z.infer<typeof skillOptions>, files: SkillFile[]): SkillMetadata {
  invariant(Buffer.byteLength(original) <= MAX_INSTRUCTION_BYTES && !original.includes('\0'), 'SKILL_INSTRUCTIONS_INVALID', 'SKILL.md 必须是最多 64 KiB 的 UTF-8 文本。')
  const lines = original.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  invariant(lines[0] === '---', 'SKILL_FRONTMATTER_REQUIRED', '此目录没有带 name/description frontmatter 的有效 SKILL.md。')
  const end = lines.indexOf('---', 1)
  invariant(end > 0 && end <= 200, 'SKILL_FRONTMATTER_INVALID', 'Skill frontmatter 未正确闭合或过长。')
  const doc = parseDocument(lines.slice(1, end).join('\n'), { uniqueKeys: true })
  invariant(!doc.errors.length && !doc.warnings.length, 'SKILL_FRONTMATTER_INVALID', 'Skill frontmatter 含重复键、不支持的标签或解析错误。')
  let metadata: z.infer<typeof frontmatter>
  try { metadata = frontmatter.parse(doc.toJS({ maxAliasCount: 10 })) }
  catch { throw new ScholarError('SKILL_FRONTMATTER_INVALID', 'Skill name/description 或 YAML 引用未通过校验。') }
  options = skillOptions.parse(options)
  const warnings: string[] = []
  const unsupported = ['allowed-tools', 'hooks', 'mcp', 'dependencies', 'requirements'].filter(key => key in metadata)
  if (unsupported.length) warnings.push(`上游声明 ${unsupported.join('、')} 仅作说明，不授予权限、加载依赖或启动服务。`)
  if (files.some(file => scripted.test(file.relativePath))) warnings.push('附带脚本或程序只作为固定资源保存；ScholarFlow 不执行它们。')
  if (/(?:\b(?:run|execute|install)\b.{0,80}(?:scripts\/|pip |npm |bash |python)|(?:运行|执行|安装).{0,80}(?:脚本|依赖|程序))/iu.test(original))
    warnings.push('说明包含运行程序或安装依赖的步骤；V1 不兑现这些步骤，实际兼容性为部分支持。')
  return skillMetadataSchema.parse({ schemaVersion: 1, qualifiedId, displayName: metadata.name, description: metadata.description, entry: 'SKILL.md',
    capabilities: [...new Set(options.capabilities)], suggestedStages: [...new Set(options.suggestedStages)], invocation: 'manual-or-stage',
    executionPolicy: 'instructions-only', compatibility: warnings.length ? 'partial' : 'compatible', warnings })
}

export function packageSkill(qualifiedId: string, files: SkillFile[], origin: SkillOrigin, options: z.infer<typeof skillOptions>): SkillBundle {
  invariant(files.length > 0 && files.length <= MAX_SKILL_FILES, 'SKILL_PACKAGE_TOO_LARGE', '单个 Skill 最多包含 200 个文件。')
  const names = new Set<string>(), copied: SkillFile[] = []
  let total = 0
  for (const file of files) {
    const path = relativePath.parse(file.relativePath), key = path.normalize('NFC').toLowerCase()
    invariant(!names.has(key) && !sensitivePath(path) && !path.split('/').some(part => ['.git', '.hg', '.svn', 'node_modules'].includes(part.toLowerCase())),
      'SKILL_PATH_INVALID', 'Skill 文件含重复路径、敏感文件或依赖目录。')
    names.add(key); total += file.bytes.byteLength
    invariant(total <= MAX_SKILL_BYTES, 'SKILL_PACKAGE_TOO_LARGE', '单个 Skill 的文件总量最多 20 MiB。')
    // Freeze caller-owned buffers before computing the preview hash.
    copied.push({ relativePath: path, bytes: new Uint8Array(file.bytes) })
  }
  copied.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0)
  const entry = copied.find(file => file.relativePath === 'SKILL.md')
  invariant(entry && entry.bytes.byteLength <= MAX_INSTRUCTION_BYTES, 'SKILL_ENTRY_MISSING', '必须选择含有效 SKILL.md 的具体 Skill 目录。')
  let instructions: string
  try { instructions = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.bytes) }
  catch { throw new ScholarError('SKILL_INSTRUCTIONS_INVALID', 'SKILL.md 不是有效 UTF-8。') }
  const metadata = describeInstructions(instructions, qualifiedId, options, copied)
  const entries = copied.map(file => ({ relativePath: file.relativePath, hash: digest(file.bytes), sizeBytes: file.bytes.byteLength }))
  const resourceDigest = digest(json({ metadata, files: entries }))
  const manifest = skillManifestSchema.parse({ schemaVersion: 1, metadata, digest: resourceDigest, origin, files: entries, installedAt: new Date().toISOString() })
  return { manifest, files: copied, instructions }
}

export function verifySkill(bundle: SkillBundle) {
  const manifest = skillManifestSchema.parse(bundle.manifest)
  invariant(bundle.files.length === manifest.files.length, 'SKILL_DIGEST_MISMATCH', '固定 Skill 的文件清单发生改变。')
  const files = [...bundle.files].sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0)
  const entries = files.map(file => ({ relativePath: relativePath.parse(file.relativePath), hash: digest(file.bytes), sizeBytes: file.bytes.byteLength }))
  invariant(json(entries) === json(manifest.files) && digest(json({ metadata: manifest.metadata, files: entries })) === manifest.digest,
    'SKILL_DIGEST_MISMATCH', '固定 Skill 的实际文件字节与清单或资源摘要不同。')
  // Reapply import bounds and derive compatibility from the original bytes.
  // A hand-edited manifest cannot turn a scripted Skill into a compatible one.
  const rebuilt = packageSkill(manifest.metadata.qualifiedId, bundle.files, manifest.origin,
    { capabilities: manifest.metadata.capabilities, suggestedStages: manifest.metadata.suggestedStages })
  invariant(json(rebuilt.manifest.metadata) === json(manifest.metadata), 'SKILL_DIGEST_MISMATCH', '资源兼容性说明与原文件不一致。')
  const entry = files.find(file => file.relativePath === 'SKILL.md')
  invariant(entry && new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.bytes) === bundle.instructions,
    'SKILL_DIGEST_MISMATCH', '加载的 Skill 说明与已固定原文件不同。')
  return bundle
}
