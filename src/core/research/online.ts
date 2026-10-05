import { candidateSchema, searchInput, searchRecordSchema, lookupRecordSchema, doi, type ResearchProvider, type SourceCandidate } from '../../shared/online-research.ts'
import { id, sourceSchema, type Source } from '../../shared/schema.ts'
import { digest, newId, json, type FileStore, type FileImage } from '../store/files.ts'
import { snapshot, mutateLedger, invalidateReviews } from '../project/project.ts'
import { ScholarError, invariant } from '../../shared/errors.ts'
import { workflowAssociation, workflowCall } from '../pipeline/workflow-budget.ts'
import type { RunState } from '../../shared/runs.ts'

const searchPath = (searchId: string) => `.scholarflow/research/${id.parse(searchId)}.json`
export interface SearchPlan { id: string; projectId: string; configHash: string; ledgerRevision: number; search: ReturnType<typeof searchInput.parse>; contentHash: string; workflowId?: string }
export async function prepareSearch(io: FileStore, input: unknown): Promise<SearchPlan> {
  const current = await snapshot(io), search = searchInput.parse(input)
  invariant(current.config.workflow.budget.maxSearchQueries >= 1 && search.limit <= current.config.workflow.budget.maxCandidateSources,
    'RESEARCH_BUDGET_EXHAUSTED', '本项目检索预算不足，未发起外部请求。')
  invariant(!current.config.research.providerRefs.length || current.config.research.providerRefs.includes('crossref'), 'RESEARCH_PROVIDER_NOT_APPROVED', '项目未选择 Crossref 提供方。')
  const workflowId = await workflowAssociation(io)
  const plan = { id: newId('search'), projectId: current.ledger.projectId, configHash: current.configHash, ledgerRevision: current.ledger.revision, search, ...(workflowId && { workflowId }) }
  return { ...plan, contentHash: digest(json(plan)) }
}

export async function executeSearch(io: FileStore, plan: SearchPlan, provider: ResearchProvider, signal: AbortSignal, owner?: RunState['owner']) {
  invariant(provider.id === 'crossref' && provider.capabilities.search, 'RESEARCH_PROVIDER_UNAVAILABLE', '此提供方不能检索。')
  const { contentHash, ...input } = plan
  invariant(digest(json(input)) === contentHash, 'INVALID_APPROVAL', '检索计划发生改变。')
  signal.throwIfAborted()
  let record = searchRecordSchema.parse({ schemaVersion: 1, projectId: plan.projectId, id: plan.id, provider: 'crossref', search: plan.search,
    createdAt: new Date().toISOString(), state: 'running', queriesUsed: 1, records: [], warnings: [], decisions: {} })
  const path = searchPath(plan.id)
  const before = await io.lock(async () => {
    const current = await snapshot(io)
    invariant(current.ledger.projectId === plan.projectId && current.configHash === plan.configHash && current.ledger.revision === plan.ledgerRevision,
      'STALE_LEDGER_REVISION', '确认期间项目发生改变，请重新预览检索。')
    invariant(!await io.read(path), 'RESEARCH_ALREADY_STARTED', '此检索已经开始，不能重复发送。')
    return io.write(path, json(record), undefined)
  })
  // Never hold a project writer lock while waiting for the provider.
  try {
    const result = await workflowCall(io, plan.workflowId, { callId: plan.id, runId: plan.id, stage: 'research', kind: 'search', candidateLimit: plan.search.limit, owner }, signal,
      signal => provider.search(plan.search, signal), result => Math.min(plan.search.limit, result.records.length))
    signal.throwIfAborted()
    record = searchRecordSchema.parse({ ...record, state: 'completed', records: result.records.slice(0, plan.search.limit), warnings: result.warnings, completedAt: new Date().toISOString() })
  } catch (error) {
    const timeout = signal.aborted && signal.reason?.name === 'TimeoutError'
    const errorCode = timeout ? 'RESEARCH_TIMEOUT' : signal.aborted ? 'RESEARCH_CANCELLED' : error instanceof ScholarError ? error.code : 'RESEARCH_PROVIDER_FAILED'
    record = { ...record, state: signal.aborted && !timeout ? 'cancelled' : 'failed', errorCode, completedAt: new Date().toISOString(),
      warnings: ['本次未取得可纳入候选的完整结果；没有登记来源，没有自动重试。'] }
  }
  await io.lock(async () => {
    invariant((await snapshot(io)).ledger.projectId === plan.projectId, 'PROJECT_ID_CONFLICT', '检索项目身份已改变。')
    await io.write(path, json(searchRecordSchema.parse(record)), before)
  })
  return record
}

