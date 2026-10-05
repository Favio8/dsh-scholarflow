import { snapshot, mutateLedger } from '../project/project.ts'
import { digest, newId, json, type FileStore } from '../store/files.ts'
import { invariant } from '../../shared/errors.ts'
import { reviewReportSchema, type ReviewReport } from '../../shared/review.ts'
import { projectMarkdown, walk, textOf, wordStats, citationMarkers } from '../editing/markdown.ts'
import type { Ledger } from '../../shared/schema.ts'
import { requirementCount } from '../requirements/counting.ts'
import type { Mutation } from '../store/transactions.ts'
import { isDetachedProjectPointer } from '../project/identity.ts'

type Issue = Ledger['reviewIssues'][string]
const CURRENT = '.scholarflow/reviews/current.json'
// Only review dependencies belong in this digest. Persisting a review or delivery
// must not invalidate that very review; raw approved material bytes do belong.
export async function reviewInput(io: FileStore) {
  const current = await snapshot(io), materialHashes: Record<string, string> = {}
  for (const material of Object.values(current.ledger.materials)) {
    if (!current.config.materials.include.includes(material.projectRelativePath)) { materialHashes[material.id] = 'not-selected'; continue }
    try { materialHashes[material.id] = digest(await io.readBytes(material.projectRelativePath, 50 * 1024 * 1024)) }
    catch { materialHashes[material.id] = 'unavailable' }
  }
  const profile = await io.read('.scholarflow/profiles/review.md')
  const contextHashes: Record<string, string> = {}
  for (const path of [current.config.writing.projectProfile, '.scholarflow/context/decisions.md', '.scholarflow/context/terminology.md', '.scholarflow/context/writing-memory.md', '.scholarflow/context/approvals.json', '.scholarflow/resources.lock.json']) {
    const image = await io.read(path); contextHashes[path] = image ? digest(image.text) : 'missing'
  }
  const { requirements, materials, sources, evidence, claims, outline, claimAnchors } = current.ledger
  return { current, materialHashes, dependencyHash: digest(json({ evaluatorVersion: 'sf-review-v2-bom-and-unmanaged-citations', configHash: current.configHash, documentHash: current.document.contentHash,
    revisionId: current.document.revisionId, requirements, materials, sources, evidence, claims, outline, claimAnchors,
    materialHashes, contextHashes, reviewProfileHash: profile ? digest(profile.text) : 'missing' })) }
}

export async function inspectReview(io: FileStore, observedInput?: Awaited<ReturnType<typeof reviewInput>>) {
  const reference = await io.read(CURRENT)
  if (!reference || await isDetachedProjectPointer(io, CURRENT, reference)) return { report: undefined, stale: true }
  const pointer = JSON.parse(reference.text)
  invariant(typeof pointer.reviewId === 'string' && /^review_[\w]+$/.test(pointer.reviewId), 'REVIEW_INVALID', '当前审查索引损坏。')
  const file = await io.read(`.scholarflow/reviews/${pointer.reviewId}/report.json`)
  invariant(file && digest(file.text) === pointer.reportHash, 'REVIEW_INVALID', '审查快照缺失或已被修改。')
  const report = reviewReportSchema.parse(JSON.parse(file.text)), input = observedInput ?? await reviewInput(io)
  invariant(report.projectId === input.current.ledger.projectId, 'PROJECT_ID_CONFLICT', '审查不属于当前项目。')
  return { report, stale: report.dependencyHash !== input.dependencyHash || input.current.document.externalChange,
    issues: Object.values(input.current.ledger.reviewIssues).filter(issue => issue.reviewId === report.id),
    manualEligible: manualEligibleChecks(report, input) }
}

