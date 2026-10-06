import type { RequirementRead, RequirementReadMember, RequirementSource } from '../../shared/writing-task.ts'
import { finishRead, failureNote, planRead, settleMember, startRead, pendingMembers } from '../../core/requirements/reading.ts'
import { mediaType } from '../../core/materials/materials.ts'
import { ScholarError } from '../../shared/errors.ts'

/**
 * Reads one requirement source set (SPEC v1.2 §5). The operation is long, so it is a job: it
 * returns an id immediately, reports real per-member progress while it runs, and a stop ends
 * it without letting a late answer reach a field.
 */

export type ReadServices = {
  /** Bytes for one workspace member. */
  readWorkspace(path: string, signal: AbortSignal): Promise<Uint8Array>
  /** Bytes for one external member, under the grant the operator approved. */
  readExternal(source: RequirementSource, name: string, signal: AbortSignal): Promise<Uint8Array>
  /** Requirement documents become plain text; a scanned page reports what it did read. */
  parseText(bytes: Uint8Array, mediaType: string, signal: AbortSignal): Promise<{ text: string; pages: { read: number; total: number } }>
  /** Images are transcribed through the host's image channel. */
  transcribeImage(input: { bytes: Uint8Array; mediaType: string; name: string; signal: AbortSignal }): Promise<{ text: string; model: string }>
  /** Which model would transcribe images, and which ones the host offers as alternatives. */
  recognition(): Promise<{ model?: string; imageInput: true | false | null; candidates: { id: string; name: string }[] }>
}

export type ReadRun = { readId: string; projectId: string; sessionId: string; sources: RequirementSource[]
  services: ReadServices; signal: AbortSignal; onUpdate?: (read: RequirementRead) => void; now?: () => number
  /** A single member may not hold the whole job forever (SF-048/SF-057). */
  memberTimeoutMs?: number }

/**
 * Runs one read to completion. An individual failure never aborts the batch: the point is to
 * keep every member that *was* read and say precisely what happened to the others.
 */
export async function runRead(input: ReadRun): Promise<RequirementRead> {
  const clock = input.now ?? (() => Date.now())
  const started = clock()
  const plan = planRead(input.sources)
  const iso = () => new Date(clock()).toISOString()
  let read: RequirementRead = { ...startRead({ readId: input.readId, projectId: input.projectId, sessionId: input.sessionId,
    members: plan.members, at: iso() }), skipped: plan.skipped }
  const sourceOf = (member: { sourceId: string }) => input.sources.find(source => source.resourceId === member.sourceId)!
  const stop = () => finishRead({ ...read, elapsedMs: clock() - started }, 'stopped', iso())

  for (const member of read.members) {
    if (input.signal.aborted) return stop()
    read = settleMember(read, member.name, { state: 'reading' }, iso())
    input.onUpdate?.(read)
    try {
      // One member gets its own bound: a provider that never answers, or a file the host
      // cannot hand over, must become a reported failure instead of silently stopping the
      // whole read. The bound is on the read, not on how many calls it took.
      const bounded = input.memberTimeoutMs
        ? AbortSignal.any([input.signal, AbortSignal.timeout(input.memberTimeoutMs)]) : input.signal
      read = settleMember(read, member.name, await readOneMember(member, sourceOf(member), input.services, bounded), iso())
    } catch (error) {
      if (input.signal.aborted) return stop()
      const timedOut = (error as Error)?.name === 'TimeoutError'
      read = settleMember(read, member.name, timedOut
        ? { ...failureNote({ kind: 'read', name: member.name,
            reason: `这一步超过 ${Math.round((input.memberTimeoutMs ?? 0) / 1000)} 秒没有响应` }) }
        : failureFor(member, error), iso())
    }
    read.elapsedMs = clock() - started
    input.onUpdate?.(read)
  }
  return finishRead({ ...read, elapsedMs: clock() - started }, 'ready', iso())
}

export async function readOneMember(member: RequirementReadMember, source: RequirementSource, services: ReadServices, signal: AbortSignal) {
  if (member.kind === 'unsupported') return { state: 'failed' as const, ...failureNote({ kind: 'format', name: member.name }) }
  const bytes = source.origin === 'workspace'
    ? await services.readWorkspace(member.name, signal)
    : await services.readExternal(source, member.name, signal)
  if (member.kind === 'image') {
    const capability = await services.recognition()
    // Sending an image to a text-only model silently degrades it in the host, so this is the
    // one place the plugin must refuse before spending anything (SPEC v1.2 §5.2).
    if (capability.imageInput !== true && !capability.candidates.length) {
      return { state: 'failed' as const, bytes: bytes.length,
        ...failureNote({ kind: 'capability', name: member.name, model: capability.model }) }
    }
    const result = await services.transcribeImage({ bytes, mediaType: mediaType(member.name), name: member.name, signal })
    if (!result.text.trim()) return { state: 'failed' as const, bytes: bytes.length, ...failureNote({ kind: 'read', name: member.name }) }
    return { state: 'ready' as const, text: result.text.slice(0, 12000), bytes: bytes.length }
  }
  const parsed = await services.parseText(bytes, mediaType(member.name), signal)
  const text = parsed.text.trim()
  if (!text) return { state: 'failed' as const, bytes: bytes.length,
    ...failureNote({ kind: 'read', name: member.name, pages: { read: 0, total: parsed.pages.total } }) }
  return { state: 'ready' as const, text: text.slice(0, 12000), bytes: bytes.length, ...(parsed.pages.total > 0 && { locator: { page: 1 } }) }
}

