import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { digest } from '../../core/store/files.ts'
import { packageSkill, MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_INSTRUCTION_BYTES } from '../../core/skills/package.ts'
import { sensitivePath } from '../../core/materials/materials.ts'
import { relativePath } from '../../shared/schema.ts'
import { skillOptions, type SkillFile } from '../../shared/skills.ts'
import { invariant } from '../../shared/errors.ts'
import type { z } from 'zod'

const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const excluded = (path: string) => sensitivePath(path) || path.split('/').some(part => ['.git', '.hg', '.svn', 'node_modules'].includes(part.toLowerCase()))
const contained = (root: string, path: string) => { const subpath = relative(root, path); return subpath !== '..' && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath) }

// A separate, operator-selected source root. No workspace/session permission is
// widened, and callers never receive a general-purpose native filesystem API.
export class LocalSkillSource {
  readonly root: string
  readonly fingerprint: string
  private constructor(root: string, fingerprint: string) { this.root = root; this.fingerprint = fingerprint }
  static async open(path: string) {
    invariant(path.length <= 4000 && isAbsolute(path) && !path.includes('\0'), 'SKILL_SOURCE_INVALID', '请选择 Host 上的绝对目录。')
    const selected = resolve(path), info = await lstat(selected)
    invariant(info.isDirectory() && !info.isSymbolicLink(), 'SKILL_SOURCE_INVALID', 'Skill 来源必须是普通目录，不能是目录链接。')
    const root = await realpath(selected)
    return new LocalSkillSource(root, digest(process.platform === 'win32' ? root.toLowerCase() : root))
  }
  private async checked(path: string, kind: 'file' | 'directory') {
    invariant(contained(this.root, path), 'SKILL_SOURCE_INVALID', 'Skill 路径超出所选目录。')
    const info = await lstat(path)
    invariant(!info.isSymbolicLink() && (kind === 'file' ? info.isFile() && info.nlink === 1 : info.isDirectory()) && same(await realpath(path), path),
      'SKILL_SOURCE_LINK', '来源含链接或特殊文件，未读取链接目标。')
    return info
  }
  async discover(signal: AbortSignal) {
    await this.checked(this.root, 'directory')
    const candidates: { subpath: string; instructionBytes: number }[] = [], diagnostics: string[] = []
    let visited = 0
    const walk = async (directory: string, prefix: string, depth: number) => {
      signal.throwIfAborted()
      invariant(++visited <= 1000 && depth <= 16, 'SKILL_DISCOVERY_TOO_LARGE', '来源目录过大，请选择更具体的 Skill 目录。')
      await this.checked(directory, 'directory')
      const entries = await readdir(directory, { withFileTypes: true })
      invariant(entries.length <= 1000, 'SKILL_DISCOVERY_TOO_LARGE', '来源目录内容过多，请缩小选择范围。')
      for (const entry of entries) {
        signal.throwIfAborted()
        const subpath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (excluded(subpath)) { diagnostics.push('已跳过敏感文件或版本控制、依赖目录。'); continue }
        if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) { diagnostics.push('已跳过链接或特殊文件。'); continue }
        if (entry.name === 'SKILL.md' && entry.isFile()) {
          const info = await this.checked(join(directory, entry.name), 'file')
          if (info.size <= MAX_INSTRUCTION_BYTES) candidates.push({ subpath: prefix, instructionBytes: info.size })
          else diagnostics.push('一个 SKILL.md 超出 64 KiB，未列为候选。')
          invariant(candidates.length <= 100, 'SKILL_DISCOVERY_TOO_LARGE', 'Skill 候选过多，请选择子目录。')
        }
        if (entry.isDirectory()) await walk(join(directory, entry.name), subpath, depth + 1)
      }
    }
    await walk(this.root, '', 0)
    return { candidates, diagnostics: [...new Set(diagnostics)] }
  }
  async package(subpath: string, options: z.infer<typeof skillOptions>, signal: AbortSignal) {
    if (subpath) relativePath.parse(subpath)
    let directory = this.root
    for (const part of subpath ? subpath.split('/') : []) { directory = join(directory, part); await this.checked(directory, 'directory') }
    await this.checked(directory, 'directory')
    const files: SkillFile[] = []
    let total = 0, visited = 0
    const walk = async (path: string, prefix: string, depth: number) => {
      signal.throwIfAborted()
      invariant(++visited <= 400 && depth <= 16, 'SKILL_PACKAGE_TOO_LARGE', 'Skill 目录树过大，请缩小选择范围。')
      await this.checked(path, 'directory')
      const entries = await readdir(path, { withFileTypes: true })
      invariant(entries.length <= MAX_SKILL_FILES, 'SKILL_PACKAGE_TOO_LARGE', 'Skill 目录文件数超出上限。')
      for (const entry of entries) {
        signal.throwIfAborted()
        const name = prefix ? `${prefix}/${entry.name}` : entry.name
        relativePath.parse(name)
        invariant(!excluded(name), 'SKILL_PATH_INVALID', '具体 Skill 中含敏感文件或依赖目录；请先清理来源副本。')
        invariant(!entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory()), 'SKILL_SOURCE_LINK', '具体 Skill 中含链接或特殊文件，未导入。')
        const full = join(path, entry.name)
        if (entry.isDirectory()) { await walk(full, name, depth + 1); continue }
        const before = await this.checked(full, 'file')
        total += before.size
        invariant(total <= MAX_SKILL_BYTES && files.length < MAX_SKILL_FILES, 'SKILL_PACKAGE_TOO_LARGE', '单个 Skill 最多 200 个文件、20 MiB。')
        if (name === 'SKILL.md') invariant(before.size <= MAX_INSTRUCTION_BYTES, 'SKILL_INSTRUCTIONS_INVALID', 'SKILL.md 超出 64 KiB。')
        const bytes = new Uint8Array(await readFile(full)), after = await this.checked(full, 'file')
        invariant(bytes.byteLength === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino,
          'SKILL_SOURCE_CHANGED', '读取期间来源文件发生改变，请重新预览。')
        files.push({ relativePath: name, bytes })
      }
    }
    await walk(directory, '', 0)
    const licenseFile = files.find(file => /^(?:license|copying)(?:\.[a-z0-9]+)?$/iu.test(file.relativePath))
    let license: string | undefined
    if (licenseFile && licenseFile.bytes.byteLength <= 65536) {
      try { license = new TextDecoder('utf-8', { fatal: true }).decode(licenseFile.bytes).slice(0, 2000) } catch { /* Keep binary original; no invented license. */ }
    }
    return packageSkill(`local:${this.fingerprint.slice(7, 23)}:${subpath || 'root'}`, files,
      { kind: 'local', rootFingerprint: this.fingerprint, subpath, ...(license && { license }) }, options)
  }
}
