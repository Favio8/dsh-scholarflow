/**
 * dsh-scholarflow - stable plugin entry (G0 verification stage).
 *
 * G0-05 EXPERIMENT (this revision): the entry is a plain STATIC re-export with
 * NO top-level `await`, to test whether asynchronous module evaluation was the
 * reason `settings.describe()` never projected a namespace for this plugin.
 *
 * Background, both measured on DSH 0.2.0-rc.2:
 *   - The loader imports this module by its resolved URL with no cache-busting
 *     query, and Node's ESM cache is keyed by URL, so editing the file and
 *     re-enabling the bundle re-ran the OLD module instance; `hmr` watches
 *     nothing (`root: []`). See docs/decisions/ADR-002.
 *   - `Config` must be forwarded from here, or it never reaches the loader at
 *     all (silent capability loss). See docs/decisions/ADR-004.
 *
 * The previous revision worked around the first point with an mtime-versioned
 * dynamic import, which made evaluation asynchronous. That affordance is not
 * needed for the CLI verification profile (every boot is a fresh process) and is
 * being traded away to remove the last untested difference from a shipped
 * plugin. ADR-002 records the trade; if the experiment does not change G0-05,
 * restoring the mtime shell is a one-file change.
 */

import * as impl from './impl.js'

export const name = impl.name ?? 'scholarflow'
export const inject = impl.inject ?? []

/**
 * EVERY loader-relevant export must be forwarded. Missing one is a silent
 * capability loss rather than an error: a Config that never reaches the loader
 * simply yields no settings namespace and no diagnostic.
 */
export const Config = impl.Config

export const apply = impl.apply
