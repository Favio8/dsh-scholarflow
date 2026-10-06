import type { RequirementRead, RequirementReadMember, RequirementSource } from '../../shared/writing-task.ts'

/**
 * Requirement reading (SPEC v1.2 §4.1, §5). Pure functions only: the host supplies bytes and
 * model output, this module decides what counts as a member, what phase the operation is in,
 * and what a failure is allowed to say. A folder is never a member — its confirmed members are.
 */

export type MemberKind = RequirementReadMember['kind']
export const MEMBER_LIMIT = 200
export const MEMBER_TEXT_LIMIT = 12000
export const IMAGE_BYTES_LIMIT = 20 * 1024 * 1024
export const READ_BYTES_LIMIT = 50 * 1024 * 1024

/** Extension-only classification; the read result can still downgrade a member. */
export function memberKind(name: string): MemberKind {
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name)) return 'image'
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.(docx|md|markdown|txt|html?|rtf)$/i.test(name)) return 'text'
  return 'unsupported'
}

export type PlannedMember = { name: string; sourceId: string; kind: MemberKind; origin: RequirementSource['origin'] }

/**
 * What one 整理要求 action will read. Workspace sources contribute their own path or their
 * confirmed members; an external source contributes the members the picker listed. The order
 * follows the user's own ordering so the phase counter matches what they see.
 */
export function planRead(sources: RequirementSource[]): { members: PlannedMember[]; skipped: number } {
  const members: PlannedMember[] = []
  let skipped = 0
  const seen = new Set<string>()
  const push = (name: string, source: RequirementSource) => {
    const key = `${source.resourceId}:${name}`
    if (seen.has(key)) return
    if (members.filter(member => member.sourceId === source.resourceId).length >= MEMBER_LIMIT) { skipped++; return }
    seen.add(key)
    members.push({ name, sourceId: source.resourceId, kind: memberKind(name), origin: source.origin })
  }
  for (const source of sources) {
    if (source.origin === 'external') for (const member of source.members) push(member.name, source)
    else if (source.kind === 'folder') for (const member of source.members) push(member.name, source)
    else if (source.path) push(source.path, source)
  }
  return { members, skipped }
}

export function startRead(input: { readId: string; projectId: string; sessionId: string; members: PlannedMember[]; at: string }): RequirementRead {
  return { schemaVersion: 1, readId: input.readId, projectId: input.projectId, sessionId: input.sessionId,
    members: input.members.map(member => ({ name: member.name, sourceId: member.sourceId, kind: member.kind, state: 'pending' as const, bytes: 0 })),
    state: 'reading', phase: '', done: 0, total: input.members.length, skipped: 0,
    startedAt: input.at, updatedAt: input.at, elapsedMs: 0 }
}

function counted(read: RequirementRead) {
  const settled = read.members.filter(member => member.state === 'ready' || member.state === 'failed')
  return { done: settled.length, total: read.members.length }
}

/**
 * One counter over every member, in the user's own order, with the verb following the current
 * member's kind. Counting images and documents in separate pools would make the numbers jump
 * backwards for the reader, so the denominator is always the real number of members.
 */
export function phaseOf(read: RequirementRead): string {
  if (read.state === 'stopped') return '已停止'
  if (read.state === 'failed') return '读取失败'
  if (read.state === 'ready') return '整理已读要求'
  const index = read.members.findIndex(member => member.state === 'pending' || member.state === 'reading')
  if (index < 0) return '整理已读要求'
  const position = `${index + 1}/${read.members.length}`
  const member = read.members[index]
  if (member.kind === 'image') return `识别图片 ${position}`
  if (member.kind === 'unsupported') return `跳过 ${position}`
  return `读取第 ${position} 个文件`
}

/** Immutable single-member transition; every write keeps the counters and phase consistent. */
export function settleMember(read: RequirementRead, name: string, patch: Partial<RequirementReadMember>, at: string): RequirementRead {
  const members = read.members.map(member => member.name === name ? { ...member, ...patch } : member)
  const next: RequirementRead = { ...read, members, updatedAt: at }
  const counts = counted(next)
  next.done = counts.done
  next.total = counts.total
  if (next.state === 'reading') next.phase = phaseOf(next)
  return next
}

export function finishRead(read: RequirementRead, state: 'ready' | 'stopped' | 'failed', at: string, error?: string): RequirementRead {
  const next: RequirementRead = { ...read, state, updatedAt: at, ...(error ? { error } : {}) }
  const counts = counted(next)
  next.done = counts.done; next.total = counts.total
  next.phase = phaseOf(next)
  return next
}

/** True when nothing is left to read, so a resumed run continues instead of repeating work. */
export function pendingMembers(read: RequirementRead) {
  return read.members.filter(member => member.state === 'pending' || member.state === 'reading')
}

export function isUnread(read: RequirementRead, name: string) {
  const member = read.members.find(row => row.name === name)
  return !member || member.state !== 'ready'
}

/** The text the structuring stage may use: only what was actually read (SPEC v1.2 §5.1). */
export function usableText(read: RequirementRead) {
  return read.members.filter(member => member.state === 'ready' && member.text?.trim())
    .map(member => `【${member.name}】\n${member.text!.trim()}`).join('\n\n').slice(0, 60000)
}

/**
 * Failures have to be actionable (SPEC v1.2 §5.3). The four classes are decided here so no
 * raw exception text, class name or "please let the AI read it" wording can reach the UI.
 */
export type FailureClass = NonNullable<RequirementReadMember['noteKind']>
export type FailureNote = { noteKind: FailureClass; note: string }
export function failureNote(input: { kind: FailureClass; name: string; model?: string; reason?: string; pages?: { read: number; total: number }; candidates?: string[] }): FailureNote {
  const { kind, name, model, reason, pages, candidates } = input
  if (kind === 'capability') return { noteKind: 'capability',
    note: candidates?.length
      ? `当前模型${model ? `（${model}）` : ''}不接受图片输入。可以改用 ${candidates.slice(0, 3).join('、')} 识别，或把图里的要求粘贴成文字。`
      : `当前模型${model ? `（${model}）` : ''}不接受图片输入，本机也没有可用的图片识别模型。可以粘贴文字，或换成支持图片的模型后再读。` }
  if (kind === 'authorisation') return { noteKind: 'authorisation', note: '这个外部来源的读取授权已过期，需要重新选择文件夹；已经确认的要求文字不受影响。' }
  if (kind === 'format') return { noteKind: 'format', note: `${name} 的格式暂时不能直接读取。可以粘贴其中的要求文字，或换一个文件。` }
  const measured = pages && pages.total > 0 ? `（共 ${pages.total} 页，已读到 ${pages.read} 页）` : ''
  return { noteKind: 'read', note: `${name} 这次没有读到文字${measured}${reason ? `：${reason}` : '。'}可以重试、粘贴文字或换一个文件。` }
}

/** A source folder chosen over 200 members is reported, not silently truncated. */
export function truncationNote(skipped: number) {
  return skipped ? `这个来源的文件较多，只读取了前 ${MEMBER_LIMIT} 个；已跳过 ${skipped} 个。` : ''
}
