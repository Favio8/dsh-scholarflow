import { createHash } from 'node:crypto'
import { z } from 'zod'
import { packageSkill, describeInstructions, MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_INSTRUCTION_BYTES } from '../../core/skills/package.ts'
import { sensitivePath } from '../../core/materials/materials.ts'
import { relativePath } from '../../shared/schema.ts'
import { skillOptions, type SkillMetadata } from '../../shared/skills.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import type { HostWeb } from '../providers/crossref.ts'

const sha = z.string().regex(/^[a-f0-9]{40}$/u)
const treeEntry = z.object({ path: relativePath, mode: z.enum(['100644', '100755', '040000', '120000', '160000']),
  type: z.enum(['blob', 'tree', 'commit']), sha, size: z.number().int().min(0).optional() })
export type GithubFile = { relativePath: string; sha: string; sizeBytes: number }
export interface GithubDiscovery { repository: string; owner: string; repo: string; ref: string; commit: string; subpath: string;
  candidates: string[]; tree: z.infer<typeof treeEntry>[]; license?: string; warnings: string[] }
export interface GithubSkillPreview { discovery: GithubDiscovery; subpath: string; files: GithubFile[]; instructions: string;
  metadata: SkillMetadata; options: z.infer<typeof skillOptions>; totalBytes: number }

