import { CONFIG_PATH, LEDGER_PATH } from './project.ts'
import { readonlyEnvelope, schemaVersionOf } from './compatibility.ts'
import { sensitivePath } from '../materials/materials.ts'
import { digest, type FileStore, type FileImage } from '../store/files.ts'
import { invariant } from '../../shared/errors.ts'

// Diagnostics never repair, adopt, create defaults or follow ledger-controlled
// material paths. Only bounded own metadata and explicitly declared outputs.
export async function inspectDamagedProject(io: FileStore, reason: { code: string; message: string }) {
  const originals: { relativePath: string; text: string; contentHash: string }[] = [], warnings: string[] = []
  const observed = new Map<string, FileImage | undefined>()
  const read = async (path: string) => {
    const info = await io.stat(path)
    if (!info) { observed.set(path, undefined); warnings.push(`${path} 缺失；未创建替代文件。`); return undefined }
    if (info.type !== 'file' || info.size > 2 * 1024 * 1024) { warnings.push(`${path} 不是普通文件或超过 2 MiB 诊断限额；原文件保留。`); return undefined }
    try { const file = await io.read(path); observed.set(path, file)
      if (file) originals.push({ relativePath: path, text: file.text, contentHash: digest(file.text) })
      return file
    } catch { warnings.push(`${path} 无法作为完整 UTF-8 文件读取；未替换编码、删除或覆盖原字节。`); return undefined }
  }
  const config = await read(CONFIG_PATH), ledger = await read(LEDGER_PATH), lock = await read('.scholarflow/resources.lock.json')
  let header: ReturnType<typeof readonlyEnvelope> | undefined
  try { if (config) header = readonlyEnvelope(config.text) } catch { warnings.push('配置头无法验证，未猜测项目身份或原稿路径。') }
  if (header?.paths) for (const path of [header.paths.mainDocument, header.paths.references]) {
    if (!path || !path.startsWith(header.paths.manuscriptDir + '/') || ['.scholarflow', '.git', 'node_modules'].includes(header.paths.manuscriptDir.split('/')[0]) ||
      sensitivePath(path) || !/\.(md|bib)$/iu.test(path)) { warnings.push('一份输出路径缺失或不在可验证范围，未读取其他资料。'); continue }
    if (!originals.some(file => file.relativePath === path)) await read(path)
  }
  const root = '.scholarflow/transactions', info = await io.stat(root)
  if (info?.type === 'directory') {
    const entries = await io.list(root)
    if (entries.length > 100) warnings.push('事务记录超过一百条，未自动扩大读取范围；原记录保留。')
    else for (const entry of entries) {
      const name = entry.path.split('/').at(-1)!
      if (entry.type !== 'directory' || !/^txn_[a-f0-9]+$/u.test(name)) { warnings.push('事务目录包含未知条目，未展开或执行。'); continue }
      await read(`${entry.path}/manifest.json`)
    }
  } else if (info) warnings.push('事务根不是目录，未尝试重建。')
  for (const [path, file] of observed) {
    const current = await io.read(path)
    invariant(current?.version === file?.version && current?.text === file?.text, 'STALE_LEDGER_REVISION', '诊断期间原文件改变，请刷新后核对。')
  }
  return { projectId: header?.project.id, title: header?.project.title ?? '待诊断项目', reason,
    versions: { config: header?.schemaVersion, ledger: schemaVersionOf(ledger?.text), resourceLock: schemaVersionOf(lock?.text) }, originals,
    warnings: ['项目记录无法安全解释；这里只展示原始文件，不初始化、自动修复或执行事务恢复。', ...new Set(warnings)] }
}