export async function readSearch(io: FileStore, searchId: string) {
  const current = await snapshot(io), file = await io.read(searchPath(searchId))
  invariant(file, 'RESEARCH_NOT_FOUND', '检索记录不存在。')
  const record = searchRecordSchema.parse(JSON.parse(file.text))
  invariant(record.projectId === current.ledger.projectId && record.id === searchId, 'PROJECT_ID_CONFLICT', '检索记录身份与当前项目不同。')
  return { record, file }
}
export async function listSearches(io: FileStore) {
  if (!await io.stat('.scholarflow/research')) return []
  const paths = (await io.list('.scholarflow/research')).filter(entry => entry.type === 'file' && /^search_[a-f0-9]+\.json$/u.test(entry.path.split('/').at(-1) ?? ''))
  invariant(paths.length <= 1000, 'RESEARCH_HISTORY_TOO_LARGE', '检索历史较大，请先指定检索记录。')
  const records = []
  for (const entry of paths) records.push((await readSearch(io, entry.path.split('/').at(-1)!.slice(0, -5))).record)
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(({ records, ...record }) => ({ ...record, candidateCount: records.length }))
}
export async function decideCandidate(io: FileStore, searchId: string, candidateId: string, decision: 'include' | 'exclude', reason: string, revision: number) {
  invariant(reason.trim().length > 0 && reason.length <= 2000, 'INVALID_REQUEST', '纳入或排除需要记录理由。')
  let sourceId: string | undefined
  const result = await mutateLedger(io, revision, async ledger => {
    const { record, file } = await readSearch(io, searchId)
    invariant(record.state === 'completed', 'RESEARCH_NOT_COMPLETED', '此检索没有完整候选结果。')
    const candidate = record.records.find(row => row.candidateId === candidateId)
    invariant(candidate, 'SOURCE_CANDIDATE_NOT_FOUND', '该检索没有此候选。')
    invariant(!record.decisions[candidateId], 'SOURCE_CANDIDATE_ALREADY_DECIDED', '此候选已处理；保留原决定和理由。')
    if (decision === 'include') {
      const previous = Object.values(ledger.sources).find(source => source.identifiers.doi?.toLowerCase() === candidate.recordId)
      if (previous) sourceId = previous.id // Preserve user metadata, evidence and stable citation key.
      else {
        sourceId = newId('src')
        const { candidateId: _id, provider, recordId, sourceUrl: _url, retrievedAt, warnings: _warnings, ...metadata } = candidateSchema.parse(candidate)
        ledger.sources[sourceId] = sourceSchema.parse({ ...metadata, id: sourceId, citeKey: `sf_${sourceId.slice(4, 16)}`, provenance: [{ provider, recordId, retrievedAt }],
          identity: { status: 'unverified', method: 'none', reason: '来源来自真实检索元数据，尚未进行独立 DOI 查询核验。' }, publicationState: 'unknown' })
      }
      invalidateReviews(ledger, ['citation', 'evidence'])
    }
    record.decisions[candidateId] = { decision, reason: reason.trim(), ...(sourceId && { sourceId }), decidedAt: new Date().toISOString() }
    return [{ path: searchPath(searchId), before: file, after: json(searchRecordSchema.parse(record)) }]
  })
  return { revision: result.revision, ...(sourceId && { source: result.ledger.sources[sourceId] }) }
}

