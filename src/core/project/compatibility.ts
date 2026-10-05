import { z } from 'zod'
import { parseDocument } from 'yaml'
import { id, relativePath } from '../../shared/schema.ts'
import { invariant } from '../../shared/errors.ts'
import { digest, type FileStore } from '../store/files.ts'
import { CONFIG_PATH, LEDGER_PATH } from './project.ts'
import { sensitivePath } from '../materials/materials.ts'

// This envelope only locates original bytes. It does not interpret future data,
// synthesize missing settings, migrate records or permit any mutation.
const pathsEnvelope = z.object({ manuscriptDir: relativePath, mainDocument: relativePath.optional(), references: relativePath.optional() }).passthrough()
const envelope = z.object({ schemaVersion: z.number().int().min(1), project: z.object({ id, title: z.string().max(300).optional() }).passthrough(), paths: z.unknown().optional() }).passthrough()
export function readonlyEnvelope(text: string) {
  const document = parseDocument(text, { uniqueKeys: true })
  invariant(!document.errors.length && !document.warnings.length, 'PROJECT_CONFIG_INVALID', '配置无法安全读取，原文件保留。')
  const header = envelope.parse(document.toJS({ maxAliasCount: 10 })), paths = pathsEnvelope.safeParse(header.paths)
  return { schemaVersion: header.schemaVersion, project: { id: header.project.id, title: header.project.title }, paths: paths.success ? paths.data : undefined }
}
export function schemaVersionOf(text: string | undefined) {
  if (!text) return undefined
  try { const value = JSON.parse(text)?.schemaVersion; return Number.isSafeInteger(value) && value >= 1 ? value as number : undefined } catch { return undefined }
}
export async function inspectCompatibility(io: FileStore) {
  const config = await io.read(CONFIG_PATH)
  if (!config) return undefined
  const data = readonlyEnvelope(config.text), ledger = await io.read(LEDGER_PATH), lock = await io.read('.scholarflow/resources.lock.json')
  const versions = { config: data.schemaVersion, ledger: schemaVersionOf(ledger?.text), resourceLock: schemaVersionOf(lock?.text) }
  if (!Object.values(versions).some(value => value !== undefined && value > 1)) return undefined
  const originals = [{ relativePath: CONFIG_PATH, text: config.text, contentHash: digest(config.text) },
    ...(ledger ? [{ relativePath: LEDGER_PATH, text: ledger.text, contentHash: digest(ledger.text) }] : []),
    ...(lock ? [{ relativePath: '.scholarflow/resources.lock.json', text: lock.text, contentHash: digest(lock.text) }] : [])]
  const warnings = ['项目含当前插件不支持的 schema。只展示原始文件，不解释未来记录、执行恢复或向下迁移；写作、接受、审查和项目变更均停止。']
  for (const path of [data.paths?.mainDocument, data.paths?.references]) {
    if (!path) { warnings.push('未来配置没有声明可验证的主稿或引用路径，未猜测读取其他文件。'); continue }
    if (!data.paths || ['.scholarflow', '.git', 'node_modules'].includes(data.paths.manuscriptDir.split('/')[0]) || !path.startsWith(data.paths.manuscriptDir + '/') ||
      sensitivePath(path) || !/\.(md|bib)$/iu.test(path)) { warnings.push('未来配置的原稿路径无法按项目输出范围验证，未读取该目标。'); continue }
    const info = await io.stat(path)
    if (!info || info.type !== 'file' || info.size > 2 * 1024 * 1024) { warnings.push('一份原稿缺失、不是普通文件或超过 2 MiB 只读预览限额；仍保留原文件。'); continue }
    const file = await io.read(path)
    if (file) originals.push({ relativePath: path, text: file.text, contentHash: digest(file.text) })
  }
  invariant((await io.read(CONFIG_PATH))?.version === config.version && (await io.read(LEDGER_PATH))?.version === ledger?.version &&
    (await io.read('.scholarflow/resources.lock.json'))?.version === lock?.version, 'STALE_LEDGER_REVISION', '只读检查期间项目改变，请刷新。')
  return { projectId: data.project.id, title: data.project.title ?? '不支持版本的项目', versions, originals, warnings: [...new Set(warnings)] }
}
