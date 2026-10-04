/**
 * dsh-scholarflow - stable plugin entry (G0 verification stage).
 *
 * WHY THIS FILE IS A SHELL
 * ------------------------
 * Measured on DSH 0.2.0-rc.2: the profile loader imports this module by its
 * resolved URL with no cache-busting query, and Node's ESM cache is keyed by
 * URL. Editing this file and re-enabling the bundle therefore re-ran the OLD
 * module instance, and `hmr` does not watch a linked package either. The same
 * trap is documented inside the third-party plugin
 * `@dsh-external/dsh-mode-boost` ("ESM cache keys by URL").
 *
 * So the evolving implementation lives in `./impl.js` and is imported with an
 * mtime-derived query, which makes a plain bundle disable/enable cycle pick up
 * the current code WITHOUT restarting the DSH process.
 *
 * This is a G0 development affordance only. It is NOT product architecture and
 * is expected to be replaced once M1 introduces a real build/reload path.
 * See docs/decisions/ADR-002-g0-host-reload-affordance.md.
 *
 * FAILURE POLICY: loading this plugin must never break the host profile.
 * Any failure degenerates into an inert plugin that only records the failure.
 */

import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKELETON_VERSION = '0.0.0-g0'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const LOG_DIR = join(DSH_HOME, 'scholarflow-g0')
const LOG_FILE = join(LOG_DIR, 'lifecycle.jsonl')

/** Best-effort lifecycle record; never throws. */
function record(event, extra = {}) {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    appendFileSync(
      LOG_FILE,
      `${JSON.stringify({
        t: new Date().toISOString(),
        plugin: 'dsh-scholarflow',
        skeletonVersion: SKELETON_VERSION,
        event,
        pid: process.pid,
        ...extra,
      })}\n`,
      'utf8',
    )
  } catch {
    /* observability is best-effort */
  }
}

const IMPL_PATH = fileURLToPath(new URL('./impl.js', import.meta.url))

let impl = null
try {
  // mtime as the cache key: any edit to impl.js yields a fresh module instance.
  const revision = statSync(IMPL_PATH).mtimeMs
  impl = await import(`${new URL('./impl.js', import.meta.url).href}?rev=${revision}`)
  record('impl-loaded', { revision })
} catch (error) {
  record('impl-load-failed', { message: String(error?.message ?? error) })
}

export const name = impl?.name ?? 'scholarflow'
export const inject = impl?.inject ?? []

/**
 * EVERY loader-relevant export must be forwarded. Missing one is a silent
 * capability loss rather than an error: a Config that never reaches the loader
 * simply yields no settings namespace and no diagnostic.
 */
export const Config = impl?.Config

export const apply =
  impl?.apply ??
  ((ctx) => {
    record('inert-apply', { reason: 'impl module unavailable' })
    ctx.effect(() => () => record('inert-dispose'), 'scholarflow: inert fallback')
  })
