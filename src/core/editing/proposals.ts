import { digest, newId, json, type FileStore } from '../store/files.ts'
import { snapshot, LEDGER_PATH, CONFIG_PATH, invalidateReviews } from '../project/project.ts'
import { commit, inspectRecovery, type Mutation } from '../store/transactions.ts'
import { proposalSchema, selectionSchema, type EditProposal, type SelectionPayload } from '../../shared/editing.ts'
import { sectionEdit } from './sections.ts'
import { ledgerSchema, id, type Ledger } from '../../shared/schema.ts'
import { invariant } from '../../shared/errors.ts'
import { citationKeys, citationMarkers, unicodeBoundary, validateSelection, wordStats, parseMarkdown, projectMarkdown, walk } from './markdown.ts'
import { bibliography } from '../export/bibliography.ts'
import { MAX_MATERIAL_BYTES, sensitivePath } from '../materials/materials.ts'
import { validateIssueFix } from '../review/issue-fixes.ts'

type Snapshot = Awaited<ReturnType<typeof snapshot>>
const proposalPath = (proposalId: string) => `.scholarflow/proposals/${id.parse(proposalId)}.json`
const now = () => new Date().toISOString()
function sameCitationTokens(before: string, after: string) {
  const tokens = (text: string) => citationMarkers(text).map(marker => marker.kind === 'keyed' ? JSON.stringify(marker.keys) : marker.text.replace(/\s/gu, '')).sort()
  return JSON.stringify(tokens(before)) === JSON.stringify(tokens(after))
}
export function applyEdits(source: string, edits: EditProposal['edits']) {
  const sorted = [...edits].sort((a, b) => a.startUtf16 - b.startUtf16)
  let previousEnd = 0
  for (const edit of sorted) {
    invariant(edit.startUtf16 >= previousEnd && edit.endUtf16 >= edit.startUtf16 && unicodeBoundary(source, edit.startUtf16) && unicodeBoundary(source, edit.endUtf16), 'PROPOSAL_RANGE_INVALID', '建议范围重叠或切开 Unicode/CRLF 边界。')
    invariant(source.slice(edit.startUtf16, edit.endUtf16) === edit.expectedText, 'STALE_DOCUMENT_VERSION', '建议原文与当前稿件不同，禁止猜测重定位。')
    invariant(edit.replacementText.isWellFormed(), 'PROPOSAL_RANGE_INVALID', '建议包含无效 Unicode 代理字符。')
    previousEnd = edit.endUtf16
  }
  let result = source
  for (const edit of sorted.reverse()) result = result.slice(0, edit.startUtf16) + edit.replacementText + result.slice(edit.endUtf16)
  parseMarkdown(result)
  return result
}
export function protectedChanges(before: string, after: string) {
  const facts = (source: string) => projectMarkdown(source).leaves.filter(leaf => !leaf.citationKeys).flatMap(leaf =>
    [...leaf.text.matchAll(/\d+(?:[.,]\d+)*(?:\s*(?:%|％|mg|kg|ms|秒|分钟|小时|人|次|个|年|页))?/g)].map(match => match[0])).sort()
  const old = facts(before), next = facts(after)
  const changes: string[] = []
  if (JSON.stringify(old) !== JSON.stringify(next)) changes.push(`数字／单位变化：${old.join('、') || '无'} → ${next.join('、') || '无'}`)
  for (const qualifier of ['仅', '可能', '尚未', '未验证', '计划', '小样本', '局限', '不支持'])
    if (before.includes(qualifier) && !after.includes(qualifier)) changes.push(`限定条件“${qualifier}”减少；需人工核对。`)
  return changes
}

