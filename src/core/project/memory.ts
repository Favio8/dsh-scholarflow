import { z } from 'zod'
import { hash, id } from '../../shared/schema.ts'
import { digest, type FileStore } from '../store/files.ts'
import { invariant } from '../../shared/errors.ts'

export const MEMORY_APPROVALS = '.scholarflow/context/approvals.json'
export const memoryNames = ['decisions', 'terminology', 'writing-memory'] as const
export const memoryApprovalsSchema = z.object({ schemaVersion: z.literal(1), projectId: id,
  entries: z.record(z.string(), z.object({ contentHash: hash, source: z.enum(['initialization', 'user']), sourceSessionId: id.optional(), confirmedAt: z.string() }).strict()) }).strict()
export async function approvedMemory(io: FileStore, projectId: string) {
  const file = await io.read(MEMORY_APPROVALS), approvals = file ? memoryApprovalsSchema.parse(JSON.parse(file.text)) : undefined
  invariant(!approvals || approvals.projectId === projectId, 'PROJECT_ID_CONFLICT', '确认记忆记录不属于当前项目。')
  const memory: Record<string, string> = {}
  for (const name of memoryNames) {
    const path = `.scholarflow/context/${name}.md`, entry = await io.read(path)
    invariant(entry && Buffer.byteLength(entry.text) <= 65536, 'MEMORY_UNAVAILABLE', '项目记忆文件缺失或超过限额。')
    const emptyLegacy = entry.text === ({ decisions: '# 已确认决定\n', terminology: '# 已确认术语\n', 'writing-memory': '# 已确认写作记忆\n' })[name]
    invariant(approvals?.entries[path]?.contentHash === digest(entry.text) || (!approvals && emptyLegacy), 'MEMORY_CONFIRMATION_REQUIRED',
      '项目记忆被外部编辑或尚未确认。请在概览查看后明确确认纳入上下文；未自动使用这些内容。')
    memory[name] = entry.text
  }
  return memory
}
