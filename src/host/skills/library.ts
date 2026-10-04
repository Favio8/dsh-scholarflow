import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { skillManifestSchema, type SkillBundle, type SkillManifest } from '../../shared/skills.ts'
import { relativePath } from '../../shared/schema.ts'
import { digest, json } from '../../core/store/files.ts'
import { verifySkill, MAX_SKILL_BYTES, MAX_SKILL_FILES } from '../../core/skills/package.ts'
import { invariant } from '../../shared/errors.ts'

const key = (qualifiedId: string) => digest(qualifiedId).slice(7)
const same = (left: string, right: string) => process.platform === 'win32' ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right)
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
async function observed(path: string) { try { return await lstat(path) } catch (error) { if (missing(error)) return undefined; throw error } }

// Application-owned storage, like the Host settings/credential stores. This is
// NOT a workspace fs adapter or a manufactured unrestricted session policy.
// Only authenticated operator import/removal Remotes may mutate it. Model tools
// get immutable, project-bound resource readers, never this writer or paths.
export class PrivateSkillLibrary {
  private readonly home: string
  constructor(home = resolveDshHome()) { this.home = resolve(home) }
  async withCatalogLock<T>(operation: () => Promise<T>): Promise<T> {
    const root = await this.root()
    if (!root) return operation() // No installed library version exists yet.
    return withFileLock(join(root, 'catalog-owner.json'), async () => {
      invariant(same((await this.root())!, root), 'SKILL_LIBRARY_PATH_INVALID', '私有库根发生改变。')
      return operation()
    }, { waitMs: 2000 })
  }
  async retire(qualifiedId: string, resourceDigest: string, checkReferences: () => Promise<void>) {
    return this.withCatalogLock(async () => {
      const bundle = await this.read(qualifiedId, resourceDigest), root = await this.root()
      invariant(root, 'SKILL_RESOURCE_MISSING', '私有库不存在。')
      const version = await this.directory(root, [key(qualifiedId), resourceDigest.slice(7)])
      invariant(version, 'SKILL_RESOURCE_MISSING', '固定版本不存在。')
      const parent = await this.directory(root, [key(qualifiedId)])
      invariant(parent, 'SKILL_RESOURCE_MISSING', '固定版本目录不存在。')
      await checkReferences()
      // A reversible catalog retirement. All bytes remain in the private home;
      // no recursive delete and no project/run cleanup is performed.
      const retirementId = `retired-${key(qualifiedId)}-${resourceDigest.slice(7)}-${randomUUID()}`
      const retired = await this.directory(root, ['.retired'], true)
      invariant(retired, 'SKILL_LIBRARY_PATH_INVALID', '私有回收区创建失败。')
      await this.directory(root, [key(qualifiedId)])
      invariant(!await observed(join(retired, retirementId)), 'SKILL_VERSION_CONFLICT', '私有回收记录重名。')
      await rename(version, join(retired, retirementId))
      return { retirementId, qualifiedId, digest: bundle.manifest.digest, retainedBytes: true }
    })
  }
  private async root(create = false) {
    const home = await realpath(this.home)
    let current = home
    for (const part of ['scholarflow', 'skills']) {
      current = join(current, part)
      let info = await observed(current)
      if (!info && create) {
        try { await mkdir(current, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        info = await observed(current)
      }
      if (!info) return undefined
      invariant(info.isDirectory() && !info.isSymbolicLink() && same(await realpath(current), current), 'SKILL_LIBRARY_PATH_INVALID', '私有库目录不是普通目录，未跟随链接或改写外部文件。')
    }
    return current
  }
  private async directory(root: string, parts: string[], create = false) {
    let current = root
    for (const part of parts) {
      relativePath.parse(part)
      invariant(!part.includes('/'), 'SKILL_LIBRARY_PATH_INVALID', '目录段无效。')
      current = join(current, part)
      let info = await observed(current)
      if (!info && create) {
        try { await mkdir(current, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        info = await observed(current)
      }
      if (!info) return undefined
      invariant(info.isDirectory() && !info.isSymbolicLink() && same(await realpath(current), current), 'SKILL_LIBRARY_PATH_INVALID', '私有库的目录链接或路径发生改变。')
    }
    const rel = relative(root, current)
    invariant(!rel.startsWith(`..${sep}`) && rel !== '..', 'SKILL_LIBRARY_PATH_INVALID', '私有库路径越界。')
    return current
  }
  private async manifest(version: string) {
    const path = join(version, 'manifest.json'), info = await observed(path)
    invariant(info?.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 512 * 1024, 'SKILL_MANIFEST_INVALID', '版本清单缺失、过大或不是普通文件。')
    return skillManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  }
  async list() {
    const root = await this.root()
    if (!root) return { versions: [] as SkillManifest[], diagnostics: [] as string[] }
    const versions: SkillManifest[] = [], diagnostics: string[] = []
    for (const namespace of await readdir(root, { withFileTypes: true })) {
      if (!/^[a-f0-9]{64}$/u.test(namespace.name)) continue
      const parent = await this.directory(root, [namespace.name])
      if (!parent) continue
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (!/^[a-f0-9]{64}$/u.test(entry.name)) continue
        invariant(versions.length < 1000, 'SKILL_LIBRARY_TOO_LARGE', '私有库版本较多，请缩小查看范围。')
        try {
          const version = await this.directory(root, [namespace.name, entry.name])
          invariant(version, 'SKILL_MANIFEST_INVALID', '版本目录不存在。')
          const manifest = await this.manifest(version)
          invariant(key(manifest.metadata.qualifiedId) === namespace.name && manifest.digest.slice(7) === entry.name,
            'SKILL_MANIFEST_INVALID', '版本身份与目录不同。')
          versions.push(manifest)
        } catch { diagnostics.push('一个版本目录未通过校验，原文件已保留；需要检查该版本。') }
      }
    }
    return { versions, diagnostics }
  }
  async read(qualifiedId: string, resourceDigest: string): Promise<SkillBundle> {
    invariant(/^sha256:[a-f0-9]{64}$/u.test(resourceDigest), 'SKILL_DIGEST_MISMATCH', '资源摘要无效。')
    const root = await this.root()
    invariant(root, 'SKILL_RESOURCE_MISSING', '私有 Skill 库不存在，请重新导入原版本。')
    const version = await this.directory(root, [key(qualifiedId), resourceDigest.slice(7)])
    invariant(version, 'SKILL_RESOURCE_MISSING', '固定版本不在本机私有库；不会改用最新版本。')
    return this.readVersion(root, version, qualifiedId, resourceDigest)
  }
  private async readVersion(root: string, version: string, qualifiedId: string, resourceDigest: string): Promise<SkillBundle> {
    const manifest = await this.manifest(version)
    invariant(manifest.metadata.qualifiedId === qualifiedId && manifest.digest === resourceDigest, 'SKILL_DIGEST_MISMATCH', '版本清单与固定资源身份不同。')
    const files: SkillBundle['files'] = []
    let size = 0
    for (const entry of manifest.files) {
      const parts = relativePath.parse(entry.relativePath).split('/'), name = parts.pop()!
      const parent = await this.directory(root, [...relative(root, version).split(sep), 'files', ...parts])
      invariant(parent, 'SKILL_RESOURCE_MISSING', '固定资源目录缺失。')
      const path = join(parent, name), info = await observed(path)
      invariant(info, 'SKILL_RESOURCE_MISSING', '固定资源文件缺失。')
      invariant(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size === entry.sizeBytes, 'SKILL_DIGEST_MISMATCH', '固定资源文件大小改变或变成链接。')
      size += info.size
      invariant(size <= MAX_SKILL_BYTES && files.length < MAX_SKILL_FILES, 'SKILL_PACKAGE_TOO_LARGE', '固定资源超出读取上限。')
      files.push({ relativePath: entry.relativePath, bytes: new Uint8Array(await readFile(path)) })
    }
    const original = files.find(file => file.relativePath === 'SKILL.md')
    invariant(original, 'SKILL_ENTRY_MISSING', '固定资源中没有 SKILL.md。')
    const instructions = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original.bytes)
    return verifySkill({ manifest, files, instructions })
  }
  async install(bundle: SkillBundle) {
    verifySkill(bundle)
    const root = await this.root(true)
    invariant(root, 'SKILL_LIBRARY_PATH_INVALID', '私有库目录创建失败。')
    return withFileLock(join(root, 'catalog-owner.json'), async () => {
      invariant(same((await this.root())!, root), 'SKILL_LIBRARY_PATH_INVALID', '私有库根发生改变。')
      const parent = await this.directory(root, [key(bundle.manifest.metadata.qualifiedId)], true)
      invariant(parent, 'SKILL_LIBRARY_PATH_INVALID', '资源目录创建失败。')
      const versionName = bundle.manifest.digest.slice(7), existing = await this.directory(root, [key(bundle.manifest.metadata.qualifiedId), versionName])
      if (existing) {
        const stored = await this.readVersion(root, existing, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest)
        return { manifest: stored.manifest, alreadyInstalled: true }
      }
      const temporaryName = `.import-${randomUUID()}`, temporary = await this.directory(root, [temporaryName], true)
      invariant(temporary, 'SKILL_LIBRARY_PATH_INVALID', '临时资源目录创建失败。')
      // Partial scratch is deliberately retained on a failure. No recursive
      // deletion or replacement of an installed/user-owned version happens here.
      for (const file of bundle.files) {
        const parts = relativePath.parse(file.relativePath).split('/'), name = parts.pop()!
        const targetParent = await this.directory(root, [temporaryName, 'files', ...parts], true)
        invariant(targetParent, 'SKILL_LIBRARY_PATH_INVALID', '资源文件目录创建失败。')
        await writeFile(join(targetParent, name), file.bytes, { flag: 'wx', mode: 0o600 })
      }
      await writeFileAtomic(join(temporary, 'manifest.json'), json(bundle.manifest), { mode: 0o600, dirMode: 0o700 })
      await this.readVersion(root, temporary, bundle.manifest.metadata.qualifiedId, bundle.manifest.digest)
      await this.directory(root, [key(bundle.manifest.metadata.qualifiedId)])
      invariant(!await observed(join(parent, versionName)), 'SKILL_VERSION_CONFLICT', '此版本目录在确认期间出现，未覆盖。')
      await rename(temporary, join(parent, versionName))
      return { manifest: bundle.manifest, alreadyInstalled: false }
    }, { waitMs: 2000 })
  }
}
