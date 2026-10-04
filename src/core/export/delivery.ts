import { snapshot, mutateLedger } from '../project/project.ts'
import { inspectReview, reviewInput } from '../review/review.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { bibliography } from './bibliography.ts'
import { projectMarkdown, walk } from '../editing/markdown.ts'
import { deliverySchema, type Ledger } from '../../shared/schema.ts'
import { invariant } from '../../shared/errors.ts'

export async function prepareDelivery(io: FileStore) {
  const current = await snapshot(io), review = await inspectReview(io), input = await reviewInput(io)
  invariant(!current.document.externalChange, 'STALE_DOCUMENT_VERSION', '请先显式采用或保存外部稿件改动，再导出。')
  const projection = projectMarkdown(current.document.text)
  const sourceIds = projection.citationOrder.map(key => {
    const source = Object.values(current.ledger.sources).find(item => item.citeKey === key)
    invariant(source, 'CITATION_KEY_UNKNOWN', `引用 ${key} 缺少来源，导出前必须修复。`)
    return source.id
  })
  walk(projection.tree, node => {
    invariant(node.type !== 'image', 'IMAGE_EXPORT_UNAVAILABLE', '当前导出器尚未验证图片资源；请先移除图片或等待已测试的资源导出支持。')
    if (node.type === 'link') invariant(!/^(?:file:|[a-z]:[\\/]|\/)/i.test(node.url ?? ''), 'PRIVATE_LINK_NOT_EXPORTABLE', '正文包含本地绝对路径链接，请改为可导出的资源引用。')
  })
  const issues = Object.values(current.ledger.reviewIssues)
  const currentIssues = issues.filter(issue => issue.reviewId === review.report?.id && issue.state !== 'resolved')
  const hasB0 = currentIssues.some(issue => issue.severity === 'B0')
  const reviewed = !!review.report && !review.stale && !hasB0 && review.report.checks.every(check => check.status === 'pass') && !currentIssues.length
  const reviewState = review.report && review.stale ? 'review-stale' : reviewed ? 'draft-reviewed' : 'draft-incomplete'
  const plan = { id: newId('preflight'), projectId: current.ledger.projectId, documentHash: current.document.contentHash, revisionId: current.document.revisionId,
    ledgerRevision: current.ledger.revision, ledgerHash: current.ledgerHash, configHash: current.configHash, dependencyHash: input.dependencyHash,
    reviewId: review.report?.id, reviewState, sourceIds, unresolvedIssueIds: issues.filter(issue => issue.state !== 'resolved').map(issue => issue.id),
    reviewedAllowed: reviewed, limitations: review.report?.limitations ?? ['当前稿件尚未执行审查；只能导出工作草稿。'],
    formats: ['markdown', 'bibtex', 'quality-report'] }
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
    const fresh = await prepareDelivery(io)
    invariant(fresh.ledgerHash === plan.ledgerHash && fresh.configHash === plan.configHash && fresh.documentHash === plan.documentHash &&
      fresh.dependencyHash === plan.dependencyHash && fresh.reviewId === plan.reviewId && fresh.reviewState === plan.reviewState,
      'EXPORT_PLAN_STALE', '导出确认期间稿件、审查、资料或项目数据改变，请重新预检。')
    const current = await snapshot(io), review = await inspectReview(io), deliveryId = newId('delivery')
    const reviewState = deliveryType === 'working-draft' ? (plan.reviewState === 'review-stale' ? 'review-stale' : 'draft-incomplete') : 'draft-reviewed'
    const currentIssues = Object.values(ledger.reviewIssues).filter(issue => issue.state !== 'resolved')
    const report = [ '# ScholarFlow 质量报告', '', `交付：${deliveryId}`, `项目：${ledger.projectId}`, `稿件修订：${plan.revisionId}`,
      `稿件 SHA-256：${plan.documentHash}`, `数据版本：${plan.ledgerRevision}`, `审查：${plan.reviewId ?? '未执行'}`, `状态：${reviewState}`, '',
      '## 本次检查范围', '', '正文、实际引用的来源记录和已登记的所选资料；不包含完整会话、原始资料副本或模型推理。', '',
      ...(review.report ? [`统计口径：${review.report.statistics.countingPolicyId}；${review.report.statistics.chineseCharacters} 汉字，${review.report.statistics.westernWords} 西文词元，${review.report.statistics.uniqueReferences} 个实际引用。`, '',
        '## 检查结果', '', ...review.report.checks.map(check => `- ${check.status} · ${check.method} · ${check.id} · ${reportText(check.detail)}`), ''] : ['尚未执行审查；没有可宣称通过的检查结果。', '']),
      '## 尚未关闭的问题与接受的风险', '', ...currentIssues.map(issue => `- ${issue.id} · ${issue.severity} · ${issue.state}${issue.stale ? ' · 过期' : ''} · ${reportText(issue.explanation)}${issue.resolutionReason ? `；理由：${reportText(issue.resolutionReason)}` : ''}`), '',
      '## 资料获取限制', '', ...plan.sourceIds.map(id => { const source = ledger.sources[id]; return `- ${id} · identity=${source.identity.status} · textAccess=${source.textAccess}` }), '',
      '## 限制与建议下一步', '', ...plan.limitations.map(item => `- ${reportText(item)}`), '- 处理未关闭问题和未知检查，接受修改后按新版本重新审查。',
      '- 本报告不提供课程成绩、接收概率或学术真实性保证。', '' ].join('\n')
    const root = `${config.paths.manuscriptDir}/exports/${deliveryId}`
    const files = [{ relativePath: 'paper.md', text: current.document.text }, { relativePath: 'references.bib', text: bibliography(current.document.text, ledger) }, { relativePath: 'quality-report.md', text: report }]
    manifest = deliverySchema.parse({ id: deliveryId, projectId: ledger.projectId, documentId: 'paper', documentHash: plan.documentHash,
      revisionId: plan.revisionId, ledgerRevision: plan.ledgerRevision, ...(plan.reviewId && { reviewId: plan.reviewId }), reviewState,
      unresolvedIssueIds: plan.unresolvedIssueIds, sourceIds: plan.sourceIds,
      files: files.map(file => ({ relativePath: file.relativePath, hash: digest(file.text), sizeBytes: Buffer.byteLength(file.text) })), createdAt: new Date().toISOString() })
    invariant(!await io.stat(root), 'OUTPUT_PATH_CONFLICT', '交付快照目录已存在，禁止覆盖。')
    ledger.deliveries[deliveryId] = manifest
    return [...files.map(file => ({ path: `${root}/${file.relativePath}`, before: undefined, after: file.text })),
      { path: `${root}/manifest.json`, before: undefined, after: json(manifest) }]
  })
  return { revision: result.revision, manifest }
}

export async function readDelivery(io: FileStore, deliveryId: string) {
  const current = await snapshot(io), manifest = current.ledger.deliveries[deliveryId]
  invariant(manifest && manifest.projectId === current.ledger.projectId, 'DELIVERY_NOT_FOUND', '交付不存在或不属于当前项目。')
  const files = []
  for (const file of manifest.files) {
    const image = await io.read(`${current.config.paths.manuscriptDir}/exports/${deliveryId}/${file.relativePath}`)
    invariant(image && digest(image.text) === file.hash && Buffer.byteLength(image.text) === file.sizeBytes, 'DELIVERY_CHANGED', '交付快照缺失或被修改；保留原文件并停止下载。')
    files.push({ ...file, text: image.text })
  }
  return { manifest, files }
}
