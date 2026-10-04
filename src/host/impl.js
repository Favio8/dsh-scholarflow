/**
 * dsh-scholarflow - host-plane implementation (G0 verification stage).
 *
 * Two kinds of code live here, and they must not be confused:
 *
 *   1. The plugin itself: currently an inert row that proves the lifecycle.
 *   2. The G0 probes (`runProbes`): verification scaffolding that asks the real
 *      host real questions and records the answers. Probes exist only to make
 *      G0 claims checkable; they are not product behaviour and are expected to
 *      be replaced by real diagnostics in M1.
 *
 * Nothing here registers slots, settings, tools or listeners, and nothing
 * writes a file outside the lifecycle/probe log.
 *
 * All probe code is in ONE module on purpose: the host loader keys modules by
 * resolved URL, so a multi-file layout would be frozen by the ESM cache while
 * this file is not. See docs/decisions/ADR-002.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** Plugin name used by loader diagnostics. */
export const name = 'scholarflow'

/** No host services are required yet; probes resolve them optionally. */
export const inject = []

/**
 * Schema library availability, measured at load time.
 *
 * MEASURED (ADR-003): a plugin installed with `link:` gets NO dependencies
 * resolved, so `zod`/`schemastery` were initially unresolvable from this package
 * (`ERR_MODULE_NOT_FOUND`). The host's own `DomainTableSpec.valueSchema` is typed
 * `ZodType<V>`, so zod is the sanctioned schema library; it is now declared as a
 * real dependency of this package and resolved through a dynamic import so the
 * plugin still loads (with reduced capability) if it is ever missing.
 */
let zod = null
try {
  zod = await import('zod')
} catch (error) {
  record('zod-unavailable', { message: String(error?.code ?? error?.message ?? error) })
}

/**
 * Cordis' own schema library. MEASURED: `settings.describe()` projects a shipped
 * namespace's schema into schemastery's internal `{ uid, refs, dict }` form, and
 * neither a plain JSON-Schema object nor a zod schema produced a namespace at
 * all — silently, with no diagnostic. schemastery is what Cordis' `Config`
 * expects. It is a CJS package, so the default export is unwrapped.
 */
let Schema = null
try {
  const mod = await import('schemastery')
  Schema = mod?.default ?? mod
} catch (error) {
  record('schemastery-unavailable', { message: String(error?.code ?? error?.message ?? error) })
}

/**
 * G0-05: a Config declared with the schema library Cordis actually projects.
 * `settings.describe()` keys forms by profile loader entry id, and an entry
 * without a projectable Config simply has no settings namespace.
 */
export const Config =
  Schema && typeof Schema.object === 'function'
    ? Schema.object({
        g0ProbeMarker: Schema.string()
          .default('')
          .description('G0-05 持久化探针标记（写入 profile patch，用于验证跨进程恢复）'),
        defaultProjectType: Schema.string()
          .default('course-paper')
          .description('新建项目默认类型（占位，真实设置项在 M1 定义）'),
      })
    : undefined

const SKELETON_VERSION = '0.0.0-g0'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const LOG_DIR = join(DSH_HOME, 'scholarflow-g0')
// Probe scaffolding may redirect its log so a throwaway verification process
// does not mix records with the user's desktop profile.
const LOG_FILE = process.env.SCHOLARFLOW_G0_LOG || join(LOG_DIR, 'lifecycle.jsonl')

