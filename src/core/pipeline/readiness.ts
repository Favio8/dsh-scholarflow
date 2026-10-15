import type { ReviewReport } from '../../shared/review.ts'

export type ReadinessState = 'needs-check' | 'needs-adoption' | 'needs-materials' | 'needs-verification' | 'ready' | 'research-incomplete'
export type ReadinessInput = {
  goal: 'course-delivery' | 'research-results'
  documentHash: string
  revisionId: string
  placeholder: boolean
  dirty?: boolean
  report?: ReviewReport
  reviewStale: boolean
  requiredCheckIds: string[]
  advisoryCheckIds: string[]
  missingMaterials: string[]
  pendingCandidate?: boolean
  adoptionDecided: boolean
  delivery?: { documentHash: string; revisionId: string; valid: boolean }
  requiredFormatChecks: Array<{ id: string; status: 'pass' | 'fail' | 'unknown'; detail: string }>
}

/** Computed from current evidence. Run completion and model prose are deliberately absent. */
export function deliveryReadiness(input: ReadinessInput): { state: ReadinessState; reasons: string[] } {
  if (input.pendingCandidate) return { state: 'needs-adoption', reasons: ['当前候选尚未采用；主稿保持原样。'] }
  if (input.missingMaterials.length) return { state: input.goal === 'research-results' && !input.placeholder ? 'research-incomplete' : 'needs-materials', reasons: input.missingMaterials }
  const report = input.report
  if (!report || input.placeholder || input.dirty || input.reviewStale || report.documentHash !== input.documentHash || report.revisionId !== input.revisionId)
    return { state: 'needs-check', reasons: ['需要针对实际已保存版本执行检查。'] }
  const checks = new Map(report.checks.map(check => [check.id, check]))
  const missing = input.requiredCheckIds.filter(id => !checks.has(id) || checks.get(id)!.method === 'model-assisted' && !report.modelRunId && !report.manualAssessmentId)
  if (missing.length) return { state: 'needs-check', reasons: missing.map(id => `尚未执行必需检查：${id}`) }
  const blockers = report.issues.filter(issue => issue.severity === 'B0' && !issue.stale && issue.state !== 'resolved')
  const unresolved = input.requiredCheckIds.filter(id => checks.get(id)?.status !== 'pass')
  const unclassified = report.checks.filter(check => check.status !== 'pass' && !input.requiredCheckIds.includes(check.id) && !input.advisoryCheckIds.includes(check.id))
  const formats = input.requiredFormatChecks.filter(check => check.status !== 'pass')
  const reasons = [...blockers.map(issue => issue.title), ...unresolved.map(id => checks.get(id)!.detail), ...unclassified.map(check => check.detail), ...formats.map(check => check.detail)]
  if (!input.requiredCheckIds.length) reasons.push('任务尚未冻结必需检查范围。')
  if (!input.adoptionDecided) reasons.push('最终审阅决定尚未保存。')
  if (!input.delivery?.valid || input.delivery.documentHash !== input.documentHash || input.delivery.revisionId !== input.revisionId) reasons.push('尚无与当前已保存稿一致的交付文件。')
  return reasons.length ? { state: 'needs-verification', reasons: [...new Set(reasons)] } : { state: 'ready', reasons: [] }
}
