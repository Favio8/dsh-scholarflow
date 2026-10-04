import { z } from 'zod'
import { sourceSchema, evidenceSchema, claimSchema, outlineSchema, type Claim, type Evidence } from '../../shared/schema.ts'
import { proposalSchema } from '../../shared/editing.ts'
import { sourceInput, confirmEvidenceRequest, upsertClaimRequest } from '../../shared/research.ts'
import { newId, digest, json, type FileStore } from '../store/files.ts'
import { mutateLedger, invalidateReviews } from '../project/project.ts'
import { readParsed, MAX_MATERIAL_BYTES } from '../materials/materials.ts'
import { invariant } from '../../shared/errors.ts'

export async function registerSource(io: FileStore, input: z.infer<typeof sourceInput>, revision: number) {
  input = sourceInput.parse(input)
  const sourceId = newId('src')
  const result = await mutateLedger(io, revision, async ledger => {
    const material = input.materialId ? ledger.materials[input.materialId] : undefined
    invariant(!input.materialId || material?.contentHash, 'MATERIAL_NOT_PARSED', '请先解析关联的本地资料。')
    if (material) await readParsed(io, material.id)
    const doi = input.identifiers.doi?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()
    invariant(!doi || /^10\.\d{4,9}\/\S+$/.test(doi), 'SOURCE_IDENTIFIER_INVALID', 'DOI 格式无效。')
    invariant(!Object.values(ledger.sources).some(source => (doi && source.identifiers.doi?.toLowerCase() === doi) ||
      (material && source.materialId === material.id)), 'SOURCE_ALREADY_REGISTERED', '该 DOI 或资料已有来源记录，请沿用稳定引用标识。')
    ledger.sources[sourceId] = sourceSchema.parse({ ...input, id: sourceId, identifiers: { ...input.identifiers, ...(doi && { doi }) },
      citeKey: `sf_${sourceId.slice(4, 16)}`, provenance: [{ provider: material ? 'local-material' : 'user-metadata', retrievedAt: new Date().toISOString() }],
      identity: { status: 'unverified', method: 'none', reason: '已登记用户元数据，尚未独立核验出版身份。' },
      textAccess: material ? 'fulltext' : 'metadata', ...(material?.contentHash && { contentHash: material.contentHash }), publicationState: 'unknown' })
    if (material && material.parseStatus !== 'ready') ledger.sources[sourceId].textAccess = 'excerpt'
    invalidateReviews(ledger, ['citation', 'evidence'])
  })
  return { source: result.ledger.sources[sourceId], revision: result.revision }
}

export async function confirmEvidence(io: FileStore, input: Omit<z.infer<typeof confirmEvidenceRequest>, 'context'>, revision: number) {
  const evidenceId = newId('ev')
  const result = await mutateLedger(io, revision, async ledger => {
    const source = ledger.sources[input.sourceId]
    invariant(source?.materialId && source.contentHash === input.sourceContentHash, 'EVIDENCE_NEEDS_FULLTEXT', '元数据不能证明正文论点；请选择有真实定位的资料文本。')
    const parsed = await readParsed(io, source.materialId)
    invariant(parsed.sourceContentHash === input.sourceContentHash, 'STALE_MATERIAL_VERSION', '资料版本不同，请重新定位摘录。')
    const block = parsed.blocks.find(block => JSON.stringify(block.locator) === JSON.stringify(input.locator))
    invariant(block && block.text.includes(input.excerpt), 'EVIDENCE_NOT_LOCATED', '摘录不在指定位置的真实解析文本中，禁止作为已定位证据。')
    invariant(digest(await io.readBytes(ledger.materials[source.materialId].projectRelativePath, MAX_MATERIAL_BYTES)) === input.sourceContentHash,
      'STALE_MATERIAL_VERSION', '确认前资料发生外部修改。')
    ledger.evidence[evidenceId] = evidenceSchema.parse({ ...input, id: evidenceId, acquisition: 'user-confirmed', validation: 'located' })
    invalidateReviews(ledger, ['evidence', 'integrity'])
  })
  return { evidence: result.ledger.evidence[evidenceId], revision: result.revision }
}

export function claimStatus(claim: Pick<Claim, 'kind' | 'scope' | 'evidenceLinks'>, evidence: Record<string, Evidence>): Claim['status'] {
  const links = claim.evidenceLinks
  if (links.some(link => evidence[link.evidenceId]?.validation === 'stale')) return 'stale'
  const located = links.filter(link => evidence[link.evidenceId]?.validation === 'located')
  if (located.some(link => link.relation === 'contradicts')) return 'disputed'
  // Support scope is a human/model judgment; merely selecting a quotation never
  // upgrades an external claim to verified factual support.
  if (located.some(link => link.relation === 'supports')) return 'supported'
  if (located.some(link => link.relation === 'partial')) return 'partially-supported'
  return 'unsupported'
}

export async function upsertClaim(io: FileStore, input: z.infer<typeof upsertClaimRequest>['claim'], revision: number) {
  const claimId = input.id ?? newId('cl')
  const result = await mutateLedger(io, revision, ledger => {
    invariant(!input.id || ledger.claims[input.id], 'CLAIM_NOT_FOUND', '要修改的论点不存在。')
    for (const link of input.evidenceLinks) {
      invariant(ledger.evidence[link.evidenceId], 'EVIDENCE_NOT_FOUND', '论点引用了不存在的证据。')
      invariant(!['supports', 'partial', 'contradicts'].includes(link.relation) || !!link.rationale?.trim(), 'CLAIM_SCOPE_REQUIRED', '请说明证据支持范围或相反结果的关系，不能仅靠引用数量判定支持。')
      invariant(ledger.evidence[link.evidenceId].validation === 'located', 'EVIDENCE_NOT_CURRENT', '过期或未定位证据不能建立当前支持关系。')
    }
    ledger.claims[claimId] = claimSchema.parse({ ...input, id: claimId, status: claimStatus(input, ledger.evidence), reviewedBy: 'user' })
    ledger.outline.confirmation = 'draft'
    invalidateReviews(ledger, ['evidence', 'logic', 'integrity'])
  })
  return { claim: result.ledger.claims[claimId], revision: result.revision }
}

