import { z } from 'zod'
import { hash, relativePath, id } from '../../shared/schema.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { digest, newId, json, type FileStore, type FileImage } from './files.ts'

const imageSchema = z.object({ text: z.string(), hash }).strict().nullable()
const transactionSchema = z.object({ schemaVersion: z.literal(1), id, state: z.enum(['prepared', 'committed']), createdAt: z.string(),
  changes: z.array(z.object({ path: relativePath, before: imageSchema, after: imageSchema, encoding: z.literal('base64').optional() }).strict()).min(1),
}).strict()
type Transaction = z.infer<typeof transactionSchema>
export interface Mutation { path: string; before: FileImage | undefined; after: string; encoding?: 'base64' }

const imageHash = (text: string, encoding?: 'base64') => digest(encoding ? Buffer.from(text, 'base64') : text)
async function readImage(io: FileStore, change: Pick<Mutation, 'path' | 'encoding'>): Promise<FileImage | undefined> {
  if (!change.encoding) return io.read(change.path)
  invariant(io.readExportBytes, 'BINARY_EXPORT_UNAVAILABLE', '当前文件适配器无法读取二进制交付。')
  const image = await io.readExportBytes(change.path)
  return image && { text: Buffer.from(image.bytes).toString('base64'), version: image.version }
}
async function writeImage(io: FileStore, change: Pick<Mutation, 'path' | 'encoding'>, text: string, before: FileImage | undefined) {
  if (!change.encoding) return io.write(change.path, text, before)
  invariant(!before && io.createExportBytes, 'BINARY_EXPORT_UNAVAILABLE', '二进制交付只允许创建新文件。')
  return io.createExportBytes(change.path, Buffer.from(text, 'base64'))
}

// Callers hold the FileStore lock. No network / model call is performed here.
export async function commit(io: FileStore, mutations: Mutation[], fault?: (point: string) => void) {
  invariant(new Set(mutations.map(m => m.path)).size === mutations.length, 'INVALID_MUTATION', 'Duplicate transaction target')
  for (const m of mutations) {
    relativePath.parse(m.path)
    const current = await readImage(io, m)
    invariant(current?.text === m.before?.text && current?.version === m.before?.version,
      'STALE_DOCUMENT_VERSION', '提交前文件已改变；保留外部改动。')
  }
  const txn: Transaction = { schemaVersion: 1, id: newId('txn'), state: 'prepared', createdAt: new Date().toISOString(),
    changes: mutations.map(m => ({ path: m.path, before: m.before ? { text: m.before.text, hash: imageHash(m.before.text, m.encoding) } : null,
      after: { text: m.after, hash: imageHash(m.after, m.encoding) }, ...(m.encoding && { encoding: m.encoding }) })) }
  const path = `.scholarflow/transactions/${txn.id}/manifest.json`
  const journal = await io.write(path, json(transactionSchema.parse(txn)), undefined)
  fault?.('journal-published')
  for (let i = 0; i < mutations.length; i++) {
    const mutation = mutations[i]
    await writeImage(io, mutation, mutation.after, mutation.before)
    fault?.(`target-${i}-published`)
  }
  await io.write(path, json({ ...txn, state: 'committed' }), journal)
  fault?.('commit-marked')
  return txn.id
}

export async function readTransactionJournals(io: FileStore) {
  const parent = '.scholarflow/transactions'
  if (!await io.stat(parent)) return []
  const rows: Array<{ path: string; journal: FileImage; txn: Transaction }> = []
  for (const entry of await io.list(parent)) {
    if (entry.type !== 'directory') continue
    const path = `${entry.path}/manifest.json`
    const journal = await io.read(path)
    if (!journal) throw new ScholarError('RECOVERY_CONFLICT', '事务日志不完整，项目仅可只读检查。')
    let raw: unknown
    try { raw = JSON.parse(journal.text) } catch { throw new ScholarError('RECOVERY_CONFLICT', '事务日志不是有效 JSON，未修改项目文件。') }
    const result = transactionSchema.safeParse(raw)
    if (!result.success) throw new ScholarError('RECOVERY_CONFLICT', '事务日志损坏，未修改项目文件。')
    const txn = result.data
    invariant(txn.id === entry.path.split('/').at(-1) && new Set(txn.changes.map(c => c.path)).size === txn.changes.length,
      'RECOVERY_CONFLICT', '事务身份或目标索引不一致。')
    if (txn.state === 'committed') continue
    for (const change of txn.changes) {
      invariant(change.before === null || imageHash(change.before.text, change.encoding) === change.before.hash, 'RECOVERY_CONFLICT', '旧稿快照校验失败。')
      invariant(change.after !== null && imageHash(change.after.text, change.encoding) === change.after.hash, 'RECOVERY_CONFLICT', '新稿快照校验失败。')
      invariant(!change.encoding || change.before === null, 'RECOVERY_CONFLICT', '二进制交付事务不能替换已有文件。')
    }
    rows.push({ path, journal, txn })
  }
  return rows
}

export async function inspectRecovery(io: FileStore, output = 'manuscript') {
  const rows = await readTransactionJournals(io)
  const targets = new Set<string>()
  const pending = []
  for (const row of rows) {
    const { txn } = row
    for (const change of txn.changes) {
      invariant(change.path.startsWith('.scholarflow/') || change.path.startsWith(output + '/'), 'RECOVERY_CONFLICT', '事务目标超出已确认的项目输出范围。')
      invariant(!targets.has(change.path), 'RECOVERY_CONFLICT', '多个未完成事务涉及相同文件，禁止推测提交顺序。')
      targets.add(change.path)
    }
    const images = await Promise.all(txn.changes.map(change => readImage(io, change)))
    for (let i = 0; i < txn.changes.length; i++) {
      const change = txn.changes[i]
      const currentHash = images[i] ? imageHash(images[i]!.text, change.encoding) : null
      invariant(currentHash === change.before?.hash || currentHash === change.after!.hash || (currentHash === null && change.before === null),
        'RECOVERY_CONFLICT', '检测到事务以外的修改；原稿、事务快照均已保留。')
    }
    pending.push({ ...row, images })
  }
  const contentHash = digest(json(pending.map(row => ({ journal: row.journal, path: row.path, images: row.images }))))
  return { contentHash, pending }
}

export async function recover(io: FileStore, output = 'manuscript', expectedHash?: string) {
  // Inspect ALL journals and targets before the first write, including transactions
  // later in the directory listing. The caller holds the project lock.
  const plan = await inspectRecovery(io, output)
  invariant(!expectedHash || plan.contentHash === expectedHash, 'RECOVERY_CONFLICT', '确认期间恢复目标发生变化，请重新检查。')
  const recovered: string[] = []
  for (const { path, journal, txn, images } of plan.pending) {
    for (let i = 0; i < txn.changes.length; i++) {
      const change = txn.changes[i]
      if (images[i] && imageHash(images[i]!.text, change.encoding) === change.after!.hash) continue
      await writeImage(io, change, change.after!.text, images[i])
    }
    await io.write(path, json({ ...txn, state: 'committed' }), journal)
    recovered.push(txn.id)
  }
  return recovered
}
