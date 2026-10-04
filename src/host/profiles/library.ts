import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { digest, json } from '../../core/store/files.ts'
import { verifyProfile } from '../../core/project/profiles.ts'
import type { WritingProfile } from '../../shared/profiles.ts'
import { invariant } from '../../shared/errors.ts'

const same = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
async function info(path: string) { try { return await lstat(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
// Operator-owned immutable templates, separate from both global Skills and the
// private Academic Skill catalog. No model tool receives this writer or root.
export class PrivateProfileLibrary {
  private home: string
  constructor(home = resolveDshHome()) { this.home = resolve(home) }
  private async directory(parent: string, segment: string, create = false) {
    invariant(/^[a-zA-Z0-9_.-]+$/u.test(segment) && !['.', '..'].includes(segment), 'PROFILE_LIBRARY_INVALID', '文风目录段无效。')
    const path = join(parent, segment)
    if (!await info(path) && create) { try { await mkdir(path, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error } }
    const stat = await info(path)
    if (!stat) return undefined
    invariant(stat.isDirectory() && !stat.isSymbolicLink() && same(await realpath(path), path), 'PROFILE_LIBRARY_INVALID', '文风库目录不是普通目录，未跟随链接。')
    return path
  }
  private async root(create = false) {
    const home = await realpath(this.home), parent = await this.directory(home, 'scholarflow', create)
    return parent && await this.directory(parent, 'profiles', create)
  }
  private async record(path: string) {
    const stat = await info(path)
    invariant(stat && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 512 * 1024, 'PROFILE_LIBRARY_INVALID', '文风记录缺失、过大或是链接。')
    const text = await readFile(path, 'utf8')
    invariant(Buffer.byteLength(text) <= 512 * 1024 && (await info(path))?.size === stat.size, 'PROFILE_LIBRARY_INVALID', '文风记录读取期间改变或超过限额。')
    const profile = verifyProfile(JSON.parse(text))
    invariant(profile.scope === 'library' && profile.id.startsWith('user_'), 'PROFILE_LIBRARY_INVALID', '私有文风身份不合法。')
    return profile
  }
  async list() {
    const root = await this.root(), profiles: WritingProfile[] = [], diagnostics: string[] = []
    if (!root) return { profiles, diagnostics }
    const entries = await readdir(root, { withFileTypes: true })
    invariant(entries.length <= 1000, 'PROFILE_LIBRARY_TOO_LARGE', '文风库目录数量超过限额。')
    let count = 0, bytes = 0
    for (const entry of entries) {
      if (!/^[a-f0-9]{64}$/u.test(entry.name)) continue
      try {
        const parent = await this.directory(root, entry.name)
        invariant(parent, 'PROFILE_LIBRARY_INVALID', '文风目录缺失。')
        const rows = await readdir(parent)
        invariant(rows.length <= 1000, 'PROFILE_LIBRARY_TOO_LARGE', '文风版本数量超过限额。')
        for (const name of rows) {
          if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue
          invariant(++count <= 500, 'PROFILE_LIBRARY_TOO_LARGE', '文风库超过 500 个版本，请缩小范围。')
          bytes += (await info(join(parent, name)))?.size ?? 0
          invariant(bytes <= 50 * 1024 * 1024, 'PROFILE_LIBRARY_TOO_LARGE', '文风库清单读取超过 50 MiB。')
          try { const profile = await this.record(join(parent, name))
            invariant(digest(profile.id).slice(7) === entry.name && profile.sourceDigest.slice(7) + '.json' === name, 'PROFILE_LIBRARY_INVALID', '文风目录与摘要不符。')
            profiles.push(profile)
          } catch { diagnostics.push('一个文风版本未通过校验，原文件保留。') }
        }
      } catch (error) { if ((error as { code?: string }).code === 'PROFILE_LIBRARY_TOO_LARGE') throw error; diagnostics.push('一个文风目录未通过校验或超过限额，未作为模板展示。') }
    }
    return { profiles, diagnostics: [...new Set(diagnostics)] }
  }
  async read(id: string, sourceDigest: string) {
    invariant(/^user_[\w.-]{1,190}$/u.test(id) && /^sha256:[a-f0-9]{64}$/u.test(sourceDigest), 'PROFILE_LIBRARY_INVALID', '固定文风身份无效。')
    const root = await this.root()
    invariant(root, 'PROFILE_NOT_FOUND', '私有文风库不存在。')
    const parent = await this.directory(root, digest(id).slice(7))
    invariant(parent, 'PROFILE_NOT_FOUND', '私有文风版本缺失，未改用最新版本。')
    const profile = await this.record(join(parent, sourceDigest.slice(7) + '.json'))
    invariant(profile.id === id && profile.sourceDigest === sourceDigest, 'PROFILE_DIGEST_MISMATCH', '文风记录与固定版本不符。')
    return profile
  }
  async install(input: WritingProfile) {
    const profile = verifyProfile(input)
    invariant(profile.scope === 'library' && /^user_[\w.-]{1,190}$/u.test(profile.id), 'PROFILE_LIBRARY_INVALID', '只能导入私有文风，不覆盖内置模板。')
    const root = await this.root(true)
    invariant(root, 'PROFILE_LIBRARY_INVALID', '文风库创建失败。')
    return withFileLock(join(root, 'catalog-owner.json'), async () => {
      invariant(same((await this.root())!, root), 'PROFILE_LIBRARY_INVALID', '文风库根发生改变。')
      const parent = await this.directory(root, digest(profile.id).slice(7), true)
      invariant(parent, 'PROFILE_LIBRARY_INVALID', '文风目录创建失败。')
      const target = join(parent, profile.sourceDigest.slice(7) + '.json')
      if (await info(target)) return { profile: await this.read(profile.id, profile.sourceDigest), alreadyInstalled: true }
      invariant((await this.list()).profiles.length < 500, 'PROFILE_LIBRARY_TOO_LARGE', '私有文风达到版本限额。')
      const temporary = join(parent, `.import-${randomUUID()}.json`)
      await writeFile(temporary, json(profile), { flag: 'wx', mode: 0o600 })
      await this.record(temporary)
      invariant(same((await this.directory(root, digest(profile.id).slice(7)))!, parent) && !await info(target), 'PROFILE_LIBRARY_INVALID', '文风目标在确认期间改变。')
      await rename(temporary, target)
      return { profile, alreadyInstalled: false }
    }, { waitMs: 2000 })
  }
}