export function buildProposal(current: Snapshot, input: { runId: string; instruction: string; replacementText: string; selection?: SelectionPayload; section?: EditProposal['section']; dependentEvidenceIds: string[]; reviewIssueId?: string }): EditProposal {
  invariant(!current.document.externalChange, 'STALE_DOCUMENT_VERSION', '先确认采用外部稿件版本，再生成建议。')
  let from = 0, to = current.document.text.length
  if (input.selection) {
    const selection = selectionSchema.parse(input.selection)
    invariant(selection.projectId === current.config.project.id && selection.documentId === 'paper' && selection.documentHash === current.document.contentHash && selection.revisionId === current.document.revisionId,
      'STALE_DOCUMENT_VERSION', '选区不属于当前项目和稿件版本。')
    validateSelection(current.document.text, selection)
    from = selection.sourceRange.startUtf16; to = selection.sourceRange.endUtf16
  }
  invariant(!(input.selection && input.section), 'PROPOSAL_RANGE_INVALID', '选区与章节范围不能混用。')
  const section = input.section && sectionEdit(current.document.text, current.ledger.outline, input.section)
  const edits = [section?.edit ?? { startUtf16: from, endUtf16: to, expectedText: current.document.text.slice(from, to), replacementText: input.replacementText }]
  const expectedText = edits[0].expectedText
  const changed = applyEdits(current.document.text, edits)
  const beforeKeys = citationKeys(current.document.text), afterKeys = citationKeys(changed)
  const added = afterKeys.filter(key => !beforeKeys.includes(key)), removed = beforeKeys.filter(key => !afterKeys.includes(key))
  bibliography(changed, current.ledger)
  invariant(!input.selection || (!added.length && !removed.length && sameCitationTokens(expectedText, edits[0].replacementText)), 'CITATION_CHANGE_REQUIRES_CONFIRMATION', '基础选区改写必须保留本选区引用 token；引用变更须单独提出。')
  for (const evidenceId of input.dependentEvidenceIds) invariant(current.ledger.evidence[evidenceId]?.validation === 'located', 'EVIDENCE_NOT_CURRENT', '建议依赖的证据未定位或已过期。')
  const factChanges = protectedChanges(expectedText, edits[0].replacementText)
  const unmanaged = citationMarkers(changed).filter(marker => marker.kind === 'numeric' || marker.keys.some(key => !/^sf_[a-zA-Z0-9_]+$/u.test(key)))
  invariant(!input.reviewIssueId || input.selection, 'ISSUE_FIX_SCOPE_INVALID', '问题修复必须包含明确完整段落。')
  const reviewIssue = input.reviewIssueId ? validateIssueFix(current, input.reviewIssueId, input.selection!) : undefined
  return proposalSchema.parse({ schemaVersion: 1, id: newId('prop'), projectId: current.config.project.id, runId: input.runId, documentId: 'paper',
    baseDocumentHash: current.document.contentHash, baseRevisionId: current.document.revisionId, scope: input.selection ? 'selection' : input.section ? 'section' : 'document',
    instruction: input.instruction, ...(input.selection && { selection: input.selection }), ...(input.section && { section: input.section }), edits,
    ...(reviewIssue && { reviewIssue: { issueId: reviewIssue.id, issueHash: digest(json(reviewIssue)) } }),
    citationChanges: { added, removed }, protectedFactChanges: factChanges, dependentEvidenceIds: [...new Set(input.dependentEvidenceIds)], createdAt: now(),
    checks: [{ id: 'citation-keys', status: unmanaged.length ? 'unknown' : 'pass', detail: unmanaged.length
      ? '受支持项目引用键有已登记来源；其他引用／数字标记仍未映射，不计入自动 BibTeX，也不表示身份或论点支持已核验。'
      : '受支持的项目引用键均有已登记来源；本规则不核验所有传统引用格式、出版身份或论点支持。' },
      { id: 'protected-facts', status: factChanges.length ? 'unknown' : 'pass', detail: factChanges.length ? '数字或限定条件变化，需要人工判断。' : '规则检查未发现列出的数字／限定词变化。' },
      { id: 'academic-truth', status: 'unknown', detail: '规则不能证明学术真实性、语义等价或支持范围；接受前逐项核对。' }] })
}

