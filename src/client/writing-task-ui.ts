import { pendingQuestion, type WritingTask } from '../shared/writing-task.ts'

/** Historical questions remain on disk, but stopped tasks must not reopen them. */
export function activeWritingQuestion(task?: Pick<WritingTask, 'mode' | 'status' | 'questions'>, answered?: ReadonlySet<string>) {
  if (!task || task.mode === 'first-draft' || ['cancelled', 'completed', 'failed'].includes(task.status)) return undefined
  return task.questions?.find(row => pendingQuestion(row) && !answered?.has(row.id))
}
