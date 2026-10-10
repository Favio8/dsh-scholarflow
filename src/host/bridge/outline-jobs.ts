type Job<T> = { key: string; controller: AbortController; operations: Set<string>; promise: Promise<T> }

/** One execution per operator/session. Even an adapter slow to abort cannot overlap
 * a replacement: it must settle before the next request reaches the provider. */
export class OutlineJobs<T> {
  private jobs = new Map<string, Job<T>>()
  private stopped = new Set<string>()

  run(scope: string, key: string, operationId: string, signal: AbortSignal, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    if (this.stopped.has(JSON.stringify([scope, operationId]))) throw new DOMException('Operation stopped', 'AbortError')
    const previous = this.jobs.get(scope)
    if (previous?.key === key && !previous.controller.signal.aborted) {
      previous.operations.add(operationId)
      return previous.promise
    }
    previous?.controller.abort(new DOMException('Superseded', 'AbortError'))
    const controller = new AbortController()
    const abort = () => controller.abort(new DOMException('Request cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    const job: Job<T> = { key, controller, operations: new Set([operationId]), promise: undefined! }
    this.jobs.set(scope, job)
    job.promise = Promise.resolve().then(async () => {
      try {
        if (previous) await previous.promise.catch(() => undefined)
        controller.signal.throwIfAborted()
        const result = await execute(controller.signal)
        controller.signal.throwIfAborted()
        return result
      } finally {
        signal.removeEventListener('abort', abort)
        if (this.jobs.get(scope) === job) this.jobs.delete(scope)
      }
    })
    return job.promise
  }

  stop(scope: string, operationId: string) {
    // Stop can arrive while request validation/model discovery is still pending.
    this.stopped.add(JSON.stringify([scope, operationId]))
    if (this.stopped.size > 256) this.stopped.delete(this.stopped.values().next().value!)
    const job = this.jobs.get(scope)
    if (!job?.operations.has(operationId)) return false
    job.controller.abort(new DOMException('Stopped', 'AbortError'))
    return true
  }

  clear() { for (const job of this.jobs.values()) job.controller.abort(new DOMException('Plugin unloaded', 'AbortError')); this.jobs.clear(); this.stopped.clear() }
}
