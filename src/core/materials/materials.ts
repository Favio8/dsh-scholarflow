import { parseDocument } from 'yaml'
import { materialSchema, type Material, type ProjectConfig } from '../../shared/schema.ts'
import { parsedMaterialSchema, type ParsedMaterial } from '../../shared/materials.ts'
import { invariant } from '../../shared/errors.ts'
import { digest, newId, json, type FileStore } from '../store/files.ts'
import { snapshot, mutateLedger, CONFIG_PATH, invalidateReviews } from '../project/project.ts'

export const MAX_MATERIAL_BYTES = 50 * 1024 * 1024
const secretExtension = /\.(pem|key|p12|pfx|kdbx)$/i
export function sensitivePath(path: string) {
  return path.split('/').some(part => /^(?:\.env.*|\.ssh|\.aws|\.azure|\.gnupg|\.npmrc|\.pypirc|\.netrc|\.authinfo|\.?credentials?(?:\..*)?|secrets?|id_rsa|id_ed25519|token(?:s)?(?:\..*)?)$/i.test(part) || secretExtension.test(part))
}
export function excludedPath(path: string, config: ProjectConfig) {
  return path === config.paths.manuscriptDir || path.startsWith(config.paths.manuscriptDir + '/') ||
    path.split('/').some(part => part.startsWith('.') || ['node_modules', 'dist', 'build', 'vendor'].includes(part))
}
export function mediaType(path: string) {
  const ext = path.split('.').at(-1)?.toLowerCase()
  return ({ md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', html: 'text/html', htm: 'text/html', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream'
}
export async function scanMaterials(io: FileStore, directory = '', cursor = 0, limit = 50) {
  const { config } = await snapshot(io)
  invariant(!sensitivePath(directory) && !excludedPath(directory, config), 'MATERIAL_ACCESS_DENIED', '该目录不在可选资料范围。')
  const rows = (await io.list(directory)).filter(entry => !sensitivePath(entry.path) && !excludedPath(entry.path, config)).sort((a, b) => a.path.localeCompare(b.path))
  return { files: rows.slice(cursor, cursor + limit).map(row => ({ relativePath: row.path, type: row.type, sizeBytes: row.size, mediaType: mediaType(row.path) })),
    nextCursor: cursor + limit < rows.length ? cursor + limit : null, total: rows.length, contentRead: false }
}
export async function registerMaterial(io: FileStore, input: { relativePath: string; role: Material['role']; confirmExcludedFile: boolean }, revision: number) {
  let material!: Material
  const result = await mutateLedger(io, revision, async (ledger, config) => {
    invariant(!sensitivePath(input.relativePath), 'MATERIAL_ACCESS_DENIED', '凭据、密钥和系统敏感资料禁止摄取。')
    invariant(!input.relativePath.startsWith('.scholarflow/') && !input.relativePath.startsWith(config.paths.manuscriptDir + '/'), 'MATERIAL_ACCESS_DENIED', '项目元数据与输出稿件不是原始资料。')
    invariant(!excludedPath(input.relativePath, config) || input.confirmExcludedFile, 'MATERIAL_SELECTION_REQUIRED', '该文件默认排除，请单独确认选用。')
    const existing = Object.values(ledger.materials).find(row => row.projectRelativePath === input.relativePath)
    invariant(!existing, 'MATERIAL_ALREADY_REGISTERED', '该资料已登记，请读取其已有记录。')
    const file = await io.stat(input.relativePath)
    invariant(file?.type === 'file', 'FILE_NOT_REGULAR', '请选择当前工作区内的普通资料文件。')
    invariant(file.size <= MAX_MATERIAL_BYTES, 'CONTENT_TOO_LARGE', '单份资料最多 50 MiB；请缩小资料范围。')
    material = materialSchema.parse({ id: newId('mat'), projectRelativePath: input.relativePath, role: input.role, mediaType: mediaType(input.relativePath),
      sizeBytes: file.size, parseStatus: 'registered', parsedRanges: [] })
    ledger.materials[material.id] = material
    const before = (await io.read(CONFIG_PATH))!
    const yaml = parseDocument(before.text)
    yaml.setIn(['materials', 'include'], [...new Set([...config.materials.include, input.relativePath])])
    return [{ path: CONFIG_PATH, before, after: yaml.toString() }]
  })
  return { material, revision: result.revision }
}
export const materialCachePath = (materialId: string, contentHash: string, parser: ParsedMaterial['parser'], ranges: ParsedMaterial['ranges']) =>
  `.scholarflow/cache/materials/${materialId}/${contentHash.slice(7)}/${digest(json({ parser, ranges })).slice(7)}.json`
export async function readParsed(io: FileStore, materialId: string) {
  const { config, ledger } = await snapshot(io)
  const material = ledger.materials[materialId]
  invariant(material?.contentHash, 'MATERIAL_NOT_PARSED', '请先解析该资料。')
  invariant(config.materials.include.includes(material.projectRelativePath), 'MATERIAL_ACCESS_DENIED', '该资料已不在当前明确选用范围。')
  invariant(digest(await io.readBytes(material.projectRelativePath, MAX_MATERIAL_BYTES)) === material.contentHash, 'STALE_MATERIAL_VERSION', '原始资料已改变；请重新解析，旧证据不能自动沿用。')
  invariant(material.parser, 'MATERIAL_CACHE_INVALID', '缺少解析版本。')
  const file = await io.read(materialCachePath(materialId, material.contentHash, material.parser, material.parsedRanges))
  invariant(file, 'MATERIAL_CACHE_MISSING', '解析缓存已清除，请重新解析；已有证据摘录仍保留。')
  const parsed = parsedMaterialSchema.parse(JSON.parse(file.text))
  invariant(parsed.materialId === materialId && parsed.sourceContentHash === material.contentHash, 'MATERIAL_CACHE_INVALID', '解析缓存身份不一致。')
  return parsed
}
export async function recordParsed(io: FileStore, parsed: ParsedMaterial, revision: number) {
  parsed = parsedMaterialSchema.parse(parsed)
  return mutateLedger(io, revision, async (ledger, config) => {
    const material = ledger.materials[parsed.materialId]
    invariant(material && config.materials.include.includes(material.projectRelativePath), 'MATERIAL_ACCESS_DENIED', '只能解析当前用户明确选用的资料。')
    const bytes = await io.readBytes(material.projectRelativePath, MAX_MATERIAL_BYTES)
    invariant(digest(bytes) === parsed.sourceContentHash, 'STALE_MATERIAL_VERSION', '解析期间原始资料已改变，请重新解析。')
    if (material.contentHash && material.contentHash !== parsed.sourceContentHash) {
      for (const source of Object.values(ledger.sources)) if (source.materialId === material.id) {
        source.contentHash = parsed.sourceContentHash
        source.textAccess = parsed.coverage === 'complete' && parsed.blocks.length ? 'fulltext' : parsed.blocks.length ? 'excerpt' : 'none'
        for (const evidence of Object.values(ledger.evidence)) if (evidence.sourceId === source.id) evidence.validation = 'stale'
      }
      for (const claim of Object.values(ledger.claims)) if (claim.evidenceLinks.some(link => ledger.evidence[link.evidenceId]?.validation === 'stale')) claim.status = 'stale'
      invalidateReviews(ledger, ['evidence', 'citation', 'integrity'])
    }
    if (material.contentHash === parsed.sourceContentHash && material.parser?.version === parsed.parser.version) {
      const previousFile = await io.read(materialCachePath(material.id, material.contentHash, material.parser, material.parsedRanges))
      if (previousFile) {
        const previous = parsedMaterialSchema.parse(JSON.parse(previousFile.text))
        const blocks = new Map([...previous.blocks, ...parsed.blocks].map(block => [JSON.stringify(block.locator), block]))
        const ranges = new Map([...previous.ranges, ...parsed.ranges].map(range => [JSON.stringify(range), range]))
        parsed = parsedMaterialSchema.parse({ ...parsed, blocks: [...blocks.values()], ranges: [...ranges.values()],
          coverage: previous.coverage === 'complete' || parsed.coverage === 'complete' ? 'complete' : 'partial',
          warnings: [...new Set([...previous.warnings, ...parsed.warnings])] })
      }
    }
    Object.assign(material, { contentHash: parsed.sourceContentHash, parseStatus: parsed.blocks.length ? parsed.coverage === 'complete' ? 'ready' : 'partial' : 'unsupported',
      parser: parsed.parser, parsedRanges: parsed.ranges, sizeBytes: bytes.length })
    delete material.failureCode
    const path = materialCachePath(material.id, parsed.sourceContentHash, parsed.parser, parsed.ranges)
    const before = await io.read(path)
    const after = json(parsed)
    invariant(!before || before.text === after, 'MATERIAL_CACHE_INVALID', '已锁定的解析快照发生外部修改，未覆盖。')
    return before ? [] : [{ path, before, after }]
  })
}