export function manualEligibleChecks(report: ReviewReport, input: Awaited<ReturnType<typeof reviewInput>>) {
  const ledger = input.current.ledger
  return report.checks.filter(check => {
    if (['argument_assessment', 'style_assessment'].includes(check.id) && ['model-assisted', 'manual'].includes(check.method)) return true
    if (check.id.startsWith('requirement_')) {
      const requirement = ledger.requirements[check.id.slice('requirement_'.length)]
      return (check.status === 'unknown' || check.method === 'manual') && requirement?.confirmation === 'confirmed' && requirement.verificationMethod !== 'deterministic'
    }
    if (check.id === 'own_research_results' && check.status === 'unknown') return Object.values(ledger.evidence).some(evidence => {
      const source = ledger.sources[evidence.sourceId]
      return evidence.kind === 'user-measurement' && evidence.validation === 'located' && evidence.measurement?.origin === 'user-supplied' &&
        source?.kind === 'user-result' && source.contentHash === evidence.sourceContentHash && source.materialId && input.materialHashes[source.materialId] === evidence.sourceContentHash
    })
    return false
  }).map(check => check.id)
}

export function evaluateReview(input: Awaited<ReturnType<typeof reviewInput>>): ReviewReport {
  const { current, materialHashes, dependencyHash } = input, { ledger, document } = current
  const reviewId = newId('review'), projection = projectMarkdown(document.text), count = wordStats(document.text)
  const checks: ReviewReport['checks'] = [], issues: Issue[] = []
  const check = (key: string, status: 'pass' | 'fail' | 'unknown', detail: string, category: Issue['category'], severity: Issue['severity'] = 'B1', refs: Partial<Issue> = {}, method: Issue['checkMethod'] = 'deterministic') => {
    checks.push({ id: key, status, method, detail })
    if (status !== 'pass') issues.push({ id: `issue_${digest(key).slice(7, 31)}`, reviewId, category, severity, title: detail, explanation: detail,
      documentId: 'paper', documentHash: document.contentHash, claimIds: [], evidenceIds: [], requirementIds: [], checkMethod: method,
      state: 'open', stale: false, ...refs })
  }
  check('body_nonempty', projection.blocks.length && !document.initialPlaceholder ? 'pass' : 'fail', '主稿需要实际正文，初始化占位稿不能作为完成稿。', 'structure', 'B0')
  let pending = false, imageCount = 0
  walk(projection.tree, node => { if (node.type === 'text' && /\[待补[：:]/.test(node.value ?? '')) pending = true; if (node.type === 'image') imageCount++ })
  check('pending_markers', pending ? 'fail' : 'pass', '正文待补项必须保留并完成后复查。', 'integrity', 'B0')
  check('image_assets', imageCount ? 'unknown' : 'pass', imageCount ? '正文含图片；当前导出器尚未验证、复制及重写图片资源。' : '当前主稿不包含需要复制的图片。', 'structure', 'B1')
  const unmanaged = citationMarkers(document.text, projection.tree).filter(marker => marker.kind === 'numeric' || marker.keys.some(key => !/^sf_[a-zA-Z0-9_]+$/u.test(key)))
  check('unmanaged_citation_markers', unmanaged.length ? 'unknown' : 'pass', unmanaged.length
    ? `正文含 ${unmanaged.length} 个未映射引用／数字标记；仅保留原文，未关联来源或纳入自动 BibTeX。请明确登记来源并改用项目引用键；数字方括号也可能是普通记号，不能猜测其含义。`
    : '当前正文没有检测到所支持语法的未映射引用／数字标记；该规则不能识别所有文献格式。', 'citation', 'B1')
  for (const key of projection.citationOrder) {
    const source = Object.values(ledger.sources).find(source => source.citeKey === key)
    check(`cite_${key}`, source ? 'pass' : 'fail', source ? `引用 ${key} 有来源记录。` : `引用 ${key} 缺少来源记录。`, 'citation', 'B0')
    if (!source) continue
    check(`identity_${source.id}`, source.identity.status === 'matched' ? 'pass' : source.identity.status === 'mismatch' ? 'fail' : 'unknown',
      `来源 ${source.id} 的元数据身份状态：${source.identity.status}；身份匹配不代表支持正文论断。`, 'citation')
    const available = Object.values(ledger.evidence).filter(evidence => evidence.sourceId === source.id && evidence.validation === 'located' &&
      evidence.sourceContentHash === source.contentHash && source.materialId && materialHashes[source.materialId] === evidence.sourceContentHash)
    check(`evidence_${source.id}`, available.length ? 'pass' : 'unknown', `来源 ${source.id} 的当前可定位证据${available.length ? '存在' : '不足或已过期'}。`, 'evidence', 'B1', { evidenceIds: available.map(item => item.id) })
  }
  for (const claim of Object.values(ledger.claims)) {
    const linked = claim.evidenceLinks.map(link => ledger.evidence[link.evidenceId])
    const valid = linked.every(evidence => { const source = evidence && ledger.sources[evidence.sourceId]; return evidence && source && evidence.validation === 'located' &&
      evidence.sourceContentHash === source.contentHash && !!source.materialId && materialHashes[source.materialId] === evidence.sourceContentHash })
    check(`claim_${claim.id}`, valid && claim.status === 'supported' ? 'pass' : 'unknown', `论点 ${claim.id} 的关系为 ${claim.status}；支持范围需要保留。`, 'evidence', 'B1', { claimIds: [claim.id], evidenceIds: linked.filter(Boolean).map(item => item.id) })
  }
  check('outline_confirmed', ledger.outline.confirmation === 'confirmed' && ledger.outline.sections.length ? 'pass' : 'fail', '写作大纲需要显式确认。', 'structure')
  const headings: string[] = []
  walk(projection.tree, node => { if (node.type === 'heading') headings.push(textOf(node).trim()) })
  for (const section of ledger.outline.sections) check(`section_${section.id}`, headings.includes(section.title.trim()) ? 'pass' : 'fail', `大纲章节 ${section.id} 是否存在于主稿标题中。`, 'structure')
  for (const requirement of Object.values(ledger.requirements)) {
    let status: 'pass' | 'fail' | 'unknown' = 'unknown'
    const constraint = requirement.constraint
    const counted = requirementCount(requirement, count, projection.citationOrder.map(key => Object.values(ledger.sources).find(source => source.citeKey === key)).filter(source => !!source))
    if (requirement.confirmation === 'confirmed' && constraint) {
      const actual = counted.actual
      if (actual !== undefined && typeof constraint.value === 'number') {
        if (constraint.operator === 'min') status = actual >= constraint.value ? 'pass' : 'fail'
        if (constraint.operator === 'max') status = actual <= constraint.value ? 'pass' : 'fail'
        if (constraint.operator === 'equals') status = actual === constraint.value ? 'pass' : 'fail'
        if (constraint.operator === 'ratio') status = actual >= constraint.value ? 'pass' : 'fail'
      }
      if (requirement.kind === 'section' && typeof constraint.value === 'string' && constraint.operator === 'contains') status = headings.includes(constraint.value.trim()) ? 'pass' : 'fail'
      if (requirement.kind === 'format' && constraint.operator === 'equals') status = constraint.value === 'markdown' ? 'pass' : 'fail'
    }
    check(`requirement_${requirement.id}`, status, `要求 ${requirement.id}：${requirement.confirmation}；${status === 'unknown' ? '当前自动检查无法判定，需确认口径或人工审查' : '已按保存的约束检查'}。${['length', 'references'].includes(requirement.kind) ? ` ${counted.detail}${counted.actual === undefined ? '' : ` 实际计数／比例：${Number(counted.actual.toFixed(4))}${constraint?.unit === 'percent' ? '%' : ''}。`}` : ''}`, 'requirement', 'B1', { requirementIds: [requirement.id] })
  }
  if (current.config.project.type === 'research-paper') {
    const results = Object.values(ledger.evidence).filter(evidence => evidence.kind === 'user-measurement' && evidence.validation === 'located' && evidence.measurement?.origin === 'user-supplied')
    check('own_research_results', results.length ? 'unknown' : 'fail', results.length ? '已登记用户测量；完整实验设置、记录与正文对应仍需人工核验。' : '本项目没有已登记的真实实验结果；其他论文结果不能替代本项目实验。', 'integrity', 'B0', { evidenceIds: results.map(item => item.id) }, 'manual')
  }
  check('argument_assessment', 'unknown', '本轮未执行模型辅助论证审查；支持范围、反例与推论质量仍需审阅。', 'logic', 'B1', {}, 'model-assisted')
  check('style_assessment', 'unknown', '本轮未执行模型辅助文风审查；不存在课程成绩或接收概率评分。', 'style', 'B2', {}, 'model-assisted')
  return reviewReportSchema.parse({ schemaVersion: 1, id: reviewId, projectId: ledger.projectId, documentId: 'paper', documentHash: document.contentHash,
    revisionId: document.revisionId, ledgerRevision: ledger.revision, dependencyHash, createdAt: new Date().toISOString(), checks, issues,
    limitations: ['本轮只执行列出的确定性检查；模型辅助与人工未知项不能视为通过。', '来源身份与全文访问状态不等同于论点支持；未选资料不进入审查。', '未使用的收录来源不会被自动加入正文。'],
    statistics: { chineseCharacters: count.chineseCharacters, westernWords: count.westernWords, uniqueReferences: projection.citationOrder.length, countingPolicyId: 'sf-body-han-western-v1' } })
}

export async function runReview(io: FileStore, expectedRevision: number, extra: Mutation[] | ((report: ReviewReport) => Mutation[]) = []) {
  const input = await reviewInput(io)
  invariant(!input.current.document.externalChange, 'STALE_DOCUMENT_VERSION', '请先显式采用或保存外部改稿，再审查。')
  const report = evaluateReview(input)
  return storeReview(io, report, expectedRevision, [], typeof extra === 'function' ? extra(report) : extra)
}

export async function storeReview(io: FileStore, report: ReviewReport, expectedRevision: number, completedCheckIds: string[] = [], extra: Mutation[] = [], resolvedModelIssueIds: string[] = []) {
  report = reviewReportSchema.parse(report)
  const text = json(report)
  const result = await mutateLedger(io, expectedRevision, async ledger => {
    const input = await reviewInput(io)
    invariant(ledger.projectId === report.projectId && input.dependencyHash === report.dependencyHash && input.current.document.contentHash === report.documentHash && !input.current.document.externalChange,
      'REVIEW_INPUT_CHANGED', '审查期间稿件、资料或要求发生变化，请重新审查。')
    const detected = new Set(report.issues.map(issue => issue.id)), passed = new Set(report.checks.filter(check => check.status === 'pass').map(check => `issue_${digest(check.id).slice(7, 31)}`))
    for (const old of Object.values(ledger.reviewIssues)) {
      if (detected.has(old.id)) continue
      if (passed.has(old.id) && (old.checkMethod === 'deterministic' || completedCheckIds.some(key => `issue_${digest(key).slice(7, 31)}` === old.id)) || old.checkMethod === 'model-assisted' && resolvedModelIssueIds.includes(old.id)) {
        old.state = 'resolved'; old.stale = false; old.resolutionReason = old.checkMethod === 'deterministic' ? '对应规则在本次同版本复查通过。' : '对应检查在本次同版本明确复核通过，依据保存在不可变审查记录。'; old.reviewId = report.id; old.documentHash = report.documentHash
      }
      else if (old.state !== 'resolved') old.stale = true
    }
    for (const issue of report.issues) {
      const old = ledger.reviewIssues[issue.id]
      ledger.reviewIssues[issue.id] = { ...issue, ...(old && ['accepted-risk', 'dismissed'].includes(old.state) && { state: old.state, resolutionReason: old.resolutionReason }) }
    }
    const pointer = await io.read(CURRENT)
    return [{ path: `.scholarflow/reviews/${report.id}/report.json`, before: undefined, after: text },
      { path: CURRENT, before: pointer, after: json({ reviewId: report.id, reportHash: digest(text) }) }, ...extra]
  })
  return { ...result, report, stale: false }
}

export async function decideIssue(io: FileStore, issueId: string, state: 'accepted-risk' | 'dismissed', reason: string, expectedRevision: number) {
  invariant(reason.trim().length && reason.length <= 2000, 'RESOLUTION_REASON_REQUIRED', '请填写处理理由。')
  return mutateLedger(io, expectedRevision, ledger => {
    const issue = ledger.reviewIssues[issueId]
    invariant(issue && issue.state !== 'resolved', 'ISSUE_NOT_OPEN', '问题不存在或已通过复查关闭。')
    issue.state = state; issue.resolutionReason = reason.trim()
  })
}
