import { type FileStore, digest } from '../store/files.ts'
import { snapshot, mutateLedger } from '../project/project.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'
import { parsedMaterialSchema, type ParsedBody } from '../../shared/materials.ts'
import { MAX_MATERIAL_BYTES, recordParsed, sensitivePath } from './materials.ts'

export async function parseRegisteredMaterial(io: FileStore, materialId: string, revision: number, signal: AbortSignal,
  parser: (bytes: Uint8Array, mediaType: string) => Promise<ParsedBody>) {
  const { config, ledger } = await snapshot(io)
  invariant(ledger.revision === revision, 'STALE_LEDGER_REVISION', '项目数据已更新，请重新读取。')
  const material = ledger.materials[materialId]
  invariant(material && config.materials.include.includes(material.projectRelativePath) && !sensitivePath(material.projectRelativePath), 'MATERIAL_ACCESS_DENIED', '只能解析用户明确选用的资料。')
  const bytes = await io.readBytes(material.projectRelativePath, MAX_MATERIAL_BYTES)
  signal.throwIfAborted()
  const sourceContentHash = digest(bytes)
  // Expensive parsing happens without the project writer lock.
  let body: ParsedBody
  try { body = await parser(bytes, material.mediaType) }
  catch (error) {
    if (!signal.aborted) {
      try {
        await mutateLedger(io, revision, current => {
          const record = current.materials[materialId]
          record.failureCode = error instanceof ScholarError ? error.code : 'MATERIAL_PARSE_FAILED'
          if (record.contentHash !== sourceContentHash || !['ready', 'partial'].includes(record.parseStatus)) record.parseStatus = 'failed'
        })
      } catch { /* A newer revision or denied permission remains untouched. */ }
    }
    throw error
  }
  signal.throwIfAborted()
  const parsed = parsedMaterialSchema.parse({ ...body, schemaVersion: 1, materialId, sourceContentHash })
  const result = await recordParsed(io, parsed, revision)
  return { revision: result.revision, parsed, material: result.ledger.materials[materialId] }
}