const comparable = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
export function compareIdentity(source: Source, found: SourceCandidate | null): Source['identity'] {
  const checkedAt = new Date().toISOString()
  if (!found) return { status: 'unavailable', method: 'identifier-lookup', checkedAt, reason: 'Crossref 没有返回此 DOI 的记录；不据此断言来源伪造。' }
  const differs = []
  if (doi.parse(source.identifiers.doi) !== found.recordId) differs.push('DOI')
  if (comparable(source.title) !== comparable(found.title)) differs.push('标题')
  if (source.year && found.year && source.year !== found.year) differs.push('年份')
  if (source.authors.length && found.authors.length && !source.authors.every(author => found.authors.some(other => comparable(author.literal) === comparable(other.literal)))) differs.push('作者')
  return { status: differs.length ? 'mismatch' : 'matched', method: 'identifier-lookup', checkedAt,
    reason: differs.length ? `登记元数据与 DOI 查询在${differs.join('、')}上存在差异；原数据和证据保持不变。`
      : 'DOI 查询返回相同标识，已有标题及可比较作者、年份一致；该结果仅证明元数据身份匹配，不证明文本支持。' }
}
export async function applyIdentityLookup(io: FileStore, sourceId: string, expectedSourceHash: string, found: SourceCandidate | null, revision: number, failureCode?: string,
  attempt?: { path: string; before: FileImage; record: ReturnType<typeof lookupRecordSchema.parse> }) {
  if (found) found = candidateSchema.parse(found)
  return mutateLedger(io, revision, async ledger => {
    const source = ledger.sources[sourceId]
    invariant(source && digest(json(source)) === expectedSourceHash, 'STALE_SOURCE_VERSION', '核验期间来源记录发生改变，未覆盖原数据。')
    const identity = failureCode ? { status: 'unavailable' as const, method: 'identifier-lookup' as const, checkedAt: new Date().toISOString(),
      reason: `提供方核验请求未完成（${failureCode.slice(0, 100)}）；不据此断言来源不存在或伪造。` } : compareIdentity(source, found)
    ledger.sources[sourceId] = { ...source, identity, provenance: [...source.provenance, { provider: failureCode ? 'crossref-identifier-attempt' : 'crossref-identifier-lookup', retrievedAt: identity.checkedAt!, ...(found && { recordId: found.recordId }) }] }
    invalidateReviews(ledger, ['citation', 'integrity'])
    if (attempt) return [{ path: attempt.path, before: attempt.before, after: json(lookupRecordSchema.parse({ ...attempt.record, identity })) }]
    const path = `.scholarflow/research/identity_${newId('lookup')}.json`
    return [{ path, before: undefined, after: json({ schemaVersion: 1, projectId: ledger.projectId, sourceId, expectedSourceHash, identity, found, ...(failureCode && { failureCode }) }) }]
  })
}

export interface LookupPlan { id: string; projectId: string; configHash: string; ledgerRevision: number;
  sourceId: string; sourceHash: string; doi: string; contentHash: string; workflowId?: string }
