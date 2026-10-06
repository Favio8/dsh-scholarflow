import { snapshot, mutateLedger } from '../project/project.ts'
import { inspectReview, reviewInput } from '../review/review.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { bibliography } from './bibliography.ts'
import { projectMarkdown } from '../editing/markdown.ts'
import { validateArtifactPrivacy, validateExportUrl, validateManuscriptPublication } from './public-artifacts.ts'
import { deliverySchema, type Ledger } from '../../shared/schema.ts'
import { invariant } from '../../shared/errors.ts'
import { latexDocument, wordDocument } from './formats.ts'
import { readWritingSpec } from '../pipeline/writing-task-store.ts'
import type { ExportFormat } from '../../shared/presentation.ts'

export async function prepareDelivery(io: FileStore, format: ExportFormat = 'markdown') {
  const current = await snapshot(io), review = await inspectReview(io), input = await reviewInput(io)
  invariant(!current.document.externalChange, 'STALE_DOCUMENT_VERSION', '请先显式采用或保存外部稿件改动，再导出。')
  const projection = projectMarkdown(current.document.text)
  const sourceIds = projection.citationOrder.map(key => {
    const source = Object.values(current.ledger.sources).find(item => item.citeKey === key)
    invariant(source, 'CITATION_KEY_UNKNOWN', `引用 ${key} 缺少来源，导出前必须修复。`)
    return source.id
  })
  validateManuscriptPublication(current.document.text, projection.tree)
  if (format === 'docx') validateArtifactPrivacy(current.config.project.title)
  for (const sourceId of sourceIds) {
    const source = current.ledger.sources[sourceId], url = source.identifiers.url
    validateArtifactPrivacy([source.title, source.venue, ...source.authors.flatMap(author => [author.literal, author.family, author.given]),
      url, source.identifiers.doi, source.identifiers.arxiv].filter(value => value !== undefined).join('\n'))
    if (url) validateExportUrl(url)
  }
  validateArtifactPrivacy(bibliography(current.document.text, current.ledger))
  const issues = Object.values(current.ledger.reviewIssues)
  const currentIssues = issues.filter(issue => issue.reviewId === review.report?.id && issue.state !== 'resolved')
  const hasB0 = currentIssues.some(issue => issue.severity === 'B0')
  const reviewed = !!review.report && !review.stale && !hasB0 && review.report.checks.every(check => check.status === 'pass') && !currentIssues.length
  const reviewState = review.report && review.stale ? 'review-stale' : reviewed ? 'draft-reviewed' : 'draft-incomplete'
  const plan = { id: newId('preflight'), projectId: current.ledger.projectId, documentHash: current.document.contentHash, revisionId: current.document.revisionId,
    ledgerRevision: current.ledger.revision, ledgerHash: current.ledgerHash, configHash: current.configHash, dependencyHash: input.dependencyHash,
    reviewId: review.report?.id, reviewState, sourceIds, unresolvedIssueIds: issues.filter(issue => issue.state !== 'resolved').map(issue => issue.id),
    reviewedAllowed: reviewed, limitations: review.report?.limitations ?? ['当前稿件尚未执行审查；只能导出工作草稿。'],
    format, formats: [...(format === 'markdown' ? [] : [format]), 'markdown', 'bibtex', 'quality-report'],
    formatNotes: format === 'docx' ? ['Word 公式保留 TeX 表达式。',
      '导出成功不等于排版合格：封面与正文的实际页数要在 Word 或等效查看环境中核对后才能称为已验证。']
      : format === 'latex' ? ['LaTeX 为完整源码，中文使用 ctex；下载包含 references.bib。'] : [] }
  invariant(format !== 'docx' || io.createExportBytes && io.readExportBytes, 'BINARY_EXPORT_UNAVAILABLE', '当前宿主不能保存 Word 交付。')
  return { ...plan, planHash: digest(json(plan)) }
}
export type DeliveryPlan = Awaited<ReturnType<typeof prepareDelivery>>