/** A failure keeps the class the caller already knows; anything else is a read failure. */
export function failureFor(member: RequirementReadMember, error: unknown) {
  const message = (error as Error)?.message ?? ''
  if (/EXTERNAL_SOURCE_RECONNECT|授权/.test(message)) return failureNote({ kind: 'authorisation', name: member.name })
  if (/MODEL|IMAGE_INPUT|模型/.test(message)) return failureNote({ kind: 'capability', name: member.name })
  if (/PARSE_TIMEOUT|MATERIAL_PARSE_FAILED|解析/.test(message))
    return failureNote({ kind: 'read', name: member.name, reason: '文件太大或格式复杂，解析没有完成' })
  return failureNote({ kind: 'read', name: member.name, reason: userFacing(message) })
}

/** Keeps a raw error string out of the sentence a person reads (SPEC v1.2 §5.3). */
function userFacing(message: string) {
  const cleaned = message.replace(/^[A-Z_]{3,}:\s*/, '').trim()
  if (!cleaned || /Error|ENOENT|at Object|\bat\s|\/src\/|node:/.test(cleaned)) return ''
  return cleaned.length > 120 ? cleaned.slice(0, 120) + '…' : cleaned
}

/** What the wizard polls while a read is running. */
export function readSummary(read: RequirementRead) {
  return { readId: read.readId, state: read.state, phase: read.phase, done: read.done, total: read.total,
    elapsedMs: read.elapsedMs, skipped: read.skipped, model: read.model, recognitionModel: read.recognitionModel,
    members: read.members.map(member => ({ name: member.name, kind: member.kind, state: member.state,
      note: member.note, noteKind: member.noteKind, chars: member.text?.length ?? 0 })),
    pending: pendingMembers(read).map(member => member.name) }
}

type Job = { controller: AbortController; promise: Promise<RequirementRead>; read?: RequirementRead; owner: string; session: string }

/**
 * Reads are session-scoped by design: nothing is written into a project before the user has
 * confirmed creation. Adopted text lives in the wizard draft, so a reload keeps what the user
 * accepted while an unfinished read simply starts again.
 */
export class ReadingJobs {
  private jobs = new Map<string, Job>()
  constructor(private limit = 8) {}

  start(input: { readId: string; owner: string; session: string; run: (signal: AbortSignal, onUpdate: (read: RequirementRead) => void) => Promise<RequirementRead> }) {
    this.prune()
    const controller = new AbortController()
    const job: Job = { controller, promise: undefined as unknown as Promise<RequirementRead>, owner: input.owner, session: input.session }
    this.jobs.set(input.readId, job)
    job.promise = input.run(controller.signal, read => { job.read = read })
    job.promise.catch(() => undefined)
    return { readId: input.readId }
  }

  /** Awaiting a finished job is how a caller turns a poll into a settled read. */
  async result(readId: string, owner: string) {
    const job = this.get(readId, owner)
    return job.read ?? await job.promise.catch(() => job.read)
  }

  get(readId: string, owner: string) {
    const job = this.jobs.get(readId)
    if (!job || job.owner !== owner) throw new ScholarError('READ_NOT_FOUND', '这次读取已经结束，请重新整理要求。')
    return job
  }

  peek(readId: string, owner: string) {
    const job = this.jobs.get(readId)
    return job && job.owner === owner ? job.read : undefined
  }

  /** A per-member retry advances the live snapshot without starting a second job. */
  replace(readId: string, owner: string, read: RequirementRead) {
    const job = this.get(readId, owner)
    job.read = read
    return job.read
  }

  stop(readId: string, owner: string) {
    const job = this.get(readId, owner)
    job.controller.abort('cancelled')
    return job.read
  }

  clear() { for (const job of this.jobs.values()) job.controller.abort('plugin-unload'); this.jobs.clear() }

  /** Only the most recent reads are kept; older ones are finished and already reflected in the draft. */
  private prune() {
    if (this.jobs.size < this.limit) return
    for (const [readId, job] of [...this.jobs]) {
      if (this.jobs.size < this.limit) break
      if (job.controller.signal.aborted) this.jobs.delete(readId)
    }
  }
}