/** Best-effort record; never throws. */
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
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        ...extra,
      })}\n`,
      'utf8',
    )
  } catch {
    /* observability is best-effort */
  }
}

/** Optional service lookup; never throws, never blocks the plugin. */
function service(ctx, key) {
  try {
    return ctx.get(key) ?? null
  } catch {
    return null
  }
}

/** Candidate host services G0 needs to reason about; presence is measured, not assumed. */
const CANDIDATE_SERVICES = [
  'agentPresets',
  'workspaceRegistry',
  'workspaceController',
  'workspaceFiles',
  'workspaceChanges',
  'sessions',
  'sessionController',
  'sessionPersistence',
  'fs',
  'settings',
  'settingsController',
  'configEditor',
  'skills',
  'sessionSkillCatalog',
  'tools',
  'systemPrompt',
  'commands',
  'storage',
  'storageDomain',
  'slots',
  'webServer',
  'llm',
  'agentLoop',
  'agents',
  'approval',
  'credentials',
  'jobs',
  'pluginManager',
  'invariants',
  'clientModules',
]

/** Probe: what runtime is this plugin actually executing on? */
function probeRuntime() {
  record('probe:runtime', {
    platform: process.platform,
    arch: process.arch,
    versions: {
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      v8: process.versions.v8,
      modules: process.versions.modules,
    },
    dshHome: DSH_HOME,
    cwd: process.cwd(),
  })
}

/** Probe: which candidate host services resolve in this composition? */
function probeServices(ctx) {
  const present = []
  const absent = []
  for (const key of CANDIDATE_SERVICES) {
    const value = service(ctx, key)
    if (value) {
      present.push(key)
    } else {
      absent.push(key)
    }
  }
  record('probe:services', { phase: 'at-apply', present, absent })

  // MEASURED CAVEAT: at `apply` time the composition is still settling, so
  // services registered by later rows are not resolvable yet. Re-read once the
  // tree has settled; only the settled reading describes the finished host.
  for (const delayMs of [2000, 6000, 12000]) {
    setTimeout(() => {
      const latePresent = []
      const lateAbsent = []
      for (const key of CANDIDATE_SERVICES) {
        if (service(ctx, key)) latePresent.push(key)
        else lateAbsent.push(key)
      }
      record('probe:services', { phase: `after-${delayMs}ms`, present: latePresent, absent: lateAbsent })
    }, delayMs)
  }
}

/**
 * Probe G0-02: is the ScholarFlow Mode registered, selectable, and does it
 * leave every other preset's default alone?
 */
async function probeAgentPresets(ctx) {
  const agentPresets = service(ctx, 'agentPresets')
  if (!agentPresets) {
    record('probe:agent-presets', { ok: false, reason: 'agentPresets service unavailable' })
    return
  }

  try {
    const roster = await agentPresets.remoteExportList()
    const rows = roster?.presets ?? []
    const mine = rows.find((row) => row.id === 'scholarflow') ?? null
    const defaults = rows.filter((row) => row.isDefault).map((row) => row.id)

    record('probe:agent-presets', {
      ok: true,
      presetIds: rows.map((row) => row.id),
      defaults,
      scholarflowFound: Boolean(mine),
      scholarflowRow: mine,
      scholarflowIsDefault: Boolean(mine?.isDefault),
    })
  } catch (error) {
    record('probe:agent-presets-error', { message: String(error?.message ?? error) })
  }

  try {
    const inventory = await agentPresets.compositionInventory()
    const mine = (inventory ?? []).find((item) => item.id === 'scholarflow') ?? null
    record('probe:agent-presets-composition', {
      ids: (inventory ?? []).map((item) => item.id),
      scholarflow: mine
        ? {
            name: mine.name ?? null,
            isDefault: mine.isDefault,
            broken: mine.broken ?? null,
            rows: (mine.rows ?? []).map((row) => ({
              moduleName: row.moduleName,
              enabled: row.enabled,
              fiberState: row.fiberState ?? null,
            })),
          }
        : null,
    })
  } catch (error) {
    record('probe:agent-presets-composition-error', { message: String(error?.message ?? error) })
  }
}

/**
 * Probe G0-07 (boundary): WHICH locations does the host's `ctx.fs` actually
 * allow writes to?
 *
 * Why this matters: `fs.resolve` was measured to be a pure path normalizer with
 * no authorization, and an earlier write to `<DSH_HOME>/scholarflow/` was
 * rejected with FS_SANDBOX_DENIED while a temp-directory write succeeded. SPEC
 * 8.1 requires the FileGateway to enforce its own containment, so the host's own
 * gate must be measured rather than assumed in either direction.
 *
 * Directory creation uses node:fs because `ctx.fs` exposes no mkdir; that gap is
 * itself a recorded finding (the sandbox gates ctx.fs, not node:fs).
 */
async function probeWritePolicy(ctx) {
  const fs = service(ctx, 'fs')
  if (!fs) {
    record('probe:write-policy', { ok: false, reason: 'fs service unavailable' })
    return
  }

  const workspaceRoot = process.env.SCHOLARFLOW_G0_WORKSPACE
  const cases = [
    { label: 'os-temp', file: join(tmpdir(), 'scholarflow-g0-fs', 'policy.txt') },
    { label: 'dsh-home-plugin-dir', file: join(DSH_HOME, 'scholarflow', 'policy.txt') },
    { label: 'dsh-home-root', file: join(DSH_HOME, 'scholarflow-g0-policy.txt') },
  ]
  if (workspaceRoot) {
    cases.push({
      label: 'workspace-subdir',
      file: join(workspaceRoot, '.scholarflow-g0-probe', 'policy.txt'),
    })
  }

  const results = {}
  for (const item of cases) {
    let mkdirError = null
    try {
      mkdirSync(join(item.file, '..'), { recursive: true })
    } catch (error) {
      mkdirError = String(error?.code ?? error?.message ?? error)
    }
    try {
      const target = await fs.resolve(item.file)
      const outcome = await fs.writeText(target, 'scholarflow-g0-policy\n')
      results[item.label] = {
        mkdirError,
        write: 'allowed',
        outcomeKeys: Object.keys(outcome ?? {}).sort(),
        version: outcome?.version ?? null,
      }
    } catch (error) {
      results[item.label] = {
        mkdirError,
        write: 'denied',
        error: String(error?.code ?? error?.message ?? error),
      }
    }
  }

  record('probe:write-policy', { ok: true, results })
}

/**
 * Probe G0-09: does state survive a process restart through a real file, rather
 * than living in an in-memory Map?
 *
 * Uses `ctx.fs` (the gated path) and writes ONLY inside the plugin's own
 * DSH_HOME directory (`<DSH_HOME>/scholarflow/`), which is where SPEC 16.1 puts
 * the private library and PRD 12.1 requires staying out of global roots. If the
 * host sandbox denies that location, that denial is the recorded result.
 */
async function probePersistence(ctx) {
  const fs = service(ctx, 'fs')
  if (!fs) {
    record('probe:persistence', { ok: false, reason: 'fs service unavailable' })
    return
  }
  const dir = join(DSH_HOME, 'scholarflow')
  const file = join(dir, 'g0-bindings.json')
  try {
    mkdirSync(dir, { recursive: true })
    const target = await fs.resolve(file)

    let prior = null
    let priorReadError = null
    try {
      const text = await fs.readText(target)
      prior = JSON.parse(text)
    } catch (error) {
      priorReadError = String(error?.code ?? error?.message ?? error)
    }

    const bootRecord = {
      pid: process.pid,
      bootedAt: new Date().toISOString(),
      instanceKey: process.env.SCHOLARFLOW_G0_INSTANCE || 'default',
    }
    const next = {
      schemaVersion: 1,
      records: [...(prior?.records ?? []), bootRecord].slice(-20),
    }
    await fs.writeText(target, `${JSON.stringify(next, null, 2)}\n`)

    record('probe:persistence', {
      ok: true,
      file,
      priorFound: prior != null,
      priorReadError,
      priorRecordCount: prior?.records?.length ?? 0,
      previousBootPids: (prior?.records ?? []).map((entry) => entry.pid),
      currentPid: process.pid,
      crossProcessEvidence:
        (prior?.records ?? []).some((entry) => entry.pid !== process.pid) ||
        (prior?.instanceKey != null && prior.instanceKey !== bootRecord.instanceKey),
    })
  } catch (error) {
    record('probe:persistence', { ok: false, file, error: String(error?.code ?? error?.message ?? error) })
  }
}

/**
 * Probe G0-08: is the skill catalog really isolated per agent-preset scope?
 *
 * MEASURED mechanism (host Service `skills`): "A registration files into the
 * layer of its calling context's scope; host rows and repository plugins land in
 * the global layer, while a plugin mounted by an agent preset's standing
 * composition lands in that preset's layer." A read merges the global layer
 * with the viewing scope's chain.
 *
 * The harness overlay mounts TWO presets, each with its own `skill-filesystem`
 * row pointing at its own TEST_ONLY fixture directory. Isolation holds only if
 * each scope sees exactly its own fixture and the unscoped read sees neither.
 */
async function probeSkillIsolation(ctx) {
  const skills = service(ctx, 'skills')
  const agentPresets = service(ctx, 'agentPresets')
  if (!skills || !agentPresets) {
    record('probe:skill-isolation', {
      ok: false,
      reason: `service unavailable: skills=${Boolean(skills)} agentPresets=${Boolean(agentPresets)}`,
    })
    return
  }

  const namesOf = (list) => (list ?? []).map((entry) => entry.name).sort()
  const FIXTURE_A = 'sf-test-skill-a'
  const FIXTURE_B = 'sf-test-skill-b'

  let globalView = null
  try {
    const snapshot = await skills.snapshot({})
    globalView = { names: namesOf(snapshot?.skills), complete: snapshot?.complete ?? null }
  } catch (error) {
    globalView = { error: String(error?.message ?? error) }
  }

  const scopes = {}
  for (const id of ['scholarflow', 'scholarflow-b']) {
    let lease = null
    try {
      lease = await agentPresets.acquireScope(id)
      const snapshot = await skills.snapshot({ scope: lease?.key })
      const scopedNames = namesOf(snapshot?.skills)
      scopes[id] = {
        scopeKeyKind: lease?.key === undefined ? 'undefined' : typeof lease.key,
        names: scopedNames,
        complete: snapshot?.complete ?? null,
        sawFixtureA: scopedNames.includes(FIXTURE_A),
        sawFixtureB: scopedNames.includes(FIXTURE_B),
      }
    } catch (error) {
      scopes[id] = { error: String(error?.message ?? error) }
    } finally {
      try {
        await lease?.[Symbol.asyncDispose]?.()
      } catch {
        /* lease release is best-effort */
      }
    }
  }

  const globalNames = globalView?.names ?? []
  record('probe:skill-isolation', {
    ok: true,
    global: globalView,
    scopes,
    fixtures: [FIXTURE_A, FIXTURE_B],
    globalLeakedFixture: globalNames.includes(FIXTURE_A) || globalNames.includes(FIXTURE_B),
    crossScopeLeak: Boolean(scopes.scholarflow?.sawFixtureB) || Boolean(scopes['scholarflow-b']?.sawFixtureA),
  })
}

/**
 * Probe G0-09 (storage path): can the plugin persist its own state across a
 * process restart through the HOST's own facility, rather than through a raw
 * file write (which the sandbox denies) or an in-memory Map?
 *
 * `storageDomain.open(spec)` is the host-sanctioned route: "the CALLER owns the
 * returned handle and closes it via Domain.close()". A second process reading
 * the same table is real cross-process persistence evidence.
 */
async function probeStoragePersistence(ctx) {
  const storageDomain = service(ctx, 'storageDomain')
  if (!storageDomain) {
    record('probe:storage-persistence', { ok: false, reason: 'storageDomain service unavailable' })
    return
  }
  if (!zod) {
    // DomainTableSpec.valueSchema is typed ZodType, so without a schema library
    // no domain can be declared at all. Recorded, not worked around.
    record('probe:storage-persistence', { ok: false, reason: 'zod unavailable: valueSchema is ZodType' })
    return
  }

  const spec = {
    // MEASURED: a hyphenated domain name is rejected with `malformed-medium`
    // (`sf-probe-5` failed, `sf_probe6` succeeded), so the name uses the
    // accepted character set. `layout` is NOT the cause: `per-record` opened
    // fine once the name was valid.
    name: 'scholarflow_probe',
    version: 1,
    tables: {
      bindings: {
        valueSchema: zod.z.object({
          sessionId: zod.z.string(),
          workspaceId: zod.z.string(),
          recordedAt: zod.z.string(),
        }),
      },
    },
  }

  let domain = null
  try {
    domain = await storageDomain.open(spec)
    const table = domain.table('bindings')
    const prior = [...table.entries()].map(([key, value]) => ({ key, value }))

    const key = process.env.SCHOLARFLOW_G0_INSTANCE || 'default'
    const value = {
      sessionId: `sess-${process.pid}`,
      workspaceId: 'ws-g0-probe',
      recordedAt: new Date().toISOString(),
    }
    await table.put(key, value)

    record('probe:storage-persistence', {
      ok: true,
      domain: domain.name,
      tableSize: table.size,
      priorEntries: prior,
      priorSessionIds: prior.map((entry) => entry.value?.sessionId ?? null),
      currentSessionId: value.sessionId,
      // A prior entry written by a DIFFERENT pid is the cross-process proof.
      crossProcessEvidence: prior.some((entry) => entry.value?.sessionId !== `sess-${process.pid}`),
    })
  } catch (error) {
    record('probe:storage-persistence', {
      ok: false,
      error: String(error?.code ?? error?.message ?? error),
    })
  } finally {
    try {
      await domain?.close()
    } catch {
      /* closing is idempotent; a failure here must not mask the result */
    }
  }
}

/**
 * Probe G0-09 variants: narrow WHY `storageDomain.open` reports malformed-medium.
 *
 * MEASURED context: `@deepseek-ai/dsh-storage-json` is configured with
 * `root: dshHomePath('storages')`, that directory EXISTS, and it already holds
 * official domains (`workspace.json`, `session_projcache.json`). No medium file
 * for our domain name was ever created, so the failure happens during unit
 * projection rather than from a corrupt medium.
 *
 * Each variant is opened and closed independently; `get()` is the read-only
 * diagnostic surface, so host-owned domains are only observed, never opened.
 */
async function probeStorageVariants(ctx) {
  const storageDomain = service(ctx, 'storageDomain')
  if (!storageDomain || !zod) {
    record('probe:storage-variants', { ok: false, reason: 'storageDomain or zod unavailable' })
    return
  }

  let hostOpenDomainSample = null
  try {
    hostOpenDomainSample =
      typeof storageDomain.get === 'function' && storageDomain.get('workspace') ? 'workspace' : null
  } catch (error) {
    hostOpenDomainSample = `get-failed: ${String(error?.message ?? error)}`
  }

  const schema = zod.z.object({ a: zod.z.string() })
  const variants = [
    { label: 'plain-single', spec: { name: 'scholarflowprobe', version: 1, tables: { t: { valueSchema: schema } } } },
    {
      label: 'per-record',
      spec: { name: 'scholarflow-g0-probe', version: 1, layout: 'per-record', tables: { t: { valueSchema: schema } } },
    },
    {
      label: 'with-compatible-versions',
      spec: { name: 'sfprobe2', version: 1, compatibleVersions: [1], tables: { t: { valueSchema: schema } } },
    },
    {
      label: 'with-global',
      spec: {
        name: 'sfprobe3',
        version: 1,
        global: { schema: zod.z.object({ marker: zod.z.string() }), initial: { marker: 'init' } },
        tables: { t: { valueSchema: schema } },
      },
    },
    // Separate name-shape from layout: the earlier failing spec had a hyphenated
    // name AND the default layout, so these two isolate each variable.
    {
      label: 'per-record-valid-name',
      spec: { name: 'sfprobe4', version: 1, layout: 'per-record', tables: { t: { valueSchema: schema } } },
    },
    {
      label: 'single-hyphen-name',
      spec: { name: 'sf-probe-5', version: 1, tables: { t: { valueSchema: schema } } },
    },
    {
      label: 'single-underscore-name',
      spec: { name: 'sf_probe6', version: 1, tables: { t: { valueSchema: schema } } },
    },
    {
      label: 'single-single-name',
      spec: { name: 'sfprobe7', version: 1, layout: 'single', tables: { t: { valueSchema: schema } } },
    },
  ]

  const results = {}
  for (const variant of variants) {
    let domain = null
    try {
      domain = await storageDomain.open(variant.spec)
      let writeBack = null
      try {
        await domain.table('t').put('probe', { a: 'v' })
        writeBack = domain.table('t').get('probe') ?? null
      } catch (error) {
        writeBack = `put-failed: ${String(error?.code ?? error?.message ?? error)}`
      }
      results[variant.label] = {
        opened: true,
        domainName: domain.name,
        size: domain.table('t').size,
        writeBack,
      }
    } catch (error) {
      results[variant.label] = { opened: false, error: String(error?.code ?? error?.message ?? error) }
    } finally {
      try {
        await domain?.close()
      } catch {
        /* idempotent */
      }
    }
  }

  record('probe:storage-variants', { ok: true, hostOpenDomainSample, results })
}

/** Probe G0-03 (partial): can the host report real workspace identity? */
async function probeWorkspaceIdentity(ctx) {
  const workspaceRegistry = service(ctx, 'workspaceRegistry')
  if (!workspaceRegistry) {
    record('probe:workspace', { ok: false, reason: 'workspaceRegistry service unavailable' })
    return
  }
  try {
    const list = await workspaceRegistry.list()
    const approvedRoot = process.env.SCHOLARFLOW_G0_WORKSPACE
    let resolved = null
    if (approvedRoot) {
      try {
        const ws = await workspaceRegistry.resolveByPath(approvedRoot)
        resolved = ws ? { id: String(ws.id), title: ws.title, sessionCount: ws.sessionIds?.length ?? 0 } : null
      } catch (error) {
        resolved = { error: String(error?.code ?? error?.message ?? error) }
      }
    }
    record('probe:workspace', {
      ok: true,
      count: (list ?? []).length,
      workspaces: (list ?? []).map((ws) => ({
        id: String(ws.id),
        title: ws.title ?? null,
        createdAt: ws.createdAt ?? null,
        updatedAt: ws.updatedAt ?? null,
        sessionCount: ws.sessionIds?.length ?? 0,
        // Path is logged only into the local harness log and is never copied
        // into user-facing docs: SPEC 5.2 keeps canonicalRoot host-side.
        path: ws.path ?? null,
      })),
      resolvedByApprovedRoot: resolved,
    })
  } catch (error) {
    record('probe:workspace-error', { message: String(error?.message ?? error) })
  }
}

/**
 * Probe G0-06: run ONE controlled stage on the host's own configured model, then
 * prove it can be cancelled.
 *
 * This is the real thing, not a stub: it goes through `ctx.llm.stream`, which is
 * the same adapter registry the host's own agents use, and it never fabricates a
 * response. Provider and model are read from the host's live adapter registry.
 */
async function probeModelStage(ctx) {
  const llm = service(ctx, 'llm')
  if (!llm) {
    record('probe:model-stage', { ok: false, reason: 'llm service unavailable' })
    return
  }

  let provider = null
  let model = null
  let providers = []
  try {
    providers = (llm.listProviders?.() ?? []).map((entry) => entry.id)
    provider = providers[0] ?? null
    if (provider) {
      const models = await llm.listModels(provider)
      model = models?.[0]?.id ?? null
    }
  } catch (error) {
    record('probe:model-stage-resolve-error', { message: String(error?.message ?? error) })
  }

  record('probe:model-stage-routes', { providers, chosenProvider: provider, chosenModel: model })
  if (!provider || !model) return

  const request = {
    provider,
    model,
    system: 'You are a verification probe. Answer with exactly one word.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word READY.' }] }],
    maxTokens: 16,
  }

  // --- (1) one real, bounded call ---
  const collected = []
  let usage = null
  let finish = null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)
    try {
      for await (const chunk of llm.stream({ ...request, signal: controller.signal })) {
        if (chunk.type === 'text-delta') collected.push(chunk.text)
        else if (chunk.type === 'usage') usage = chunk.usage
        else if (chunk.type === 'finish') finish = chunk.reason?.kind ?? null
        if (collected.length > 500) break
      }
    } finally {
      clearTimeout(timeout)
    }
    record('probe:model-stage', {
      ok: true,
      realModelResponse: true,
      provider,
      model,
      textLength: collected.join('').length,
      textPreview: collected.join('').slice(0, 80),
      usage,
      finish,
    })
  } catch (error) {
    record('probe:model-stage', {
      ok: false,
      provider,
      model,
      error: String(error?.message ?? error),
    })
  }

  // --- (2) cancellation: abort mid-stream and observe how it terminates ---
  try {
    const controller = new AbortController()
    const deltaTypes = []
    let sawText = false
    let finishReason = null
    let abortedAtMs = null
    const startedAt = Date.now()
    try {
      for await (const chunk of llm.stream({
        ...request,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Count from 1 to 200, one number per line.' }],
          },
        ],
        maxTokens: 512,
        signal: controller.signal,
      })) {
        deltaTypes.push(chunk.type)
        if (chunk.type === 'text-delta') sawText = true
        if (sawText && abortedAtMs === null) {
          abortedAtMs = Date.now() - startedAt
          controller.abort()
        }
        if (chunk.type === 'finish') finishReason = chunk.reason?.kind ?? null
        if (deltaTypes.length > 2000) break
      }
    } catch (error) {
      record('probe:model-cancel-stream-error', { message: String(error?.message ?? error) })
    }
    record('probe:model-cancel', {
      ok: true,
      abortedAfterMs: abortedAtMs,
      totalMs: Date.now() - startedAt,
      chunkCount: deltaTypes.length,
      finishReason,
      firstChunkTypes: deltaTypes.slice(0, 10),
    })
  } catch (error) {
    record('probe:model-cancel', { ok: false, error: String(error?.message ?? error) })
  }
}

/** Run every probe; never throws. */
async function runProbes(ctx) {
  record('probes-start', {
    probes: [
      'runtime',
      'services',
      'agentPresets',
      'moduleResolution',
      'filesystem',
      'settings',
      'workspaceIdentity(late)',
      'modelStage(late)',
    ],
  })
  try {
    probeRuntime()
    probeServices(ctx)
    await probeAgentPresets(ctx)
    await probeModuleResolution()
    await probeFilesystem(ctx)
    await probeWritePolicy(ctx)
    await probeSettings(ctx)
    await probePersistence(ctx)
    await probeStoragePersistence(ctx)
    await probeStorageVariants(ctx)
  } catch (error) {
    record('probes-early-failed', { message: String(error?.message ?? error) })
  }
  // MEASURED: services the SPEC needs (workspaceRegistry, webServer, pluginManager,
  // credentials, ...) are NOT resolvable at apply time; they appear within ~2s.
  // Everything that depends on them must run after the composition settles.
  await new Promise((resolve) => setTimeout(resolve, 2500))

  try {
    await probeWorkspaceIdentity(ctx)
  } catch (error) {
    record('probe:workspace-failed', { message: String(error?.message ?? error) })
  }
  try {
    await probeSkillIsolation(ctx)
  } catch (error) {
    record('probe:skill-isolation-failed', { message: String(error?.message ?? error) })
  }
  try {
    await probeModelStage(ctx)
  } catch (error) {
    record('probe:model-stage-failed', { message: String(error?.message ?? error) })
  }

  record('probes-complete')
}

/**
 * Probe: which modules the host loader can resolve for this package.
 * Recorded before any of them is imported for real, so the answer is measured
 * rather than assumed from a package.json peer range.
 */
async function probeModuleResolution() {
  const modules = ['schemastery', 'zod', 'cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-client-ui-slots']
  const results = {}
  for (const specifier of modules) {
    try {
      await import(specifier)
      results[specifier] = 'resolved'
    } catch (error) {
      results[specifier] = `failed: ${error?.code ?? String(error?.message ?? error)}`
    }
  }
  record('probe:module-resolution', { results })
}

/**
 * Probe G0-07: authorized reads, path restrictions, existence of a change
 * subscription. Reads touch the user's approved workspace READ-ONLY; writes go
 * to a scratch directory under the OS temp root so no user material is touched.
 */
async function probeFilesystem(ctx) {
  const fs = service(ctx, 'fs')
  if (!fs) {
    record('probe:filesystem', { ok: false, reason: 'fs service unavailable' })
    return
  }

  const workspaceRoot = process.env.SCHOLARFLOW_G0_WORKSPACE
  const readTarget = process.env.SCHOLARFLOW_G0_FILE
  const scratchRoot = join(tmpdir(), 'scholarflow-g0-fs')

  const results = {}

  // --- reads against the approved workspace root (read-only) ---
  if (workspaceRoot) {
    try {
      const rootTarget = await fs.resolve(workspaceRoot)
      results.rootResolved = { processPath: fs.processPath(rootTarget) }
      results.rootStat = await fs.stat(rootTarget).then((info) => (info ? { keys: Object.keys(info).sort() } : null))
    } catch (error) {
      results.rootResolved = { error: String(error?.code ?? error?.message ?? error) }
    }
  }
  if (readTarget) {
    try {
      const fileTarget = await fs.resolve(readTarget)
      // Measured: maxBytes is a cap on how large a file this call may read at
      // all, not a per-call slice length — 64 bytes over a ~9.7 KB file raised
      // FS_TOO_LARGE. Both the tiny cap and a generous one are recorded.
      let smallCapError = null
      try {
        await fs.readBytes(fileTarget, undefined, 64)
      } catch (error) {
        smallCapError = String(error?.code ?? error?.message ?? error)
      }
      const bytes = await fs.readBytes(fileTarget, undefined, 8 * 1024 * 1024)
      results.readBytes = {
        smallCapError,
        byteLength: bytes.byteLength,
        firstBytesHex: Buffer.from(bytes).toString('hex').slice(0, 32),
      }
    } catch (error) {
      results.readBytes = { error: String(error?.code ?? error?.message ?? error) }
    }
  }

  // --- path-restriction boundaries (these MUST NOT escape the allowed root) ---
  if (workspaceRoot) {
    const attempts = [
      { label: 'parent-traversal', path: join(workspaceRoot, '..', '..', 'Windows', 'win.ini'), cwd: workspaceRoot },
      { label: 'absolute-outside', path: 'C:\\Windows\\win.ini', cwd: workspaceRoot },
      { label: 'device-name', path: join(workspaceRoot, 'CON'), cwd: workspaceRoot },
      { label: 'sibling-prefix', path: `${workspaceRoot}-other`, cwd: workspaceRoot },
    ]
    const boundary = {}
    for (const attempt of attempts) {
      try {
        const target = await fs.resolve(attempt.path, { cwd: attempt.cwd })
        boundary[attempt.label] = {
          resolved: true,
          processPath: fs.processPath(target),
          insideRoot: null,
        }
      } catch (error) {
        boundary[attempt.label] = { resolved: false, error: String(error?.code ?? error?.message ?? error) }
      }
    }
    results.boundaries = boundary

    // `contains` is the API the SPEC requires instead of a startsWith() check.
    try {
      const rootTarget = await fs.resolve(workspaceRoot)
      const outsideTarget = await fs.resolve('C:\\Windows\\win.ini')
      const siblingTarget = await fs.resolve(`${workspaceRoot}-other`)
      results.contains = {
        rootContainsItself: fs.contains(rootTarget, rootTarget),
        rootContainsOutsideFile: fs.contains(rootTarget, outsideTarget),
        rootContainsSiblingPrefix: fs.contains(rootTarget, siblingTarget),
      }
    } catch (error) {
      results.contains = { error: String(error?.code ?? error?.message ?? error) }
    }
  }

  // --- write path on a scratch directory (no user material involved) ---
  try {
    mkdirSync(scratchRoot, { recursive: true })
    const filePath = join(scratchRoot, 'probe.txt')
    const target = await fs.resolve(filePath)
    const first = await fs.writeText(target, 'scholarflow-g0-probe-1\n')
    const second = await fs.writeText(target, 'scholarflow-g0-probe-2\n')
    const text = await fs.readText(target)
    results.write = {
      firstKeys: Object.keys(first ?? {}).sort(),
      secondKeys: Object.keys(second ?? {}).sort(),
      readBack: text,
    }

    // --- change subscription ---
    const controller = new AbortController()
    let notified = 0
    const unsubscribe = await fs.watch(target, () => {
      notified += 1
    }, controller.signal)
    await fs.writeText(target, 'scholarflow-g0-probe-3\n')
    await new Promise((resolve) => setTimeout(resolve, 400))
    controller.abort()
    try {
      await unsubscribe()
    } catch {
      /* already released by abort */
    }
    results.watch = { notifications: notified, unsubscribeType: typeof unsubscribe }
    results.writeOk = true
  } catch (error) {
    results.write = { error: String(error?.code ?? error?.message ?? error) }
    results.writeOk = false
  }

  record('probe:filesystem', results)
}

/**
 * Probe G0-05 (settings namespace + form projection) and G0-09 (does the value
 * survive a process restart, or is it only an in-memory map?).
 */
async function probeSettings(ctx) {
  const settings = service(ctx, 'settings')
  if (!settings) {
    record('probe:settings', { ok: false, reason: 'settings service unavailable' })
    return
  }

  let descriptors = []
  try {
    descriptors = settings.describe()
  } catch (error) {
    record('probe:settings-error', { message: String(error?.message ?? error) })
    return
  }

  const summarize = (descriptor) => ({
    ns: String(descriptor.ns),
    autoGenerate: descriptor.autoGenerate,
    applies: descriptor.applies,
    revision: descriptor.revision,
    hasSchema: descriptor.schema != null,
  })

  const own = (descriptors ?? []).filter((descriptor) => String(descriptor.ns).includes('scholarflow'))

  record('probe:settings', {
    ok: true,
    count: (descriptors ?? []).length,
    ownCount: own.length,
    own: own.map(summarize),
    ownValue: own[0]?.value ?? null,
    // Record the shape of a shipped namespace's projected schema so the Config
    // form a plugin must emit is measured, not guessed.
    sampleNamespace: descriptors?.[0] ? String(descriptors[0].ns) : null,
    sampleSchemaJson: descriptors?.[0]?.schema
      ? JSON.stringify(descriptors[0].schema).slice(0, 500)
      : null,
  })

  const marker = process.env.SCHOLARFLOW_G0_WRITE_MARKER
  if (!own.length || !marker) return

  const target = own[0]
  try {
    await settings.update(String(target.ns), { g0ProbeMarker: marker }, target.revision)
    const after = settings.describe().find((descriptor) => String(descriptor.ns) === String(target.ns))
    let patchPath = null
    let markerPersisted = null
    try {
      patchPath = await settings.prepareDocument()
      const fsService = service(ctx, 'fs')
      if (fsService && patchPath) {
        const patchTarget = await fsService.resolve(patchPath)
        const text = await fsService.readText(patchTarget)
        markerPersisted = text.includes(marker)
      }
    } catch (error) {
      markerPersisted = `read-failed: ${String(error?.message ?? error)}`
    }
    record('probe:settings-write', {
      ns: String(target.ns),
      wroteMarker: marker,
      readBackValue: after?.value ?? null,
      revisionBefore: target.revision,
      revisionAfter: after?.revision ?? null,
      patchPath,
      markerFoundInPatchFile: markerPersisted,
    })
  } catch (error) {
    record('probe:settings-write-error', { message: String(error?.message ?? error) })
  }
}

/**
 * Cordis plugin entry.
 *
 * Teardown uses `ctx.effect(...)`: that is the idiom every locally inspected DSH
 * plugin uses, and `ctx.on('dispose', ...)` was measured NOT to fire when the
 * bundle row was unloaded (see docs/integration-verification.md, G0-01).
 *
 * @param {import('cordis').Context} ctx
 * @param {unknown} config
 */
export function apply(ctx, config) {
  record('apply', { config: config ?? null })

  ctx.effect(() => {
    record('effect-registered')
    return () => record('dispose')
  }, 'scholarflow: g0 lifecycle probe')

  // G0-05: `settings.configure` registers this plugin instance's page policy.
  // `describe()` was measured to omit our entry even with a valid schemastery
  // Config, so the policy registration is tested explicitly rather than assumed.
  const settingsService = service(ctx, 'settings')
  if (settingsService && typeof settingsService.configure === 'function') {
    try {
      ctx.effect(() => settingsService.configure({ auto: true }), 'scholarflow: g0 settings page policy')
      record('settings-policy-registered')
    } catch (error) {
      record('settings-policy-failed', { message: String(error?.message ?? error) })
    }
  } else {
    record('settings-policy-skipped', { reason: 'settings service or configure() unavailable' })
  }

  // Fire-and-forget: probing must never delay or block plugin activation.
  void runProbes(ctx)
}