export function outlineProjection(outline: z.infer<typeof outlineSchema>) {
  const lines = [`# ${outline.title}`, '', `版本：${outline.version} · ${outline.confirmation}`, '', `研究问题：${outline.researchQuestion}`, '', `中心论点：${outline.thesis}`, '']
  const visit = (parentId?: string, depth = 2) => {
    for (const section of outline.sections.filter(row => row.parentId === parentId)) {
      lines.push(`${'#'.repeat(Math.min(6, depth))} ${section.title}`, '', section.purpose, '', `论点：${section.claimIds.join('、') || '无'}`,
        ...(section.targetLength ? [`目标篇幅：${section.targetLength.value} ${section.targetLength.unit}`] : []),
        ...section.missingEvidence.map(gap => `- 缺口：${gap}`), '')
      visit(section.id, depth + 1)
    }
  }
  visit(); return lines.join('\n') + '\n'
}

export async function saveOutline(io: FileStore, input: z.infer<typeof outlineSchema>, revision: number, outlineVersion: number, confirmation: 'draft' | 'confirmed') {
  input = outlineSchema.parse(input)
  invariant(input.sections.length <= 200 && Buffer.byteLength(json(input)) <= 1024 * 1024, 'OUTLINE_TOO_LARGE', '大纲超过当前编辑范围。')
  const result = await mutateLedger(io, revision, async ledger => {
    invariant(ledger.outline.version === outlineVersion && input.version === outlineVersion, 'STALE_OUTLINE_VERSION', '大纲已改变，请重新确认。')
    invariant(new Set(input.sections.map(section => section.id)).size === input.sections.length, 'OUTLINE_INVALID', '大纲章节标识重复。')
    for (const section of input.sections) {
      invariant(!section.parentId || input.sections.some(parent => parent.id === section.parentId && parent.id !== section.id), 'OUTLINE_INVALID', '大纲父章节不存在。')
      const ancestors = new Set([section.id]); let current = section
      while (current.parentId) { invariant(!ancestors.has(current.parentId), 'OUTLINE_INVALID', '大纲父章节形成循环。'); ancestors.add(current.parentId); current = input.sections.find(parent => parent.id === current.parentId)! }
      invariant(ancestors.size <= 5 && new Set(section.claimIds).size === section.claimIds.length, 'OUTLINE_INVALID', '章节最多五层，关联论点不得重复。')
      for (const claimId of section.claimIds) invariant(ledger.claims[claimId], 'CLAIM_NOT_FOUND', '大纲包含不存在的论点。')
    }
    invariant(confirmation !== 'confirmed' || input.researchQuestion.trim() && input.thesis.trim() && input.sections.length,
      'OUTLINE_CONFIRMATION_REQUIRED', '确认大纲需要研究问题、中心论点及至少一个章节；未完成结构可以先保存草稿。')
    const previous = structuredClone(ledger.outline), projection = await io.read('.scholarflow/planning/outline.md'), projectionManifest = await io.read('.scholarflow/planning/outline-projection.json')
    const projectionMetadata = projectionManifest && z.object({ schemaVersion: z.literal(1), projectId: z.string(), version: z.number().int().min(0),
      hash: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict().parse(JSON.parse(projectionManifest.text))
    invariant(projectionMetadata ? projection && projectionMetadata.projectId === ledger.projectId && projectionMetadata.version === previous.version &&
      digest(projection.text) === projectionMetadata.hash : !projection || projection.text === outlineProjection(previous),
      'OUTLINE_PROJECTION_CHANGED', '大纲可读投影被外部编辑；保留该文件，请先按 ledger 大纲核对，不会自动覆盖。')
    ledger.outline = { ...input, version: outlineVersion + 1, confirmation }
    for (const state of Object.values(ledger.proposalStates).filter(row => row.state === 'pending')) {
      const file = await io.read(`.scholarflow/proposals/${state.proposalId}.json`)
      invariant(file, 'PROPOSAL_NOT_FOUND', '待审阅建议文件缺失，先检查项目。')
      const proposal = proposalSchema.parse(JSON.parse(file.text))
      invariant(proposal.projectId === ledger.projectId, 'PROJECT_ID_CONFLICT', '待审阅建议身份不属于项目。')
      if (proposal.scope !== 'selection') { state.state = 'stale'; state.updatedAt = new Date().toISOString() }
    }
    invalidateReviews(ledger, ['structure', 'logic'])
    return [{ path: `.scholarflow/planning/outline-history/${newId('outline')}.json`, before: undefined,
      after: json({ schemaVersion: 1, projectId: ledger.projectId, previous, outline: ledger.outline, savedAt: new Date().toISOString() }) },
      { path: '.scholarflow/planning/outline.md', before: projection, after: outlineProjection(ledger.outline) },
      { path: '.scholarflow/planning/outline-projection.json', before: projectionManifest,
        after: json({ schemaVersion: 1, projectId: ledger.projectId, version: ledger.outline.version, hash: digest(outlineProjection(ledger.outline)) }) }]
  })
  return { outline: result.ledger.outline, revision: result.revision }
}
export async function confirmOutline(io: FileStore, input: z.infer<typeof outlineSchema>, revision: number, outlineVersion: number) {
  return saveOutline(io, input, revision, outlineVersion, 'confirmed')
}
