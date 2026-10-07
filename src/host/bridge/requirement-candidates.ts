import type { OutlineCandidate, RequirementCandidate } from '../../shared/writing-task.ts'
import { ScholarError } from '../../shared/errors.ts'
import { ADOPTABLE_PATHS, basisMatches, type AdoptableGroup, type CandidateBasis } from '../../core/requirements/candidates.ts'

export type StoredCandidate = RequirementCandidate | OutlineCandidate

/**
 * Candidates are session-scoped and in memory (SPEC v1.2 §4.3). They are proposals about a
 * draft the user has not created yet, so writing them into a project directory would create
 * files before the user confirmed creation. What survives a reload is the adopted payload,
 * which lives in the wizard draft; a discarded or stale candidate should not survive at all.
 */
export class CandidateStore {
  private rows = new Map<string, StoredCandidate>()

  put(candidate: StoredCandidate) {
    this.prune()
    this.rows.set(candidate.candidateId, candidate)
    return candidate
  }

  get(candidateId: string, projectId: string, sessionId: string): StoredCandidate {
    const row = this.rows.get(candidateId)
    if (!row || row.projectId !== projectId || row.sessionId !== sessionId)
      throw new ScholarError('CANDIDATE_NOT_FOUND', '这个候选已经不存在，请重新生成。')
    return row
  }

  /**
   * A candidate built from inputs that have since changed cannot be adopted: applying it would
   * silently revert the user's newer edit (SPEC v1.2 §4.3).
   */
  live(candidate: StoredCandidate, current: Partial<CandidateBasis>) {
    if (candidate.state !== 'pending') throw new ScholarError('CANDIDATE_ALREADY_DECIDED', '这个候选已经处理过了。')
    if (basisMatches(candidate, current)) return candidate
    candidate.state = 'stale'
    this.rows.set(candidate.candidateId, candidate)
    throw new ScholarError('CANDIDATE_STALE', '要求或结构在生成候选之后改过，这个候选已经过期；请基于当前内容重新生成。')
  }

  decide(candidateId: string, projectId: string, sessionId: string, state: 'adopted' | 'discarded', current?: Partial<CandidateBasis>) {
    const row = this.get(candidateId, projectId, sessionId)
    if (current) this.live(row, current)
    else if (row.state !== 'pending' && !(state === 'discarded' && row.state === 'stale')) throw new ScholarError('CANDIDATE_ALREADY_DECIDED', '这个候选已经处理过了。')
    const next = { ...row, state, updatedAt: new Date().toISOString() } as StoredCandidate
    this.rows.set(candidateId, next)
    return next
  }

  list(projectId: string, sessionId: string) {
    return [...this.rows.values()].filter(row => row.projectId === projectId && row.sessionId === sessionId)
  }

  /** Newest first, bounded: an old stale candidate is history, not a menu entry. */
  private prune(limit = 12) {
    const rows = [...this.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const row of rows.slice(0, Math.max(0, rows.length - limit))) this.rows.delete(row.candidateId)
  }
}

/** A candidate's identity is its kind plus a fresh id, so the wizard can key on it directly. */
export function candidateKind(candidate: StoredCandidate) { return candidate.kind }

/** Groups a brief adoption request into the groups the user actually chose. */
export function adoptGroups(input: { groups?: string[]; all?: boolean }): AdoptableGroup[] {
  if (input.all || !input.groups?.length) return [...ADOPTABLE_PATHS]
  return ADOPTABLE_PATHS.filter(group => input.groups!.includes(group))
}