function reportText(text: string) {
  return text.replace(/[\r\n]+/g, ' ').replace(/(?:[a-z]:[\\/])[^\s]+/gi, '[私有路径已省略]')
    .replace(/(?:api[_ -]?key|authorization|password|secret|token)\s*[:=]\s*\S+/gi, '[凭据已省略]')
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, '[凭据已省略]')
}
export async function createDelivery(io: FileStore, plan: DeliveryPlan, deliveryType: 'working-draft' | 'reviewed-draft', expectedRevision: number) {
  invariant(deliveryType === 'working-draft' || plan.reviewedAllowed, 'REVIEW_NOT_READY', '当前检查有阻塞、未知或过期项，只能显式导出工作草稿。')
  let manifest!: Ledger['deliveries'][string]
  const result = await mutateLedger(io, expectedRevision, async (ledger, config) => {
    const fresh = await prepareDelivery(io, plan.format ?? 'markdown')
    invariant(fresh.ledgerHash === plan.ledgerHash && fresh.configHash === plan.configHash && fresh.documentHash === plan.documentHash &&
      fresh.dependencyHash === plan.dependencyHash && fresh.reviewId === plan.reviewId && fresh.reviewState === plan.reviewState,
      'EXPORT_PLAN_STALE', '导出确认期间稿件、审查、资料或项目数据改变，请重新预检。')
    const current = await snapshot(io), review = await inspectReview(io), deliveryId = newId('delivery')
    const writingSpec = await readWritingSpec(io)
    const reviewState = deliveryType === 'working-draft' ? (plan.reviewState === 'review-stale' ? 'review-stale' : 'draft-incomplete') : 'draft-reviewed'
    const currentIssues = Object.values(ledger.reviewIssues).filter(issue => issue.state !== 'resolved')
    const report = [ '# ScholarFlow 质量报告', '', `交付：${deliveryId}`, `项目：${ledger.projectId}`, `稿件修订：${plan.revisionId}`,
      `稿件 SHA-256：${plan.documentHash}`, `数据版本：${plan.ledgerRevision}`, `审查：${plan.reviewId ?? '未执行'}`, `状态：${reviewState}`, '',
      '## 本次检查范围', '', '正文、实际引用的来源记录和已登记的所选资料；不包含完整会话、原始资料副本或模型推理。', '',
      ...(review.report ? [`统计口径：${review.report.statistics.countingPolicyId}；${review.report.statistics.chineseCharacters} 汉字，${review.report.statistics.westernWords} 西文词元，${review.report.statistics.uniqueReferences} 个实际引用。`,
        // The confirmed length sits beside the actual count: a report whose length was asked for
        // has to state the deviation itself rather than leave the reader to measure it.
        ...(writingSpec ? [`篇幅：实际 ${review.report.statistics.chineseCharacters} 汉字／已确认要求 ${writingSpec.targetLength} ${writingSpec.language === 'en' ? '词' : '汉字'}${writingSpec.brief?.length?.approximate ? '（来源写为「约」）' : ''}；偏差 ${review.report.statistics.chineseCharacters - writingSpec.targetLength >= 0 ? '+' : ''}${review.report.statistics.chineseCharacters - writingSpec.targetLength}。`] : []), '',
        '## 检查结果', '', ...review.report.checks.map(check => `- ${check.status} · ${check.method} · ${check.id} · ${reportText(check.detail)}`), ''] : ['尚未执行审查；没有可宣称通过的检查结果。', '']),
      '## 尚未关闭的问题与接受的风险', '', ...currentIssues.map(issue => `- ${issue.id} · ${issue.severity} · ${issue.state}${issue.stale ? ' · 过期' : ''} · ${reportText(issue.explanation)}${issue.resolutionReason ? `；理由：${reportText(issue.resolutionReason)}` : ''}`), '',
      '## 资料获取限制', '', ...plan.sourceIds.map(id => { const source = ledger.sources[id]; return `- ${id} · identity=${source.identity.status} · textAccess=${source.textAccess}` }), '',
      '## 限制与建议下一步', '', ...plan.limitations.map(item => `- ${reportText(item)}`), '- 处理未关闭问题和未知检查，接受修改后按新版本重新审查。',
      '- 本报告不提供课程成绩、接收概率或学术真实性保证。', '' ].join('\n')
    const root = `${config.paths.manuscriptDir}/exports/${deliveryId}`
    const files: Array<{ relativePath: string; text: string; encoding?: 'base64' }> = [{ relativePath: 'paper.md', text: current.document.text }, { relativePath: 'references.bib', text: bibliography(current.document.text, ledger) }, { relativePath: 'quality-report.md', text: report }]
    if (plan.format === 'latex') files.unshift({ relativePath: 'paper.tex', text: latexDocument(current.document.text, config) })
    // 排版 is read from the confirmed spec, not from prose: the requirement's own fields are
    // what actually shapes the exported page (SPEC v1.2 §16.1).
    if (plan.format === 'docx') {
      const spec = await readWritingSpec(io)
      const bytes = await wordDocument(current.document.text, config, ledger, { typography: spec?.typography, cover: spec?.cover })
      files.unshift({ relativePath: 'paper.docx', text: Buffer.from(bytes).toString('base64'), encoding: 'base64' })
    }
    for (const file of files) if (!file.encoding) validateArtifactPrivacy(file.text)
    manifest = deliverySchema.parse({ id: deliveryId, projectId: ledger.projectId, documentId: 'paper', documentHash: plan.documentHash,
      revisionId: plan.revisionId, ledgerRevision: plan.ledgerRevision, ...(plan.reviewId && { reviewId: plan.reviewId }), reviewState,
      unresolvedIssueIds: plan.unresolvedIssueIds, sourceIds: plan.sourceIds,
      files: files.map(file => { const bytes = file.encoding ? Buffer.from(file.text, 'base64') : Buffer.from(file.text); return { relativePath: file.relativePath, hash: digest(bytes), sizeBytes: bytes.byteLength } }), createdAt: new Date().toISOString() })
    invariant(!await io.stat(root), 'OUTPUT_PATH_CONFLICT', '交付快照目录已存在，禁止覆盖。')
    ledger.deliveries[deliveryId] = manifest
    return [...files.map(file => ({ path: `${root}/${file.relativePath}`, before: undefined, after: file.text, ...(file.encoding && { encoding: file.encoding }) })),
      { path: `${root}/manifest.json`, before: undefined, after: json(manifest) }]
  })
  return { revision: result.revision, manifest }
}

