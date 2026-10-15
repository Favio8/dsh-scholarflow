import {citationGroups} from '../export/citation-groups.ts'
import { snapshot, mutateLedger } from '../project/project.ts'
import { digest, newId, json, type FileStore } from '../store/files.ts'
import { invariant, parseStored } from '../../shared/errors.ts'
import { reviewReportSchema, semanticReviewChecks, pendingModelReviewDetails, type ReviewReport } from '../../shared/review.ts'
import { projectMarkdown, walk, textOf, wordStats, citationMarkers } from '../editing/markdown.ts'
import type { Ledger } from '../../shared/schema.ts'
import { requirementCount } from '../requirements/counting.ts'
import type { Mutation } from '../store/transactions.ts'
import { isDetachedProjectPointer } from '../project/identity.ts'
import { sectionTarget,documentHeadings } from '../editing/sections.ts'
import { authorResultApprovalSchema,researchGoalProfileSchema } from '../../shared/results.ts'
import {exportImages} from '../export/images.ts'
import {resultProofs} from '../research/result-proofs.ts'

type Issue = Ledger['reviewIssues'][string]
const CURRENT = '.scholarflow/reviews/current.json'
// Compare decimal literals without rounding distinct large integers through IEEE-754.
function decimalIdentity(raw:string){
  const [mantissa,exponent='0']=raw.toLowerCase().replaceAll(',','').split('e'),scale=Number(exponent)
  if(!Number.isSafeInteger(scale))return raw.toLowerCase()
  const negative=mantissa.startsWith('-'),unsigned=mantissa.replace(/^[-+]/u,''),fraction=unsigned.split('.')[1]?.length??0,digits=unsigned.replace('.','').replace(/^0+/u,'')
  if(!digits)return '0'
  const coefficient=digits.replace(/0+$/u,'')
  return `${negative?'-':''}${coefficient}e${scale-fraction+digits.length-coefficient.length}`
}
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
  try{contextHashes.documentImages=(await exportImages(io,current.document.text,current.config.paths.mainDocument)).hash}catch{contextHashes.documentImages='unavailable'}
  for (const path of [current.config.writing.projectProfile, '.scholarflow/context/decisions.md', '.scholarflow/context/terminology.md', '.scholarflow/context/writing-memory.md', '.scholarflow/context/approvals.json', '.scholarflow/resources.lock.json', '.scholarflow/writing/requirements.json', '.scholarflow/research/experiments.json','.scholarflow/research/result-associations.json','.scholarflow/research/material-roles.json']) {
    const image = await io.read(path); contextHashes[path] = image ? digest(image.text) : 'missing'
  }
  const results=await resultProofs(io,current.ledger,materialHashes);Object.assign(contextHashes,results.hashes);contextHashes.resultFigures=digest(json(results.figures))
  const { requirements, materials, sources, evidence, claims, outline, claimAnchors } = current.ledger
  const approvalFile=await io.read(`.scholarflow/research/author-approvals/${current.document.revisionId}.json`)
  const authorResultApproval=approvalFile?parseStored(authorResultApprovalSchema,approvalFile.text,'AUTHOR_RESULT_APPROVAL_INVALID','review.input'):undefined
  const goalFile=await io.read('.scholarflow/research/goal-profile.json'),goalProfile=goalFile?parseStored(researchGoalProfileSchema,goalFile.text,'RESEARCH_GOAL_INVALID','review.input'):undefined
  invariant(!goalProfile||goalProfile.projectId===current.ledger.projectId,'PROJECT_ID_CONFLICT','研究目标记录不属于当前项目。')
  contextHashes['.scholarflow/research/goal-profile.json']=goalFile?digest(goalFile.text):'missing'
  const contextDependencyHash = digest(json({ evaluatorVersion: 'sf-review-v13-metric-parameters', configHash: current.configHash,
    requirements, materials, sources, evidence, claims, outline, materialHashes, contextHashes, formatting: current.ledger.documents.paper.formatting,
    reviewProfileHash: profile ? digest(profile.text) : 'missing' }))
  return { current, materialHashes, contextDependencyHash,authorResultApproval,goalProfile,results, dependencyHash: digest(json({ evaluatorVersion: 'sf-review-v13-metric-parameters',authorApprovalHash:approvalFile?digest(approvalFile.text):null, configHash: current.configHash, documentHash: current.document.contentHash,
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
  const report = parseStored(reviewReportSchema, file.text, 'REVIEW_INVALID', 'review.inspect'), input = observedInput ?? await reviewInput(io)
  invariant(report.projectId === input.current.ledger.projectId, 'PROJECT_ID_CONFLICT', '审查不属于当前项目。')
  return { report, stale: report.dependencyHash !== input.dependencyHash || input.current.document.externalChange,
    issues: Object.values(input.current.ledger.reviewIssues).filter(issue => issue.reviewId === report.id),
    manualEligible: manualEligibleChecks(report, input) }
}

export function manualEligibleChecks(report: ReviewReport, input: Awaited<ReturnType<typeof reviewInput>>) {
  const ledger = input.current.ledger
  return report.checks.filter(check => {
    if ((semanticReviewChecks as readonly string[]).includes(check.id) && ['model-assisted', 'manual'].includes(check.method)) return true
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
  const reviewId = newId('review'), projection = projectMarkdown(document.text), count = wordStats(document.text, { bodyOnly: true, sectionKinds: ledger.outline.sections })
  const citedSources=citationGroups(document.text,ledger).sources
  const checks: ReviewReport['checks'] = [], issues: Issue[] = []
  const check = (key: string, status: 'pass' | 'fail' | 'unknown', detail: string, category: Issue['category'], severity: Issue['severity'] = 'B1', refs: Partial<Issue> = {}, method: Issue['checkMethod'] = 'deterministic') => {
    checks.push({ id: key, status, method, detail })
    if (status !== 'pass') issues.push({ id: `issue_${digest(key).slice(7, 31)}`, reviewId, category, severity, title: detail, explanation: detail,
      documentId: 'paper', documentHash: document.contentHash, claimIds: [], evidenceIds: [], requirementIds: [], checkMethod: method,
      state: 'open', stale: false, ...refs })
  }
  check('body_nonempty', projection.blocks.some(block=>block.node.type==='paragraph'&&textOf(block.node).trim()) && !document.initialPlaceholder ? 'pass' : 'fail', '主稿需要实际正文，占位稿或只有标题不能作为完成稿。', 'structure', 'B0')
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
  for (const section of ledger.outline.sections){let substantive=false
    try{const target=sectionTarget(document.text,ledger.outline,section.id);substantive=projection.blocks.some(block=>block.node.type==='paragraph'&&block.start>=target.startUtf16&&block.end<=target.endUtf16&&textOf(block.node).trim())}catch{/* Missing or ambiguous headings remain a real gap. */}
    check(`section_${section.id}`, headings.includes(section.title.trim())&&substantive ? 'pass' : 'fail', `大纲章节 ${section.id} 需要实际标题及实质正文，不能仅凭标题通过。`, 'structure')
  }
  for (const requirement of Object.values(ledger.requirements)) {
    let status: 'pass' | 'fail' | 'unknown' = 'unknown'
    const constraint = requirement.constraint
    const counted = requirementCount(requirement, count, citedSources)
    if (requirement.confirmation === 'confirmed' && constraint) {
      const actual = counted.actual
      if (actual !== undefined && typeof constraint.value === 'number') {
        if (constraint.operator === 'min') status = actual >= constraint.value ? 'pass' : 'fail'
        if (constraint.operator === 'max') status = actual <= constraint.value ? 'pass' : 'fail'
        if (constraint.operator === 'equals') status = actual === constraint.value ? 'pass' : 'fail'
        if (constraint.operator === 'ratio') status = actual >= constraint.value ? 'pass' : 'fail'
      }
      if (requirement.kind === 'section' && typeof constraint.value === 'string' && constraint.operator === 'contains') {
        const wanted=constraint.value.normalize('NFC').trim().replace(/\s+/gu,' '),nodes=documentHeadings(document.text),heading=nodes.find(node=>node.title===wanted)
        const end=heading?nodes.find(node=>node.start>heading.start&&node.depth<=heading.depth)?.start??document.text.length:0
        status=heading&&projection.blocks.some(block=>block.start>=heading.end&&block.end<=end&&block.node.type==='paragraph'&&textOf(block.node).trim())?'pass':'fail'
      }
      if (requirement.kind === 'format' && constraint.operator === 'equals') status = constraint.value === 'markdown' ? 'pass' : 'fail'
    }
    check(`requirement_${requirement.id}`, status, `要求 ${requirement.id}：${requirement.confirmation}；${status === 'unknown' ? '当前自动检查无法判定，需确认口径或人工审查' : '已按保存的约束检查'}。${['length', 'references'].includes(requirement.kind) ? ` ${counted.detail}${counted.actual === undefined ? '' : ` 实际计数／比例：${Number(counted.actual.toFixed(4))}${constraint?.unit === 'percent' ? '%' : ''}。`}` : ''}`, 'requirement', 'B1', { requirementIds: [requirement.id] })
  }
  if (input.goalProfile?.researchKind==='theoretical')check('research_applicability','pass','按作者明确确认的理论研究类型，实验条款不适用；证明管理与证明核验仍在本轮支持范围之外。','integrity')
  else if (input.goalProfile?.goal==='research-results'||current.config.project.type === 'research-paper'&&!input.goalProfile) {
    const results = Object.values(ledger.evidence).filter(evidence => { const source = ledger.sources[evidence.sourceId]
      return evidence.kind === 'user-measurement' && evidence.validation === 'located' && evidence.measurement?.origin === 'user-supplied' &&
        source?.kind === 'user-result' && source.contentHash === evidence.sourceContentHash && source.materialId && materialHashes[source.materialId] === evidence.sourceContentHash })
    const resultIds=new Set(results.map(row=>row.id)),anchors=Object.values(ledger.claimAnchors).filter(anchor=>anchor.status==='current'&&anchor.documentHash===document.contentHash&&anchor.claimIds.some(id=>ledger.claims[id]?.evidenceLinks.some(link=>resultIds.has(link.evidenceId))))
    const numbers=(text:string)=>[...text.matchAll(/(?<![A-Za-z\p{N}_.])[-+]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?![A-Za-z\p{N}_.])/gu)].map(match=>decimalIdentity(match[0]))
    const unit=(value:string)=>(({'％':'%','percent':'%','percentage':'%','percentage-points':'pp','个百分点':'pp','百分点':'pp','秒':'s','sec':'s','毫秒':'ms','微秒':'us','µs':'us','μs':'us'} as Record<string,string>)[value.trim().toLowerCase()]??value.trim().toLowerCase())
    const quantities=(text:string)=>[...text.matchAll(/(?<![A-Za-z\p{N}_.])([-+]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(个百分点|百分点|毫秒|微秒|秒|%|％|ms\b|µs\b|μs\b|us\b|s\b|GiB\b|MiB\b|GB\b|MB\b)/gu)].map(match=>({value:decimalIdentity(match[1]),unit:unit(match[2])}))
    const unlinkedQuantities=projection.blocks.filter(block=>['paragraph','table'].includes(block.node.type)&&quantities(textOf(block.node)).length&&!anchors.some(anchor=>anchor.blockId===block.id)&&!projection.leaves.some(leaf=>leaf.start>=block.start&&leaf.end<=block.end&&leaf.citationKeys?.some(key=>Object.values(ledger.sources).some(source=>source.citeKey===key&&source.kind!=='user-result'))))
    for(const block of unlinkedQuantities)check(`result_unlinked_${block.id}`,'unknown','含数值及单位的段落尚无作者结果关联或外部文献引用，不能把其他段落已核对当作本段通过。','evidence','B1',{location:{blockId:block.id,sourceRange:{startUtf16:block.start,endUtf16:block.end},quote:document.text.slice(block.start,Math.min(block.end,block.start+4000)),blockTextHash:digest(document.text.slice(block.start,block.end))}})
    let numericMismatch=false
    for(const anchor of anchors){const block=projection.blocks.find(row=>row.id===anchor.blockId)
      const supporting=anchor.claimIds.flatMap(id=>ledger.claims[id]?.evidenceLinks??[]).filter(link=>['supports','partial'].includes(link.relation)).map(link=>ledger.evidence[link.evidenceId]).filter(row=>row&&resultIds.has(row.id))
      if(!block||digest(document.text.slice(block.start,block.end))!==anchor.blockTextHash){numericMismatch=true;continue}
      const ids=new Set(supporting.map(row=>row.id)),derived=input.results.comparisons.filter(row=>row.current&&row.evidenceIds.every(id=>ids.has(id)))
      const external=anchor.claimIds.flatMap(id=>ledger.claims[id]?.evidenceLinks??[]).map(link=>ledger.evidence[link.evidenceId]).filter(row=>row&&ledger.sources[row.sourceId]?.kind!=='user-result'&&row.validation==='located'&&materialHashes[ledger.sources[row.sourceId].materialId!]===row.sourceContentHash)
      const authorContext=anchor.claimIds.flatMap(id=>ledger.claims[id]?.evidenceLinks??[]).filter(link=>['supports','partial'].includes(link.relation)).map(link=>ledger.evidence[link.evidenceId]).filter(row=>row&&row.kind!=='user-measurement'&&ledger.sources[row.sourceId]?.kind==='user-result'&&row.validation==='located'&&materialHashes[ledger.sources[row.sourceId].materialId!]===row.sourceContentHash)
      const allowed=[...supporting.flatMap(row=>[...numbers(String(row.measurement!.value)),...numbers(row.measurement!.conditions),...[...row.measurement!.metric.matchAll(/\d+(?:\.\d+)?/gu)].map(match=>decimalIdentity(match[0]))]),...authorContext.flatMap(row=>numbers(row.excerpt)),...external.flatMap(row=>numbers(row.excerpt)),...derived.flatMap(row=>row.values.map(value=>decimalIdentity(String(value))))]
      const allowedQuantities=[...supporting.flatMap(row=>[...numbers(String(row.measurement!.value)).map(value=>({value,unit:unit(row.measurement!.unit??'')})),...quantities(row.measurement!.conditions)]),...external.flatMap(row=>quantities(row.excerpt)),...derived.flatMap(row=>{const record=row.record as any;return [{value:record.comparison.absoluteChange,unit:unit(record.comparison.changeUnit)},{value:record.comparison.relativePercent,unit:'%'},{value:record.left.value,unit:unit(record.left.unit)},{value:record.right.value,unit:unit(record.right.unit)}].filter(row=>Number.isFinite(row.value)).map(row=>({...row,value:decimalIdentity(String(row.value))}))})]
      const prose=projection.leaves.filter(leaf=>leaf.start>=block.start&&leaf.end<=block.end&&!leaf.citationKeys).map(leaf=>leaf.text).join(' '),actual=numbers(prose),unexpected=actual.filter(value=>!allowed.includes(value)),unitMismatch=quantities(prose).filter(quantity=>!allowedQuantities.some(allowed=>allowed.value===quantity.value&&allowed.unit===quantity.unit))
      if(unexpected.length||unitMismatch.length){numericMismatch=true;check(`result_value_${anchor.id}`,'fail',`结果段落数值或单位 ${[...unexpected.map(String),...unitMismatch.map(row=>`${row.value} ${row.unit}`)].join('、')} 未对应当前关联的作者原值、单位、条件或已确认推导。`,'integrity','B0',{evidenceIds:supporting.map(row=>row.id),claimIds:anchor.claimIds,location:{blockId:block.id,sourceRange:{startUtf16:block.start,endUtf16:block.end},quote:document.text.slice(block.start,Math.min(block.end,block.start+4000)),blockTextHash:anchor.blockTextHash}})}
    }
    for(const figure of input.results.figures)check(`result_figure_${digest(figure.path).slice(7,31)}`,figure.current?'pass':'fail',figure.current?`图像 ${figure.path} 与当前作者说明、结果及资源 hash 对应；未独立核验曲线和图内全部数值。`:`图像 ${figure.path} 或关联实验已有变化，需重新确认。`,'integrity',figure.current?'B1':'B0',{evidenceIds:figure.evidenceIds})
    const usedResultIds=new Set(anchors.flatMap(anchor=>anchor.claimIds.flatMap(id=>ledger.claims[id]?.evidenceLinks??[]).map(link=>link.evidenceId)).filter(id=>resultIds.has(id))),usedResults=results.filter(row=>usedResultIds.has(row.id)),unitsKnown=usedResults.length>0&&usedResults.every(row=>!numbers(String(row.measurement!.value)).length||!!row.measurement!.unit?.trim())
    check('own_result_units',unitsKnown?'pass':'unknown','已用数值测量须明确单位或无量纲口径；未使用结果的缺项及非数值观察不强加单位。','integrity','B1',{evidenceIds:[...usedResultIds]})
    check('own_result_links',results.length&&anchors.length&&!unlinkedQuantities.length?'pass':'unknown','本项目结果需要当前正文与论点、测量的内部关联；仅登记结果不能证明正文对应。','evidence','B1',{evidenceIds:[...resultIds]})
    check('own_result_numbers',numericMismatch?'fail':anchors.length&&!unlinkedQuantities.length?'pass':'unknown','核对当前已关联结果段落的原值、条件与所支持显式单位；未关联量值保持待核对。统计推断或换算必须另有确认的输入与方法，其他语义仍需模型及作者审阅。','integrity','B0',{evidenceIds:[...resultIds]})
    const approval=input.authorResultApproval,approved=approval&&approval.projectId===ledger.projectId&&approval.documentHash===document.contentHash&&approval.revisionId===document.revisionId&&approval.environmentHash===input.contextDependencyHash&&json([...approval.evidenceIds].sort())===json([...resultIds].sort())
    check('own_research_results', results.length ? approved&&anchors.length&&!numericMismatch&&unitsKnown&&!unlinkedQuantities.length?'pass':'unknown' : 'fail', results.length ? approved&&unitsKnown&&!unlinkedQuantities.length?'当前结果供给、正文映射、原值及作者集中采用均有同版本依据；工具未独立复现实验。':'已登记用户测量；实际单位、设置、记录与正文对应仍需核对及最终集中审阅确认。' : '本项目没有已登记的真实实验结果；其他论文结果不能替代本项目实验。', 'integrity', 'B0', { evidenceIds: results.map(item => item.id) }, 'manual')
  }
  check('argument_assessment', 'unknown', pendingModelReviewDetails.argument_assessment, 'logic', 'B1', {}, 'model-assisted')
  check('style_assessment', 'unknown', pendingModelReviewDetails.style_assessment, 'style', 'B2', {}, 'model-assisted')
  check('terminology_consistency', 'unknown', pendingModelReviewDetails.terminology_consistency, 'style', 'B2', {}, 'model-assisted')
  check('contribution_consistency', 'unknown', pendingModelReviewDetails.contribution_consistency, 'logic', 'B1', {}, 'model-assisted')
  check('summary_body_consistency', 'unknown', pendingModelReviewDetails.summary_body_consistency, 'integrity', 'B1', {}, 'model-assisted')
  return reviewReportSchema.parse({ schemaVersion: 1, id: reviewId, projectId: ledger.projectId, documentId: 'paper', documentHash: document.contentHash,
    revisionId: document.revisionId, ledgerRevision: ledger.revision, dependencyHash, createdAt: new Date().toISOString(), checks, issues,
    limitations: ['本轮只执行列出的确定性检查；模型辅助与人工未知项不能视为通过。', '来源身份与全文访问状态不等同于论点支持；未选资料不进入审查。', '未使用的收录来源不会被自动加入正文。'],
    statistics: { chineseCharacters: count.chineseCharacters, westernWords: count.westernWords, uniqueReferences: citedSources.length, countingPolicyId: 'sf-body-han-western-v1' } })
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
