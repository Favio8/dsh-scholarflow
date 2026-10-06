import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { json } from '../../core/store/files.ts'
import { loadPresetLibrary, duplicateOrders, presetFromStructure, type RawPresetEntry, type PresetIssue } from '../../core/presets/library.ts'
import { presetDocument, presetId, type Preset, type PresetDocument } from '../../shared/presets.ts'
import { invariant } from '../../shared/errors.ts'

const PAPER_TYPES = ['course-paper', 'research-paper', 'literature-review'] as const
const MAX_USER_PRESETS = 200
const MAX_PRESET_BYTES = 256 * 1024
const USER_ID = /^user-[a-f0-9]{32}$/
// The same module runs bundled (dist/host.js, one level below the package root) and
// directly from source (src/host/presets/, three levels below) during tests. Probe
// both so neither mode silently looks in the wrong place; a miss is reported as
// PRESET_BUNDLE_MISSING by the loader rather than showing an empty library.
function resolveBundledStructures() {
  for (const candidate of ['../presets/structures/', '../../../presets/structures/']) {
    const path = fileURLToPath(new URL(candidate, import.meta.url))
    if (existsSync(join(path, 'presets.schema.json'))) return path
  }
  return fileURLToPath(new URL('../presets/structures/', import.meta.url))
}
const builtinStructures = resolveBundledStructures()