export async function prepareLookup(io: FileStore, sourceId: string): Promise<LookupPlan> {
  const current = await snapshot(io), source = current.ledger.sources[sourceId]
  invariant(source?.identifiers.doi, 'SOURCE_IDENTIFIER_REQUIRED', '所选来源没有 DOI，不能进行 DOI 查询。')
  invariant(!current.config.research.providerRefs.length || current.config.research.providerRefs.includes('crossref'), 'RESEARCH_PROVIDER_NOT_APPROVED', '项目未选择 Crossref 提供方。')
  invariant(current.config.workflow.budget.maxSearchQueries > 0, 'RESEARCH_BUDGET_EXHAUSTED', '本项目在线查询预算为零。')
  const workflowId = await workflowAssociation(io)
  const plan = { id: newId('lookup'), projectId: current.ledger.projectId, configHash: current.configHash, ledgerRevision: current.ledger.revision, ...(workflowId && { workflowId }),
    sourceId: source.id, sourceHash: digest(json(source)), doi: doi.parse(source.identifiers.doi) }
  return { ...plan, contentHash: digest(json(plan)) }
}
export async function executeLookup(io: FileStore, plan: LookupPlan, provider: ResearchProvider, signal: AbortSignal, owner?: RunState['owner']) {
  const { contentHash, ...input } = plan
  invariant(digest(json(input)) === contentHash && provider.id === 'crossref' && provider.capabilities.lookupIdentifier,
    'INVALID_APPROVAL', 'DOI 查询计划或提供方能力无效。')
  signal.throwIfAborted()
  let record = lookupRecordSchema.parse({ schemaVersion: 1, projectId: plan.projectId, id: plan.id, sourceId: plan.sourceId,
    sourceHash: plan.sourceHash, doi: plan.doi, provider: 'crossref', createdAt: new Date().toISOString(), queriesUsed: 1, state: 'running' })
  const path = `.scholarflow/research/${plan.id}.json`
  const before = await io.lock(async () => {
    const current = await snapshot(io)
    invariant(current.ledger.projectId === plan.projectId && current.configHash === plan.configHash && current.ledger.revision === plan.ledgerRevision
      && digest(json(current.ledger.sources[plan.sourceId])) === plan.sourceHash, 'STALE_SOURCE_VERSION', '确认期间来源或配置改变，未发送请求。')
    invariant(!await io.read(path), 'RESEARCH_ALREADY_STARTED', '此 DOI 查询已开始，不能重复发送。')
    return io.write(path, json(record), undefined)
  })
  let found: SourceCandidate | null = null, failureCode: string | undefined
  try { found = await workflowCall(io, plan.workflowId, { callId: plan.id, runId: plan.id, stage: 'research', kind: 'lookup', owner }, signal,
    signal => provider.lookup(plan.doi, signal)); signal.throwIfAborted() }
  catch (error) { failureCode = signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'RESEARCH_TIMEOUT' : 'RESEARCH_CANCELLED'
    : (error as { code?: string }).code?.replace(/[^A-Z0-9_]/g, '').slice(0, 100) || 'RESEARCH_PROVIDER_FAILED' }
  record = lookupRecordSchema.parse({ ...record, found, completedAt: new Date().toISOString(),
    state: failureCode === 'RESEARCH_CANCELLED' ? 'cancelled' : failureCode ? 'failed' : 'completed', ...(failureCode && { errorCode: failureCode }) })
  if (failureCode === 'RESEARCH_CANCELLED' || failureCode?.startsWith('WORKFLOW_')) {
    await io.lock(async () => {
      invariant((await snapshot(io)).ledger.projectId === plan.projectId, 'PROJECT_ID_CONFLICT', '核验项目身份已改变。')
      await io.write(path, json(record), before)
    })
    return { attemptId: plan.id, errorCode: failureCode }
  }
  try {
    const result = await applyIdentityLookup(io, plan.sourceId, plan.sourceHash, found, plan.ledgerRevision, failureCode, { path, before, record })
    return { source: result.ledger.sources[plan.sourceId], revision: result.revision, attemptId: plan.id }
  } catch (error) {
    // Preserve the provider outcome when concurrent work prevents applying it.
    const code = error instanceof ScholarError ? error.code : 'RESEARCH_COMMIT_FAILED'
    record = { ...record, state: 'conflict', errorCode: code }
    await io.lock(async () => {
      invariant((await snapshot(io)).ledger.projectId === plan.projectId, 'PROJECT_ID_CONFLICT', '核验项目身份已改变。')
      await io.write(path, json(lookupRecordSchema.parse(record)), before)
    })
    return { attemptId: plan.id, errorCode: code }
  }
}
