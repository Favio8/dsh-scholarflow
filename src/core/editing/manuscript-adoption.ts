import { snapshot } from '../project/project.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { invariant, ScholarError } from '../../shared/errors.ts'
import { relativePath } from '../../shared/schema.ts'
import { sensitivePath } from '../materials/materials.ts'
import { relocateMarkdownResources } from './markdown-resources.ts'
import { citationMarkers } from './markdown.ts'
import { bibliography } from '../export/bibliography.ts'
import { parseMarkdown } from './markdown.ts'
import { saveManual } from './proposals.ts'

const MAX_BYTES = 2 * 1024 * 1024
async function readSource(io: FileStore, path: string) {
  path = relativePath.parse(path)
  const current = await snapshot(io)
  invariant(/\.(?:md|markdown)$/iu.test(path) && !sensitivePath(path) && !path.toLowerCase().startsWith('.scholarflow/')
    && !path.toLowerCase().startsWith(current.config.paths.manuscriptDir.toLowerCase() + '/'),
    'MANUSCRIPT_SOURCE_DENIED', '请选择输出目录以外的项目内 Markdown 原稿；原稿保持只读。')
  invariant((await io.stat(path))?.type === 'file', 'FILE_NOT_REGULAR', '所选原稿不是普通文件。')
  const bytes = await io.readBytes(path, MAX_BYTES)
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new ScholarError('DOCUMENT_INVALID', '所选原稿不是有效 UTF-8，未创建空稿或覆盖文件。') }
  invariant(text!.trim().length > 0 && !text!.includes('\0') && text!.isWellFormed(), 'DOCUMENT_INVALID', '原稿为空或含无效文本，未采用。')
  parseMarkdown(text!)
  return { text: text!, hash: digest(bytes), path }
}
export async function inspectManuscriptSource(io: FileStore, path: string) {
  const source = await readSource(io, path), current = await snapshot(io), markers = citationMarkers(source.text)
  const known = new Set(Object.values(current.ledger.sources).map(row => row.citeKey))
  const keys = [...new Set(markers.flatMap(row => row.keys))]
  return { sourcePath: source.path, sourceHash: source.hash, sourceText: source.text, sizeBytes: Buffer.byteLength(source.text),
    keys, requiredMappings: keys.filter(key => key.startsWith('sf_') && !known.has(key)),
    unmanagedMarkers: markers.filter(row => row.kind === 'numeric' || row.keys.some(key => !known.has(key) && !key.startsWith('sf_'))),
    destinationPath: current.config.paths.mainDocument }
}
export interface ManuscriptAdoptionPlan {
  id: string; contentHash: string; projectId: string; ledgerRevision: number; ledgerHash: string; configHash: string;
  sourcePath: string; sourceHash: string; sourceText: string; destinationPath: string; beforeText: string; beforeHash: string; baseRevisionId: string;
  referencesHash: string; text: string; mappings: Record<string, string>; resourceChanges: ReturnType<typeof relocateMarkdownResources>['changes'];
  unmanagedMarkers: ReturnType<typeof citationMarkers>; reason: string; sessionId: string;
}
export async function prepareManuscriptAdoption(io: FileStore,
  input: { sourcePath: string; sourceHash: string; mappings: Record<string, string>; reason: string; sessionId: string }): Promise<ManuscriptAdoptionPlan> {
  const source = await readSource(io, input.sourcePath), current = await snapshot(io)
  invariant(source.hash === input.sourceHash, 'STALE_MATERIAL_VERSION', '读取之后原稿已改变，请重新查看导入来源。')
  invariant(!current.document.externalChange, 'STALE_DOCUMENT_VERSION', '请先明确采用或保存外部主稿版本，再预览导入。')
  invariant(input.reason.trim().length > 0 && input.reason.length <= 4000 && Object.keys(input.mappings).length <= 200,
    'INVALID_REQUEST', '请填写采用说明，并限制引用映射为最多 200 个键。')
  const markers = citationMarkers(source.text), keys = new Set(markers.flatMap(row => row.keys))
  const known = new Set(Object.values(current.ledger.sources).map(row => row.citeKey))
  const mapping = (key: string) => Object.hasOwn(input.mappings, key) ? input.mappings[key] : undefined
  for (const [from, to] of Object.entries(input.mappings)) invariant(keys.has(from) && known.has(to), 'CITATION_MAPPING_INVALID', '引用映射必须从原稿的实际键明确指向已登记项目来源。')
  invariant([...keys].every(key => !key.startsWith('sf_') || known.has(key) || mapping(key)), 'CITATION_MAPPING_REQUIRED', '原稿包含另一个项目的引用键；请先登记元数据并明确映射，未生成来源或猜测关联。')
  let mapped = source.text
  for (const marker of [...markers].reverse()) {
    if (marker.kind !== 'keyed' || !marker.keys.some(key => mapping(key))) continue
    const replacement = marker.text.replace(/@([\p{L}\p{N}_.:+-]+)/gu, (token, key: string) => mapping(key) ? `@${mapping(key)}` : token)
    mapped = mapped.slice(0, marker.startUtf16) + replacement + mapped.slice(marker.endUtf16)
  }
  const resources = relocateMarkdownResources(mapped, source.path, current.config.paths.mainDocument)
  bibliography(resources.text, current.ledger) // Never fabricate missing SF Source records.
  const unmanagedMarkers = citationMarkers(resources.text).filter(row => row.kind === 'numeric' || row.keys.some(key => !known.has(key)))
  const references = await io.read(current.config.paths.references)
  invariant(references, 'REFERENCE_PROJECTION_CHANGED', '当前参考文献文件缺失，未采用。')
  const body = { id: newId('manuscript_import'), projectId: current.ledger.projectId, ledgerRevision: current.ledger.revision,
    ledgerHash: current.ledgerHash, configHash: current.configHash, sourcePath: source.path, sourceHash: source.hash, sourceText: source.text,
    destinationPath: current.config.paths.mainDocument, beforeText: current.document.text, beforeHash: current.document.contentHash,
    baseRevisionId: current.document.revisionId, referencesHash: digest(references.text), text: resources.text, mappings: structuredClone(input.mappings),
    resourceChanges: resources.changes, unmanagedMarkers, reason: input.reason.trim(), sessionId: input.sessionId }
  return { ...body, contentHash: digest(json(body)) }
}
export async function applyManuscriptAdoption(io: FileStore, plan: ManuscriptAdoptionPlan) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash, 'INVALID_APPROVAL', '稿件采用计划改变，请重新查看完整差异。')
  const root = `.scholarflow/imports/${plan.id}`
  return saveManual(io, plan.text, plan.beforeHash, plan.ledgerRevision, { origin: `manuscript-import:${plan.id}`,
    verify: async current => {
      invariant(current.ledger.projectId === plan.projectId && current.configHash === plan.configHash && current.ledgerHash === plan.ledgerHash
        && current.document.revisionId === plan.baseRevisionId && current.config.paths.mainDocument === plan.destinationPath,
        'STALE_RESOURCE_VERSION', '项目、稿件或配置改变，未采用旧导入计划。')
      invariant((await readSource(io, plan.sourcePath)).hash === plan.sourceHash, 'STALE_MATERIAL_VERSION', '确认前原稿改变，未覆盖任何稿件。')
      invariant(digest((await io.read(current.config.paths.references))?.text ?? '') === plan.referencesHash, 'REFERENCE_PROJECTION_CHANGED', '确认前参考文献文件改变，未覆盖。')
    }, extra: [
      { path: `${root}/source.md`, before: undefined, after: plan.sourceText },
      { path: `${root}/manifest.json`, before: undefined, after: json({ schemaVersion: 1, projectId: plan.projectId, operationId: plan.id,
        sourcePath: plan.sourcePath, sourceHash: plan.sourceHash, destinationPath: plan.destinationPath, importedHash: digest(plan.text),
        previousRevisionId: plan.baseRevisionId, previousDocumentHash: plan.beforeHash, sourceSessionId: plan.sessionId,
        confirmedAt: new Date().toISOString(), reason: plan.reason, mappings: plan.mappings, resourceChanges: plan.resourceChanges,
        unmanagedMarkers: plan.unmanagedMarkers, originalModified: false }) },
    ] })
}
