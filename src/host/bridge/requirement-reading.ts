import type { RequirementRead, RequirementReadMember, RequirementSource } from '../../shared/writing-task.ts'
import { finishRead, failureNote, planRead, settleMember, startRead, pendingMembers } from '../../core/requirements/reading.ts'
import { mediaType } from '../../core/materials/materials.ts'
import { ScholarError } from '../../shared/errors.ts'
import { appendFile } from 'node:fs/promises'

/**
 * Stage trace, off unless SCHOLARFLOW_TRACE names a file. A read that stops inside the host
 * leaves no other mark — no model request is logged and the phase never changes — so the only
 * way to tell which stage it stopped in is to write one line per stage and see which line is
 * missing. Not a log for users: nothing is written unless the variable is set.
 */
export function trace(stage: string, detail: Record<string, unknown> = {}) {
  const target = process.env.SCHOLARFLOW_TRACE
  if (!target) return
  void appendFile(target, `[${new Date().toISOString()}] ${stage} ${JSON.stringify(detail).slice(0, 300)}${String.fromCharCode(10)}`)
    .catch(() => undefined)
}

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

  trace('read:start', { readId: input.readId, members: read.members.length })
  for (const member of read.members) {
    if (input.signal.aborted) return stop()
    trace('read:member:begin', { name: member.name })
    read = settleMember(read, member.name, { state: 'reading' }, iso())
    input.onUpdate?.(read)
    try {
      // One member gets its own bound. It has to be a race, not only an abort signal: the
      // bound must hold even when the step inside does not observe cancellation (a host call
      // that never settles), otherwise one member can stop the whole job forever and the UI
      // is left showing a phase that will never change.
      read = settleMember(read, member.name, await withBound(
        signal => readOneMember(member, sourceOf(member), input.services, signal),
        input.signal, input.memberTimeoutMs), iso())
      trace('read:member:settled', { name: member.name, state: read.members.find(row => row.name === member.name)?.state })
    } catch (error) {
      if (input.signal.aborted) return stop()
      trace('read:member:failed', { name: member.name, error: (error as Error)?.message?.slice(0, 200) })
      const timedOut = (error as Error)?.name === 'TimeoutError'
      read = settleMember(read, member.name, timedOut
        ? { state: 'failed', ...failureNote({ kind: 'read', name: member.name,
            reason: `这一步超过 ${Math.round((input.memberTimeoutMs ?? 0) / 1000)} 秒没有响应` }) }
        : { state: 'failed', ...failureFor(member, error) }, iso())
    }
    read.elapsedMs = clock() - started
    input.onUpdate?.(read)
  }
  trace('read:finished', { readId: input.readId })
  return finishRead({ ...read, elapsedMs: clock() - started }, 'ready', iso())
}

export /**
 * Runs one bounded step. The inner controller is aborted on timeout so a cooperating
 * operation stops too, and the race settles regardless, so a step that ignores cancellation
 * still cannot hold the job.
 */
async function withBound<T>(run: (signal: AbortSignal) => Promise<T>, outer: AbortSignal, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return run(outer)
  const controller = new AbortController()
  const signal = AbortSignal.any([outer, controller.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort('member-timeout')
      reject(Object.assign(new Error('member timed out'), { name: 'TimeoutError' }))
    }, timeoutMs)
  })
  try { return await Promise.race([run(signal), guard]) }
  finally { clearTimeout(timer) }
}

export async function readOneMember(member: RequirementReadMember, source: RequirementSource, services: ReadServices, signal: AbortSignal) {
  trace('member:enter', { name: member.name, kind: member.kind, origin: source.origin })
  if (member.kind === 'unsupported') return { state: 'failed' as const, ...failureNote({ kind: 'format', name: member.name }) }
  trace('member:bytes:start', { name: member.name })
  const bytes = source.origin === 'workspace'
    ? await services.readWorkspace(member.name, signal)
    : await services.readExternal(source, member.name, signal)
  trace('member:bytes:done', { name: member.name, bytes: bytes.length })
  if (member.kind === 'image') {
    trace('member:recognition:start', { name: member.name })
    const capability = await services.recognition()
    trace('member:recognition:done', { name: member.name, imageInput: capability.imageInput, candidates: capability.candidates.length })
    // Sending an image to a text-only model silently degrades it in the host, so this is the
    // one place the plugin must refuse before spending anything (SPEC v1.2 §5.2).
    if (capability.imageInput !== true && !capability.candidates.length) {
      return { state: 'failed' as const, bytes: bytes.length,
        ...failureNote({ kind: 'capability', name: member.name, model: capability.model }) }
    }
    trace('member:transcribe:start', { name: member.name })
    const result = await services.transcribeImage({ bytes, mediaType: mediaType(member.name), name: member.name, signal })
    trace('member:transcribe:done', { name: member.name, chars: result.text.length, model: result.model })
    if (!result.text.trim()) return { state: 'failed' as const, bytes: bytes.length, ...failureNote({ kind: 'read', name: member.name }) }
    return { state: 'ready' as const, text: result.text.slice(0, 12000), bytes: bytes.length }
  }
  trace('member:parse:start', { name: member.name })
  const parsed = await services.parseText(bytes, mediaType(member.name), signal)
  trace('member:parse:done', { name: member.name, chars: parsed.text.length })
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

/**
 * True for text that came from a runtime rather than from a sentence written for the reader.
 * Kept as its own predicate so the same judgement is reused instead of re-spelled.
 */
function looksLikeRuntime(text: string) {
  return /cannot get|without inject|is not a function|undefined is not|at\s+\w|\/src\/|node:|ECONN|ETIMEDOUT|fetch failed|status\s*\d{3}/i.test(text)
}

/** Keeps a raw error string out of the sentence a person reads (SPEC v1.2 §5.3). */
function userFacing(message: string) {
  const cleaned = message.replace(/^[A-Z_]{3,}:\s*/, '').trim()
  if (!cleaned) return ''
  // A runtime complaint is withheld, not shown: "cannot get property … without inject"
  // is not something the reader can act on, and it is not this product's words.
  if (looksLikeRuntime(cleaned)) return ''
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
  private limit: number
  // Written out rather than a parameter property: the test runner loads this module with
  // type stripping, which does not support that syntax.
  constructor(limit = 8) { this.limit = limit }

  start(input: { readId: string; owner: string; session: string; run: (signal: AbortSignal, onUpdate: (read: RequirementRead) => void) => Promise<RequirementRead> }) {
    this.prune()
    const controller = new AbortController()
    const job: Job = { controller, promise: undefined as unknown as Promise<RequirementRead>, owner: input.owner, session: input.session }
    this.jobs.set(input.readId, job)
    job.promise = input.run(controller.signal, read => { job.read = read }).then(read => {
      // `onUpdate` carries progress, and each snapshot still says `reading`; only the
      // resolved value has the terminal state, so it has to be recorded too.
      job.read = read
      return read
    })
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
