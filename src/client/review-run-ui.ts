import type { RunState } from '../shared/runs.ts'

export function reviewRunFinished(status: RunState['status']) {
  return status === 'succeeded' || status === 'completed-with-issues'
}