export function githubLocation(input: string, explicitRef?: string, explicitSubpath?: string) {
  let url: URL
  try { url = new URL(input) } catch { throw new ScholarError('SKILL_GITHUB_URL_INVALID', '请输入 HTTPS GitHub 仓库、目录或 SKILL.md 地址。') }
  invariant(url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash,
    'SKILL_GITHUB_URL_INVALID', '只支持没有凭据、查询参数和锚点的 HTTPS GitHub 地址。')
  const parts = url.pathname.replace(/\/$/u, '').split('/').slice(1).map(value => decodeURIComponent(value))
  const owner = parts[0], repo = parts[1]?.replace(/\.git$/u, '')
  invariant(owner && /^[a-zA-Z0-9-]{1,100}$/u.test(owner) && repo && /^[a-zA-Z0-9_.-]{1,100}$/u.test(repo) && repo !== '.' && repo !== '..',
    'SKILL_GITHUB_URL_INVALID', 'GitHub 仓库身份无效。')
  if (explicitRef !== undefined) invariant(explicitRef.length > 0 && explicitRef.length <= 300 && !/[\s\0\\?#]/u.test(explicitRef)
    && !explicitRef.split('/').some(part => !part || part === '.' || part === '..'), 'SKILL_REF_INVALID', '分支、标签或 commit 无效。')
  let subpath = explicitSubpath ?? ''
  if (parts.length > 2) {
    invariant(parts[2] === 'tree' || parts[2] === 'blob', 'SKILL_GITHUB_URL_INVALID', '仅支持仓库、tree 目录或 blob SKILL.md 地址。')
    invariant(explicitRef, 'SKILL_REF_REQUIRED', '目录／文件地址的 ref 与路径可能含斜杠，请明确填写完整分支、标签或 commit。')
    const tail = parts.slice(3).join('/')
    invariant(tail === explicitRef || tail.startsWith(`${explicitRef}/`), 'SKILL_REF_INVALID', '所填 ref 与 URL 不一致；请使用仓库根地址并单独填写 ref 和子目录。')
    const path = tail.slice(explicitRef.length).replace(/^\//u, '')
    if (parts[2] === 'blob') {
      invariant(path === 'SKILL.md' || path.endsWith('/SKILL.md'), 'SKILL_ENTRY_MISSING', '文件地址必须指向 SKILL.md。')
      subpath = path === 'SKILL.md' ? '' : path.slice(0, -'/SKILL.md'.length)
    } else subpath = path
    invariant(explicitSubpath === undefined || explicitSubpath === subpath, 'SKILL_GITHUB_URL_INVALID', 'URL 与另填的子目录不同。')
  }
  if (subpath) relativePath.parse(subpath)
  invariant(subpath.split('/').length <= 16, 'SKILL_GITHUB_PATH_INVALID', '子目录层级过深，请选择更具体的仓库范围。')
  return { owner, repo, repository: `https://github.com/${owner}/${repo}`, ref: explicitRef, subpath }
}

// Read-only public GitHub REST, through Host network policy. Tree modes are
// checked before blobs: the Contents API can dereference symlinks, so it is not
// used. URLs returned by GitHub are never followed as arbitrary download URLs.
export function githubSkills(web: HostWeb) {
  let active = false
  const retrieve = async (owner: string, repo: string, endpoint: string, signal: AbortSignal) => {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${endpoint}`
    signal.throwIfAborted()
    const result = await web.fetch({ url }, signal)
    signal.throwIfAborted()
    const final = new URL(result.url)
    invariant(final.origin === 'https://api.github.com', 'SKILL_NETWORK_REDIRECT', 'GitHub 返回未批准的下载地址。')
    if (result.statusCode === 403 || result.statusCode === 429) throw new ScholarError('SKILL_GITHUB_RATE_LIMITED', 'GitHub 拒绝访问或限流，本次停止；不会读取凭据或自动重试。')
    invariant(result.statusCode >= 200 && result.statusCode < 300, 'SKILL_GITHUB_UNAVAILABLE', 'GitHub 资源不存在或暂不可用；公开匿名导入不支持私有仓库。')
    invariant(!result.truncated && result.body.kind === 'text' && Buffer.byteLength(result.body.content) <= 5 * 1024 * 1024,
      'SKILL_GITHUB_RESPONSE_INVALID', 'GitHub 响应超出 Host 上限或不完整；请选择更具体的子目录，或下载到本机后导入。')
    try { return JSON.parse(result.body.content) as unknown } catch { throw new ScholarError('SKILL_GITHUB_RESPONSE_INVALID', 'GitHub 响应不是有效 JSON。') }
  }
  const tree = async (owner: string, repo: string, treeSha: string, recursive: boolean, signal: AbortSignal) => {
    const result = z.object({ sha, tree: z.array(treeEntry).max(2000), truncated: z.literal(false) }).safeParse(
      await retrieve(owner, repo, `/git/trees/${treeSha}${recursive ? '?recursive=1' : ''}`, signal))
    invariant(result.success && result.data.sha === treeSha, 'SKILL_GITHUB_TREE_INVALID', '文件树无效、被截断或身份不符；请缩小子目录。')
    return result.data.tree
  }
  const blob = async (owner: string, repo: string, file: GithubFile, signal: AbortSignal) => {
    const decoded = z.object({ sha, size: z.number().int().min(0), encoding: z.literal('base64'), content: z.string() }).safeParse(
      await retrieve(owner, repo, `/git/blobs/${file.sha}`, signal))
    invariant(decoded.success && decoded.data.sha === file.sha && decoded.data.size === file.sizeBytes, 'SKILL_GITHUB_BLOB_INVALID', '静态文件的身份或大小与已确认文件树不同。')
    const base64 = decoded.data.content.replace(/\s/gu, '')
    invariant(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64), 'SKILL_GITHUB_BLOB_INVALID', '静态文件编码无效。')
    const bytes = Buffer.from(base64, 'base64')
    const objectSha = createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
    invariant(bytes.byteLength === file.sizeBytes && objectSha === file.sha, 'SKILL_GITHUB_BLOB_INVALID', '实际下载字节与固定 Git 对象摘要不同。')
    return new Uint8Array(bytes)
  }
  const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    invariant(!active, 'SKILL_GITHUB_BUSY', '一个 GitHub 读取尚未完成，请稍后再操作。')
    active = true; try { return await operation() } finally { active = false }
  }
  return {
    discover: (location: ReturnType<typeof githubLocation>, signal: AbortSignal) => exclusive(async (): Promise<GithubDiscovery> => {
      const { owner, repo } = location
      const record = z.object({ default_branch: z.string().min(1).max(300), license: z.object({ spdx_id: z.string().max(200), name: z.string().max(500) }).nullable().optional() }).parse(
        await retrieve(owner, repo, '', signal))
      const ref = location.ref ?? record.default_branch
      const commit = z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) }).parse(
        await retrieve(owner, repo, `/commits/${encodeURIComponent(ref)}`, signal))
      let current = commit.commit.tree.sha
      // Walk only the explicit directory to avoid downloading a large parent tree.
      for (const part of location.subpath ? location.subpath.split('/') : []) {
        const directory = (await tree(owner, repo, current, false, signal)).find(entry => entry.path === part)
        invariant(directory?.type === 'tree' && directory.mode === '040000', 'SKILL_GITHUB_PATH_INVALID', '所选子目录不存在或是链接、子模块。')
        current = directory.sha
      }
      const entries = await tree(owner, repo, current, true, signal)
      const candidates = entries.filter(entry => entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755') && (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md'))
        && entry.size !== undefined && entry.size <= MAX_INSTRUCTION_BYTES).map(entry => entry.path === 'SKILL.md' ? '' : entry.path.slice(0, -'/SKILL.md'.length))
      invariant(candidates.length > 0 && candidates.length <= 100, 'SKILL_ENTRY_MISSING', '此范围没有可识别的 Skill，或候选过多；README 不作为 Skill。')
      return { ...location, ref, commit: commit.sha, candidates, tree: entries,
        ...(record.license && { license: `${record.license.spdx_id} · ${record.license.name}` }),
        warnings: ['匿名读取公开仓库；Host 网络限制和 GitHub 限流可能要求缩小范围或改用本地导入。'] }
    }),
    preview: (discovery: GithubDiscovery, candidate: string, options: z.infer<typeof skillOptions>, signal: AbortSignal) => exclusive(async (): Promise<GithubSkillPreview> => {
      invariant(discovery.candidates.includes(candidate), 'SKILL_GITHUB_PATH_INVALID', '请选择已列出的 Skill 候选。')
      options = skillOptions.parse(options)
      const prefix = candidate ? `${candidate}/` : ''
      const entries = discovery.tree.filter(entry => !prefix || entry.path.startsWith(prefix))
      const files: GithubFile[] = []
      let totalBytes = 0
      for (const entry of entries) {
        const path = entry.path.slice(prefix.length)
        relativePath.parse(path)
        invariant(!sensitivePath(path) && !path.split('/').some(part => ['.git', '.hg', '.svn', 'node_modules'].includes(part.toLowerCase())), 'SKILL_PATH_INVALID', 'Skill 含敏感或依赖目录，未导入。')
        if (entry.type === 'tree' && entry.mode === '040000') continue
        invariant(entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755') && entry.size !== undefined,
          'SKILL_SOURCE_LINK', 'Skill 含链接、子模块或特殊文件，未下载其目标。')
        totalBytes += entry.size
        invariant(totalBytes <= MAX_SKILL_BYTES && files.length < MAX_SKILL_FILES, 'SKILL_PACKAGE_TOO_LARGE', '单个 Skill 最多 200 个文件、20 MiB。')
        files.push({ relativePath: path, sizeBytes: entry.size, sha: entry.sha })
      }
      const entry = files.find(file => file.relativePath === 'SKILL.md')
      invariant(entry && entry.sizeBytes <= MAX_INSTRUCTION_BYTES, 'SKILL_ENTRY_MISSING', '必须选择带 SKILL.md 的具体目录。')
      const bytes = await blob(discovery.owner, discovery.repo, entry, signal)
      let instructions: string
      try { instructions = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
      catch { throw new ScholarError('SKILL_INSTRUCTIONS_INVALID', 'SKILL.md 不是有效 UTF-8。') }
      const subpath = [discovery.subpath, candidate].filter(Boolean).join('/')
      const metadata = describeInstructions(instructions, `github:${discovery.owner}/${discovery.repo}:${subpath || 'root'}`, options,
        files.map(file => ({ relativePath: file.relativePath, bytes: new Uint8Array() })))
      return { discovery, subpath, files, instructions, metadata, options, totalBytes }
    }),
    download: (preview: GithubSkillPreview, signal: AbortSignal) => exclusive(async () => {
      const files = []
      for (const file of preview.files) {
        signal.throwIfAborted()
        // Everything is a fixed Git blob, including scripts and binary assets.
        files.push({ relativePath: file.relativePath, bytes: await blob(preview.discovery.owner, preview.discovery.repo, file, signal) })
      }
      const bundle = packageSkill(preview.metadata.qualifiedId, files, { kind: 'github', repository: preview.discovery.repository,
        commit: preview.discovery.commit, subpath: preview.subpath, ...(preview.discovery.license && { license: preview.discovery.license }) }, preview.options)
      invariant(bundle.instructions === preview.instructions, 'SKILL_GITHUB_BLOB_INVALID', '已确认的说明字节发生改变，未安装。')
      return bundle
    }),
  }
}