const same = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
async function info(path: string) { try { return await lstat(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }

/** Drops the loaded identity so the body can be written back under a validated id. */
function documentOf(preset: Preset): Omit<PresetDocument, 'id'> {
  return { schemaVersion: preset.schemaVersion, version: preset.version, updatedAt: preset.updatedAt, paperType: preset.paperType,
    ...(preset.order === undefined ? {} : { order: preset.order }), title: preset.title, summary: preset.summary, whenToUse: preset.whenToUse,
    sections: preset.sections, supplementalParts: preset.supplementalParts,
    ...(preset.methodNotes === undefined ? {} : { methodNotes: preset.methodNotes }), references: preset.references,
    ...(preset.derivedFrom === undefined ? {} : { derivedFrom: preset.derivedFrom }),
    ...(preset.basedOnVersion === undefined ? {} : { basedOnVersion: preset.basedOnVersion }), tags: preset.tags }
}
const bumpMajor = (version: string) => `${Number(version.split('.')[0]) + 1}.0.0`

/**
 * Structure presets, split by ownership (SPEC v1.1 §6): built-ins are read-only
 * resources inside the installed package, user copies live under
 * `<DSH_HOME>/scholarflow/presets/user/`. No model tool receives this writer.
 */
export class PresetLibrary {
  private home: string
  private bundled: string
  constructor(home = resolveDshHome(), bundled: string = builtinStructures) {
    this.home = resolve(home)
    this.bundled = resolve(bundled)
  }
  private async directory(parent: string, segment: string, create = false) {
    invariant(/^[a-zA-Z0-9_.-]+$/u.test(segment) && !['.', '..'].includes(segment), 'PRESET_LIBRARY_INVALID', '预设目录段无效。')
    const path = join(parent, segment)
    if (!await info(path) && create) { try { await mkdir(path, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error } }
    const stat = await info(path)
    if (!stat) return undefined
    invariant(stat.isDirectory() && !stat.isSymbolicLink() && same(await realpath(path), path), 'PRESET_LIBRARY_INVALID', '预设目录不是普通目录，未跟随链接。')
    return path
  }
  private async readDirectory(directory: string) {
    try { return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return undefined }
  }
  private async userRoot(create = false) {
    const home = await realpath(this.home), parent = await this.directory(home, 'scholarflow', create)
    if (!parent) return undefined
    const presets = await this.directory(parent, 'presets', create)
    return presets && await this.directory(presets, 'user', create)
  }
  private async file(path: string) {
    const stat = await info(path)
    invariant(stat && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_PRESET_BYTES, 'PRESET_LIBRARY_INVALID', '预设文件缺失、过大或是链接。')
    const text = await readFile(path, 'utf8')
    invariant((await info(path))?.size === stat.size, 'PRESET_LIBRARY_INVALID', '预设文件读取期间发生改变。')
    return text
  }
  /** Built-ins come from the package, never from a user-directory copy that could go stale. */
  private async builtinEntries(): Promise<{ entries: RawPresetEntry[]; issues: PresetIssue[] }> {
    const entries: RawPresetEntry[] = [], issues: PresetIssue[] = []
    for (const paperType of PAPER_TYPES) {
      const directory = join(this.bundled, paperType)
      const names = await this.readDirectory(directory)
      if (!names) { issues.push({ id: paperType, source: 'builtin', code: 'PRESET_BUNDLE_MISSING', message: `发行包缺少 ${paperType} 的内置预设目录。` }); continue }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const id = name.slice(0, -5)
        try { entries.push({ id, source: 'builtin', text: await this.file(join(directory, name)) }) }
        catch (error) { issues.push({ id, source: 'builtin', code: 'PRESET_UNREADABLE', message: `内置预设无法读取：${id}（${(error as Error).message}）` }) }
      }
    }
    return { entries, issues }
  }
  private async userEntries(): Promise<{ entries: RawPresetEntry[]; issues: PresetIssue[] }> {
    const entries: RawPresetEntry[] = [], issues: PresetIssue[] = [], root = await this.userRoot()
    if (!root) return { entries, issues }
    const names = await this.readDirectory(root)
    invariant((names?.length ?? 0) <= MAX_USER_PRESETS * 2, 'PRESET_LIBRARY_TOO_LARGE', '用户预设目录条目数超过限额。')
    for (const name of names ?? []) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue
      const id = name.slice(0, -5)
      try { entries.push({ id, source: 'user', text: await this.file(join(root, name)) }) }
      catch (error) { issues.push({ id, source: 'user', code: 'PRESET_UNREADABLE', message: `用户预设无法读取：${id}（${(error as Error).message}）` }) }
    }
    return { entries, issues }
  }
  async list() {
    const builtin = await this.builtinEntries(), user = await this.userEntries()
    const library = loadPresetLibrary([...user.entries, ...builtin.entries])
    return { all: library.all, byType: library.byType,
      issues: [...builtin.issues, ...user.issues, ...library.issues, ...duplicateOrders(library)] }
  }
  async read(id: string) {
    invariant(presetId.safeParse(id).success, 'PRESET_ID_INVALID', '预设 id 不合法。')
    const row = (await this.list()).all.find(preset => preset.id === id)
    invariant(row, 'PRESET_NOT_FOUND', '预设不存在，未改用其他版本。')
    return row
  }
  private async write(id: string, document: Omit<PresetDocument, 'id'>) {
    invariant(USER_ID.test(id), 'PRESET_ID_INVALID', '用户预设 id 必须使用 user- 前缀，不占用内置身份。')
    const stored = presetDocument.parse({ ...document, id }), root = await this.userRoot(true)
    invariant(root, 'PRESET_LIBRARY_INVALID', '用户预设目录创建失败。')
    return withFileLock(join(root, 'owner.lock'), async () => {
      invariant(same((await this.userRoot())!, root), 'PRESET_LIBRARY_INVALID', '用户预设目录在写入前发生改变。')
      const existing = await info(join(root, `${stored.id}.json`))
      const count = (await this.list()).all.filter(preset => preset.source === 'user').length
      invariant(existing || count < MAX_USER_PRESETS, 'PRESET_LIBRARY_TOO_LARGE', '用户预设数量达到限额。')
      const temporary = join(root, `.write-${randomUUID()}.json`)
      await writeFile(temporary, json(stored), { flag: 'wx', mode: 0o600 })
      await this.file(temporary)
      invariant(same((await this.userRoot())!, root), 'PRESET_LIBRARY_INVALID', '用户预设目录在确认期间发生改变。')
      await rename(temporary, join(root, `${stored.id}.json`))
      return this.read(stored.id)
    }, { waitMs: 2000 })
  }
  /** Saves the current paper structure as a new user preset; never touches a built-in. */
  async save(input: Parameters<typeof presetFromStructure>[0], now: string) {
    return this.write(`user-${randomUUID().replace(/-/g, '')}`, presetFromStructure(input, now))
  }
  async update(id: string, input: Parameters<typeof presetFromStructure>[0], now: string, expectedVersion: string) {
    invariant(USER_ID.test(id), 'PRESET_BUILTIN_READONLY', '内置预设只读，请另存为我的预设。')
    const current = await this.read(id)
    invariant(current.source === 'user', 'PRESET_BUILTIN_READONLY', '内置预设只读，请另存为我的预设。')
    invariant(current.version === expectedVersion, 'PRESET_VERSION_CONFLICT', '预设已被其他操作更新，请重新查看后再决定。')
    return this.write(id, presetFromStructure({ ...input,
      derivedFrom: current.derivedFrom ?? input.derivedFrom, basedOnVersion: current.basedOnVersion ?? input.basedOnVersion },
      now, bumpMajor(current.version)))
  }
  /** Copies any preset into a new independent user entry, keeping its shares and sources. */
  async copy(id: string, now: string, title?: PresetDocument['title']) {
    const source = await this.read(id)
    return this.write(`user-${randomUUID().replace(/-/g, '')}`, { ...documentOf(source), updatedAt: now,
      ...(title === undefined ? {} : { title }), derivedFrom: source.id, basedOnVersion: source.version })
  }
  async rename(id: string, title: PresetDocument['title'], now: string) {
    invariant(USER_ID.test(id), 'PRESET_BUILTIN_READONLY', '内置预设不能改名，只能复制。')
    const current = await this.read(id)
    invariant(current.source === 'user', 'PRESET_BUILTIN_READONLY', '内置预设不能改名，只能复制。')
    return this.write(id, { ...documentOf(current), title, updatedAt: now })
  }
  async remove(id: string) {
    invariant(USER_ID.test(id), 'PRESET_BUILTIN_READONLY', '内置预设不能删除，只能复制或忽略。')
    const current = await this.read(id)
    invariant(current.source === 'user', 'PRESET_BUILTIN_READONLY', '内置预设不能删除，只能复制或忽略。')
    const root = await this.userRoot()
    invariant(root, 'PRESET_NOT_FOUND', '用户预设目录不存在。')
    return withFileLock(join(root, 'owner.lock'), async () => {
      const target = join(root, `${id}.json`)
      invariant(await info(target), 'PRESET_NOT_FOUND', '预设已被删除。')
      // Matches the private Skill library: the bytes move aside instead of vanishing.
      await rename(target, join(root, `.removed-${randomUUID()}.json`))
      return { removed: true }
    }, { waitMs: 2000 })
  }
}