async function writable(io: FileStore) {
  const current = await snapshot(io)
  invariant(!(await inspectRecovery(io, current.config.paths.manuscriptDir)).pending.length, 'RECOVERY_REQUIRED', '请先确认恢复未完成事务。')
  return current
}
async function publishLedger(io: FileStore, current: Snapshot, ledger: Ledger, mutations: Mutation[]) {
  const before = await io.read(LEDGER_PATH), config = await io.read(CONFIG_PATH)
  invariant(before && digest(before.text) === current.ledgerHash && config && digest(config.text) === current.configHash, 'STALE_LEDGER_REVISION', '提交前配置或 ledger 被外部修改。')
  ledger.revision = current.ledger.revision + 1
  await commit(io, [...mutations, { path: LEDGER_PATH, before, after: json(ledgerSchema.parse(ledger)) }])
  return ledger.revision
}
export async function storeProposal(io: FileStore, proposal: EditProposal, revision: number, extra: Mutation[] = [], verify?: (current: Snapshot) => Promise<void>) {
  proposal = proposalSchema.parse(proposal)
  return io.lock(async () => {
    const current = await writable(io)
    invariant(current.ledger.revision === revision && proposal.projectId === current.config.project.id && proposal.baseDocumentHash === current.document.contentHash && proposal.baseRevisionId === current.document.revisionId,
      'STALE_DOCUMENT_VERSION', '生成期间项目或稿件已改变；建议未覆盖正文。')
    await verify?.(current)
    const next = structuredClone(current.ledger)
    let fixRecord: Mutation[] = []
    if (proposal.reviewIssue) {
      const issue = validateIssueFix(current, proposal.reviewIssue.issueId, proposal.selection!)
      invariant(digest(json(issue)) === proposal.reviewIssue.issueHash, 'ISSUE_FIX_CHANGED', '修复针对的问题已经改变，请重新生成。')
      let restoreState = issue.state
      if (restoreState === 'proposed-fix') {
        for (const row of Object.values(current.ledger.proposalStates).filter(state => state.state === 'pending')) {
          const previous = await proposalImage(io, row.proposalId)
          if (previous.proposal.reviewIssue?.issueId !== issue.id || previous.proposal.baseDocumentHash !== proposal.baseDocumentHash) continue
          const file = await io.read(`.scholarflow/reviews/fixes/${row.proposalId}.json`)
          if (!file) continue
          const record = JSON.parse(file.text)
          invariant(record.projectId === proposal.projectId && record.proposalId === row.proposalId && record.proposalHash === previous.contentHash &&
            digest(json(record.originalIssue)) === previous.proposal.reviewIssue.issueHash, 'ISSUE_FIX_CHANGED', '已有修复依据改变，未继承其状态。')
          const priorState = record.restoreState ?? record.originalIssue.state
          if (['open', 'accepted-risk', 'dismissed'].includes(priorState)) { restoreState = priorState; break }
        }
      }
      next.reviewIssues[issue.id].state = 'proposed-fix'
      fixRecord = [{ path: `.scholarflow/reviews/fixes/${proposal.id}.json`, before: undefined,
        after: json({ schemaVersion: 1, projectId: proposal.projectId, proposalId: proposal.id, proposalHash: digest(json(proposal)), originalIssue: issue, restoreState, createdAt: now() }) }]
    }
    next.proposalStates[proposal.id] = { proposalId: proposal.id, state: 'pending', updatedAt: now() }
    const nextRevision = await publishLedger(io, current, next, [{ path: proposalPath(proposal.id), before: undefined, after: json(proposal) }, ...fixRecord, ...extra])
    return { proposal, proposalHash: digest(json(proposal)), revision: nextRevision }
  })
}
export async function readProposal(io: FileStore, proposalId: string) {
  return (await proposalImage(io, proposalId)).proposal
}
export async function proposalImage(io: FileStore, proposalId: string) {
  const file = await io.read(proposalPath(proposalId))
  invariant(file, 'PROPOSAL_NOT_FOUND', '建议文件不存在。')
  return { proposal: proposalSchema.parse(JSON.parse(file.text)), contentHash: digest(file.text) }
}

