import { registerSourceRequest } from '../../shared/research.ts'
import { doi } from '../../shared/online-research.ts'
import { invariant } from '../../shared/errors.ts'
import { snapshot } from '../project/project.ts'
import { digest, json, newId, type FileStore } from '../store/files.ts'
import { normalizeArxiv, sourceMatches } from './source-matching.ts'
import { registerSource } from '../evidence/evidence.ts'

export async function prepareSourceRegistration(io: FileStore, request: unknown) {
  const input = registerSourceRequest.parse(request), current = await snapshot(io)
  invariant(input.context.projectId === current.ledger.projectId && input.context.expectedLedgerRevision === current.ledger.revision,
    'STALE_LEDGER_REVISION', '来源预览需要当前项目版本。')
  if (input.source.identifiers.doi) input.source.identifiers.doi = doi.parse(input.source.identifiers.doi)
  if (input.source.identifiers.arxiv) input.source.identifiers.arxiv = normalizeArxiv(input.source.identifiers.arxiv)
  const matches = sourceMatches(input.source, current.ledger.sources)
  const body = { id: newId('sourceplan'), input, matches, configHash: current.configHash, ledgerHash: current.ledgerHash }
  return { ...body, contentHash: digest(json(body)) }
}
export type SourceRegistrationPlan = Awaited<ReturnType<typeof prepareSourceRegistration>>
export async function confirmSourceRegistration(io: FileStore, plan: SourceRegistrationPlan, reason: string, sourceSessionId: string) {
  const { contentHash, ...body } = plan
  invariant(digest(json(body)) === contentHash && sourceSessionId === plan.input.context.sessionId, 'INVALID_APPROVAL', '来源确认计划或会话不符。')
  const current = await snapshot(io)
  invariant(current.configHash === plan.configHash && current.ledgerHash === plan.ledgerHash, 'STALE_LEDGER_REVISION', '预览后项目来源或配置改变，请重新核对。')
  invariant(!plan.matches.length || reason.trim().length >= 1 && reason.length <= 4000, 'SOURCE_DUPLICATE_REVIEW_REQUIRED', '保留疑似重复的独立来源需要具体理由。')
  return registerSource(io, plan.input.source, plan.input.context.expectedLedgerRevision!, plan.matches.length ? { decision: 'keep-separate', reason,
    matches: plan.matches.map(({ sourceId, sourceHash }) => ({ sourceId, sourceHash })) } : undefined, sourceSessionId, { configHash: plan.configHash, ledgerHash: plan.ledgerHash })
}