export async function readDelivery(io: FileStore, deliveryId: string) {
  const current = await snapshot(io), manifest = current.ledger.deliveries[deliveryId]
  invariant(manifest && manifest.projectId === current.ledger.projectId, 'DELIVERY_NOT_FOUND', '交付不存在或不属于当前项目。')
  const files = []
  for (const file of manifest.files) {
    if (file.relativePath === 'paper.docx') {
      invariant(io.readExportBytes, 'BINARY_EXPORT_UNAVAILABLE', '当前宿主无法读取 Word 交付。')
      const image = await io.readExportBytes(`${current.config.paths.manuscriptDir}/exports/${deliveryId}/${file.relativePath}`)
      invariant(image && digest(image.bytes) === file.hash && image.bytes.byteLength === file.sizeBytes, 'DELIVERY_CHANGED', 'Word 交付快照缺失或已修改。')
      files.push({ ...file, encoding: 'base64' as const, base64: Buffer.from(image.bytes).toString('base64'), mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      continue
    }
    const image = await io.read(`${current.config.paths.manuscriptDir}/exports/${deliveryId}/${file.relativePath}`)
    invariant(image && digest(image.text) === file.hash && Buffer.byteLength(image.text) === file.sizeBytes, 'DELIVERY_CHANGED', '交付快照缺失或被修改；保留原文件并停止下载。')
    files.push({ ...file, text: image.text, encoding: 'utf8' as const, mediaType: file.relativePath.endsWith('.tex') ? 'application/x-tex;charset=utf-8' : 'text/plain;charset=utf-8' })
  }
  return { manifest, files }
}