async function documentMutation(io: FileStore, current: Snapshot, ledger: Ledger, text: string, origin: string, edits?: EditProposal['edits']) {
  invariant(text.isWellFormed(), 'DOCUMENT_INVALID', '正文包含无效 Unicode。')
  const statistics = wordStats(text)
  const revisionId = newId('rev'), documentHash = digest(text), baseDocumentHash = current.document.contentHash
  const paper = await io.read(current.config.paths.mainDocument), references = await io.read(current.config.paths.references)
  invariant(paper && digest(paper.text) === baseDocumentHash, 'STALE_DOCUMENT_VERSION', '提交前正文被外部编辑，已保留用户改动。')
  const previousManifestFile = await io.read(`.scholarflow/drafts/${current.document.revisionId}/manifest.json`)
  invariant(previousManifestFile, 'REVISION_NOT_FOUND', '当前稿件版本的快照清单缺失。')
  const previousManifest = JSON.parse(previousManifestFile.text)
  const expectedReferencesHash = previousManifest.referencesHash ?? digest(bibliography(current.document.text, current.ledger))
  const legacyPlaceholder = current.document.initialPlaceholder && references?.text === '% References are generated from cited project sources.\n'
  invariant(references && (digest(references.text) === expectedReferencesHash || legacyPlaceholder), 'REFERENCE_PROJECTION_CHANGED', '引用文件被外部修改；请先导入来源元数据并明确重新生成引用，未覆盖该文件。')
  const bib = bibliography(text, ledger)
  ledger.documents.paper = { ...ledger.documents.paper, currentHash: documentHash, revisionId, initialPlaceholder: false,
    lineEnding: text.includes('\r\n') ? text.replaceAll('\r\n', '').includes('\n') ? 'mixed' : 'crlf' : 'lf' }
  const beforeBlocks = projectMarkdown(current.document.text).blocks, afterBlocks = projectMarkdown(text).blocks
  for (const anchor of Object.values(ledger.claimAnchors)) {
    const old = beforeBlocks.find(block => block.id === anchor.blockId)
    if (anchor.documentId !== 'paper' || anchor.status !== 'current' || anchor.documentHash !== baseDocumentHash || !old || digest(current.document.text.slice(old.start, old.end)) !== anchor.blockTextHash) { anchor.status = 'needs-remap'; continue }
    let candidates = afterBlocks.filter(block => digest(text.slice(block.start, block.end)) === anchor.blockTextHash)
    if (edits) {
      const untouched = edits.every(edit => edit.endUtf16 <= old.start || edit.startUtf16 >= old.end)
      const shift = edits.filter(edit => edit.endUtf16 <= old.start).reduce((sum, edit) => sum + edit.replacementText.length - (edit.endUtf16 - edit.startUtf16), 0)
      candidates = untouched ? candidates.filter(block => block.start === old.start + shift && block.end === old.end + shift) : []
    }
    if (candidates.length === 1) { anchor.blockId = candidates[0].id; anchor.documentHash = documentHash }
    else anchor.status = 'needs-remap'
  }
  invalidateReviews(ledger)
  const mutations: Mutation[] = [
    { path: `.scholarflow/drafts/${revisionId}/preimage.md`, before: undefined, after: paper.text },
    { path: `.scholarflow/drafts/${revisionId}/paper.md`, before: undefined, after: text },
    { path: `.scholarflow/drafts/${revisionId}/manifest.json`, before: undefined, after: json({ schemaVersion: 1, revisionId, parentRevisionId: current.document.revisionId, documentId: 'paper', contentHash: documentHash, referencesHash: digest(bib), baseDocumentHash, origin, statistics, createdAt: now() }) },
    { path: current.config.paths.references, before: references, after: bib },
    { path: current.config.paths.mainDocument, before: paper, after: text },
  ]
  return { mutations, revisionId, documentHash, statistics }
}
export async function saveManual(io: FileStore, text: string, baseHash: string, revision: number,
  adoption?: { origin: string; verify: (current: Snapshot) => Promise<void>; extra: Mutation[] }) {
  return io.lock(async () => {
    const current = await writable(io)
    invariant(current.ledger.revision === revision, 'STALE_LEDGER_REVISION', '项目记录已更新，请重新读取。')
    invariant(current.document.contentHash === baseHash, 'STALE_DOCUMENT_VERSION', '手工编辑基于旧稿，保留缓冲并重新比较。')
    await adoption?.verify(current)
    const ledger = structuredClone(current.ledger), change = await documentMutation(io, current, ledger, text, adoption?.origin ?? 'user-manual')
    const nextRevision = await publishLedger(io, current, ledger, [...change.mutations, ...(adoption?.extra ?? [])])
    return { ...change, mutations: undefined, revision: nextRevision }
  })
}
export async function applyProposal(io: FileStore, proposalId: string, revision: number, expectedProposalHash: string) {
  return io.lock(async () => {
    const current = await writable(io), image = await proposalImage(io, proposalId), proposal = image.proposal, state = current.ledger.proposalStates[proposalId]
    invariant(image.contentHash === expectedProposalHash, 'PROPOSAL_CHANGED', '建议内容已改变，请重新检查完整差异。')
    invariant(proposal.projectId === current.config.project.id && state, 'PROPOSAL_NOT_FOUND', '建议不属于当前项目。')
    if (state.state === 'accepted') {
      const manifest = await io.read(`.scholarflow/drafts/${state.acceptedRevisionId}/manifest.json`)
      invariant(manifest, 'REVISION_NOT_FOUND', '已接受建议的版本快照缺失。')
      return { revisionId: state.acceptedRevisionId, documentHash: JSON.parse(manifest.text).contentHash, alreadyApplied: true }
    }
    invariant(state.state === 'pending', 'PROPOSAL_NOT_PENDING', '建议已拒绝或过期。')
    invariant(current.ledger.revision === revision, 'STALE_LEDGER_REVISION', '项目数据已更新，请重新检查差异。')
    invariant(proposal.baseDocumentHash === current.document.contentHash && proposal.baseRevisionId === current.document.revisionId && !current.document.externalChange,
      'STALE_DOCUMENT_VERSION', '正文已改变，禁止将旧建议定位到相似文本后覆盖。')
    if (proposal.selection) {
      validateSelection(current.document.text, proposal.selection)
      invariant(proposal.scope === 'selection' && proposal.edits.length === 1 && proposal.edits[0].startUtf16 === proposal.selection.sourceRange.startUtf16 &&
        proposal.edits[0].endUtf16 === proposal.selection.sourceRange.endUtf16 && proposal.edits[0].expectedText === proposal.selection.sourceText,
        'PROPOSAL_RANGE_INVALID', '实际建议修改超出已展示的选区范围。')
    } else if (proposal.section) {
      invariant(proposal.scope === 'section' && proposal.edits.length === 1 &&
        JSON.stringify(sectionEdit(current.document.text, current.ledger.outline, proposal.section).edit) === JSON.stringify(proposal.edits[0]),
        'PROPOSAL_RANGE_INVALID', '章节建议超出重新验证的大纲范围。')
    } else invariant(proposal.scope === 'document', 'PROPOSAL_RANGE_INVALID', '当前建议没有有效的范围合同。')
    for (const evidenceId of proposal.dependentEvidenceIds) {
      const evidence = current.ledger.evidence[evidenceId], source = current.ledger.sources[evidence?.sourceId], material = current.ledger.materials[source?.materialId ?? '']
      invariant(evidence?.validation === 'located' && source?.contentHash === evidence.sourceContentHash && material &&
        current.config.materials.include.includes(material.projectRelativePath) && !sensitivePath(material.projectRelativePath), 'EVIDENCE_NOT_CURRENT', '建议依赖的证据已过期、不可用或被移除。')
      invariant(digest(await io.readBytes(material.projectRelativePath, MAX_MATERIAL_BYTES)) === evidence.sourceContentHash, 'STALE_MATERIAL_VERSION', '接受前原始资料发生修改，建议未应用。')
    }
    const text = applyEdits(current.document.text, proposal.edits)
    const beforeKeys = citationKeys(current.document.text), afterKeys = citationKeys(text)
    invariant(JSON.stringify(afterKeys.filter(key => !beforeKeys.includes(key))) === JSON.stringify(proposal.citationChanges.added) &&
      JSON.stringify(beforeKeys.filter(key => !afterKeys.includes(key))) === JSON.stringify(proposal.citationChanges.removed), 'PROPOSAL_INVALID', '建议引用差异与实际内容不一致。')
    invariant(!proposal.selection || (!proposal.citationChanges.added.length && !proposal.citationChanges.removed.length && sameCitationTokens(proposal.edits[0].expectedText, proposal.edits[0].replacementText)), 'CITATION_CHANGE_REQUIRES_CONFIRMATION', '选区改写不能静默增删本选区引用。')
    const ledger = structuredClone(current.ledger), change = await documentMutation(io, current, ledger, text, proposal.id, proposal.edits)
    if (proposal.reviewIssue) {
      const issue = current.ledger.reviewIssues[proposal.reviewIssue.issueId], { state: _state, ...currentIssue } = issue ?? {}
      const originalFile = await io.read(`.scholarflow/reviews/fixes/${proposal.id}.json`)
      invariant(originalFile, 'ISSUE_FIX_CHANGED', '修复依据记录缺失，未接受。')
      const original = JSON.parse(originalFile.text), { state: _originalState, ...originalIssue } = original.originalIssue
      invariant(issue && issue.state === 'proposed-fix' && original.projectId === proposal.projectId && original.proposalId === proposal.id && original.proposalHash === image.contentHash &&
        digest(json(original.originalIssue)) === proposal.reviewIssue.issueHash && json(currentIssue) === json(originalIssue), 'ISSUE_FIX_CHANGED', '修复依据或问题发生变化，未接受旧建议。')
      ledger.reviewIssues[issue.id].state = 'proposed-fix'
      change.mutations.push({ path: `.scholarflow/reviews/fixes/${proposal.id}-recheck.json`, before: undefined,
        after: json({ schemaVersion: 1, projectId: proposal.projectId, proposalId: proposal.id, issueId: issue.id, documentHash: change.documentHash,
          revisionId: change.revisionId, state: 'pending' }) })
    }
    if (proposal.section) {
      const candidate = sectionEdit(current.document.text, current.ledger.outline, proposal.section), projection = projectMarkdown(text)
      for (const mapping of proposal.section.paragraphClaims) {
        const block = candidate.blocks[mapping.paragraphIndex], start = candidate.edit.startUtf16 + candidate.bodyOffset + block.start, end = candidate.edit.startUtf16 + candidate.bodyOffset + block.end
        const actual = projection.blocks.find(row => row.start === start && row.end === end)
        invariant(actual, 'SECTION_CLAIM_MAPPING_INVALID', '候选段落无法对应新稿 AST，未提交正文。')
        if (mapping.claimIds.length) {
          const anchorId = newId('anchor')
          ledger.claimAnchors[anchorId] = { id: anchorId, documentId: 'paper', documentHash: change.documentHash, blockId: actual.id,
            blockTextHash: digest(text.slice(start, end)), claimIds: mapping.claimIds, status: 'current' }
        }
      }
    }
    ledger.proposalStates[proposal.id] = { ...state, state: 'accepted', acceptedRevisionId: change.revisionId, updatedAt: now() }
    const nextRevision = await publishLedger(io, current, ledger, change.mutations)
    return { revisionId: change.revisionId, documentHash: change.documentHash, revision: nextRevision, alreadyApplied: false }
  })
}

