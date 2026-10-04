import { ScholarError } from '../../shared/errors.ts'

// Only validated provider-neutral facts from the Host adapter qualify. Unknown
// thrown errors, credentials and configuration failures never enter this loop.
export function transientRetry(error: unknown, usedRetries: number, now = Date.now(), random = Math.random) {
  if (!(error instanceof ScholarError) || usedRetries >= 2) return undefined
  const status = error.details.status
  if (status === 401 || status === 403 || ['AUTH', 'INVALID_CREDENTIAL', 'NO_ADAPTER', 'CONFIG', 'CANCELLED', 'ABORTED'].includes(error.code)) return undefined
  if (!(typeof status === 'number' && (status === 429 || status >= 500 && status <= 599)) &&
    !['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'].includes(error.code)) return undefined
  const window = error.details.providerRetryAfterMs
  const local = Math.ceil(500 * 2 ** usedRetries * (0.9 + Math.min(1, Math.max(0, random())) * 0.2))
  const delayMs = Math.max(local, typeof window === 'number' && Number.isFinite(window) && window > 0 ? Math.ceil(window) : 0)
  if (!Number.isSafeInteger(now + delayMs)) return undefined
  return { retry: usedRetries + 1, notBefore: now + delayMs, delayMs, code: error.code }
}

export function waitRetrySlice(ms: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve() }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason) }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