export async function rejectProposal(io: FileStore, proposalId: string, revision: number) {
  return io.lock(async () => {
    const current = await writable(io), state = current.ledger.proposalStates[proposalId]
    invariant(state, 'PROPOSAL_NOT_FOUND', '建议不存在。')
    if (state.state === 'rejected') return { alreadyRejected: true }
    invariant(state.state === 'pending' && current.ledger.revision === revision, 'STALE_LEDGER_REVISION', '建议状态或项目数据已改变。')
    const ledger = structuredClone(current.ledger)
    ledger.proposalStates[proposalId] = { ...state, state: 'rejected', updatedAt: now() }
    const proposal = await readProposal(io, proposalId)
    if (proposal.reviewIssue && ledger.reviewIssues[proposal.reviewIssue.issueId]?.state === 'proposed-fix') {
      const others = await Promise.all(Object.values(ledger.proposalStates).filter(row => row.proposalId !== proposalId && row.state === 'pending').map(row => readProposal(io, row.proposalId)))
      if (!others.some(row => row.reviewIssue?.issueId === proposal.reviewIssue!.issueId) && !ledger.reviewIssues[proposal.reviewIssue.issueId].stale) {
        const file = await io.read(`.scholarflow/reviews/fixes/${proposalId}.json`)
        if (file) {
          const record = JSON.parse(file.text), original = record.originalIssue, restoreState = record.restoreState ?? original.state
          invariant(record.projectId === proposal.projectId && record.proposalId === proposalId && record.proposalHash === digest(json(proposal)) &&
            digest(json(original)) === proposal.reviewIssue.issueHash, 'ISSUE_FIX_CHANGED', '修复依据记录改变，未猜测原问题状态。')
          ledger.reviewIssues[proposal.reviewIssue.issueId].state = ['open', 'accepted-risk', 'dismissed'].includes(restoreState) ? restoreState : 'open'
        }
      }
    }
    return { revision: await publishLedger(io, current, ledger, []), alreadyRejected: false }
  })
}
export async function undoRevision(io: FileStore, revisionId: string, baseHash: string, revision: number) {
  id.parse(revisionId)
  return io.lock(async () => {
    const current = await writable(io)
    invariant(current.document.revisionId === revisionId && current.document.contentHash === baseHash && !current.document.externalChange,
      'STALE_DOCUMENT_VERSION', '后续已有改动，不能直接撤销覆盖。')
    invariant(current.ledger.revision === revision, 'STALE_LEDGER_REVISION', '项目数据已更新。')
    const previous = await io.read(`.scholarflow/drafts/${revisionId}/preimage.md`)
    invariant(previous, 'REVISION_NOT_FOUND', '此版本没有可撤销的旧稿快照。')
    const manifest = await io.read(`.scholarflow/drafts/${revisionId}/manifest.json`)
    invariant(manifest && JSON.parse(manifest.text).baseDocumentHash === digest(previous.text), 'REVISION_SNAPSHOT_CHANGED', '撤销旧稿快照被外部修改，禁止应用。')
    const ledger = structuredClone(current.ledger), change = await documentMutation(io, current, ledger, previous.text, `undo:${revisionId}`)
    return { revisionId: change.revisionId, documentHash: change.documentHash, revision: await publishLedger(io, current, ledger, change.mutations) }
  })
}
