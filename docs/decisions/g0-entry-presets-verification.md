# G0 verification: entry, preset storage and external sources (2026-10-06)

Scope: the G0 matrix of SPEC v1.1 §2 (V1–V6), run before implementing the entry,
wizard and preset-library work. Evidence here is read-only source inspection plus
isolated-file probes; V3b was corrected on 2026-10-06 after implementation showed the
earlier conclusion was wrong, and V4 still awaits a paid model call. Nothing in this
file claims a capability that was not observed.

## V1 · Opening the global settings panel — not available to plugins

**Result: FAIL (no public seam).** The DSH client contract states the shell owns the
open state, so a plugin cannot open the panel:

- `dsh-client-ui-settings-general/lib/client.js` renders `SettingsRoot` with props
  `settingsOpen` / `openSettings` supplied by its parent, not by a service.
- The slot catalogue shipped in `dsh-cordis-client-runner/lib/client.js` documents
  `settings.trigger` as "the sidebar-foot trigger row content … **The shell renders the
  button chrome and owns open state**", and `settings.section` owner props as "**The
  shell owns modal visibility and navigation**; `close` is the one shell affordance a
  section receives".
- No client service exposes open/close: `dsh-client-ui-settings` provides
  `settingsSchema` and `configForms`; `dsh-client-ui-layout` provides only
  `selectPanel` / `openRightbar`; `dsh-client-ui-settings-shell` exposes no service.

**Consequence and approved fallback.** The top entry cannot open the host's settings
panel. Falling back to the plan's second branch — the entry opens a plugin-owned
surface that edits the **same namespace through the same write path**, which is what
requirement SF-036 actually protects (one configuration, not one window):

- The existing `Settings` component already writes `scholarflow` through the host
  `settings/update` Remote with `expectedRevision`, i.e. the same document the global
  settings page edits.
- The same component will be mounted from the top entry, so the two surfaces share one
  implementation and cannot drift into two configurations.
- The client service `configForms` (`dsh-client-ui-settings`) is available for live
  reads if a later revision wants push synchronisation; it is not required for the
  contract, because both surfaces re-read on mount and writes carry the revision.

This is a change of *surface*, not of data ownership; it is recorded here because the
plan's V1 wording named the host panel explicitly.

## V2 · Preset directory read, write and recovery — verified

Isolated `DSH_HOME` probe (`dshHomePath('scholarflow','presets','user')`), real host
files untouched:

| Check | Result |
|---|---|
| `resolveDshHome()` honours explicit configuration and `$DSH_HOME` | PASS |
| `<DSH_HOME>/scholarflow/presets/user` is created on demand | PASS |
| Whole file written as `.tmp` then renamed onto the target (atomic replace) | PASS |
| Entry readable again after a simulated restart | PASS |
| A damaged entry is reported on its own and does not affect valid entries | PASS |

Note recorded during the probe: `dshHomePath()` resolves `$DSH_HOME` at call time, so
any host code that derives a path must hold the resolved home rather than rely on a
value captured earlier. The first probe wrote into the real `~/.dsh` before this was
noticed; those files were removed and the directory state was confirmed clean.

## V3 · External requirement sources — source facts established, prototype outstanding

**V3a (directory choosing).** `dsh-host-directory-picker` exposes
`capability()` returning either `{ kind: 'native', pick(signal) }` — one OS chooser that
returns the chosen absolute directory path — or `{ kind: 'browse', list(path?), createDirectory(path, name) }`,
which lists a single directory level and never a file. **There is no single-file chooser
seam in the official package list.** The seam is documented as workspace-directory
picking, so a prototype must confirm that reusing it for a requirement-source directory
does not register a workspace as a side effect.

**V3b (external read authorisation).** `dsh-fs-sandbox` states it "confines model file
**writes and edits** … while **preserving the local filesystem's read behavior**". The
obstacle to reading outside the workspace is therefore this plugin's own containment
policy (`src/core/paths/containment.js` refuses paths outside the root), not the host
sandbox. A prototype must still confirm the read path, member set, cancellation,
revocation and refusal of parent-directory expansion.

**V3c (single file, upload fallback).** `dsh-client-file-upload` stores a Blob, exact
bytes or a stream for one Session and returns a receipt, which is the documented route
for remote hosts where the desktop chooser is unreachable. Both routes need a real
prototype, including the copy's retention and deletion statement.

## V4 · Image recognition — channel verified, one real call left

The question this row had to answer was whether the host has an image channel at all, and
whether a plugin can tell when it does not. Both are now answered without spending anything:

- `ctx.llm.resolveModelInfo()` returns `inputModalities`, whose vocabulary is
  `'text' | 'image'` and whose **absence means unknown** — the host does not claim a capability
  it cannot report. `dsh-llm` also states the degradation is the host's own: "durable `ImageBlock`
  references become route-specific request versions only for image-capable models; text-only
  models receive stable placeholders."
- `ctx.attachments.admitPromptContent()` is the documented seam for a host prompt consumer: it
  normalizes the image, owns the durable reference, and hands back an `ImageBlock`, so the plugin
  never assembles provider bytes by hand.
- Probe (`V4 图片输入能力可探测`): the installed host resolves the session model
  (`deepseek-official/deepseek-flash`) with `imageInput: true`. **PASS**, no model call made.

Implemented to PRD §3.3 and SPEC §7.3: recognition is user-triggered, the result is a
**candidate** the user edits and adopts, adopting appends to the requirements instead of
overwriting them, re-recognising replaces only that image's own candidate, and a model that
cannot take images is told apart from one whose capability the host does not report — the two
need different words, and both keep the registration and the manual-paste path.

`tests/integration/image-recognition.test.ts` verifies the plumbing against a stubbed provider:
the image is admitted through the attachment service and the request carries the returned
reference rather than raw bytes; the plugin's own session-log entry **redacts** the image
(`<附件>`) instead of duplicating base64; a run whose log is not durable is refused rather than
reported as success; and provider failure, truncation and empty output keep their own codes.

**What is still unverified:** that a real provider returns *good* transcription for a real
screenshot. That is a quality question rather than a channel question, it needs one paid call,
and in production it is the user's own trigger (AT-32 requires recognition never to start by
itself). It is left to the first real use rather than spent as a verification cost.

## V5 · Submission format and numbered citation style — source review done

Current exporters support the numbered style only: LaTeX emits
`\bibliographystyle{unsrt}` with `\cite{}`, DOCX builds a numbered reference list, and
Markdown keeps machine citation keys in the same order. **Author–year is not
implemented**, which is why D-04 keeps it out of the selectable options. End-to-end
verification across save, restore, preview and the three exports still has to run.

## V6 · Draft, recovery and creation confirmation — awaiting prototype

Not started. Requires a real Desktop session: mode selection must not create
directories, opening an existing project must not re-initialise, and closing or failing
must keep the input.

## Status summary

| Item | State |
|---|---|
| V1 | Resolved by contract inspection; fallback chosen and recorded above |
| V2 | Verified (isolated probe) |
| V3a | **Verified** — the host serves only the native OS chooser; no in-app browser, no single-file chooser |
| V3b | **Verified (corrected 2026-10-06)** — an operator-chosen external folder is readable; the earlier "no channel" conclusion was wrong. See "V3b correction" below |
| V3c | **Resolved by design** — still no single-file chooser, so an external *file* is reached as a member of a chosen folder. That is now implemented behaviour, not a gap |
| V4 | **Channel verified (2026-10-06 晚)** — the host resolves per-model image input, the wizard reports it, and the recognition path is implemented and tested against a stubbed provider. The single real OCR call stays user-triggered. See "V4" below |
| V5 | **Verified** — all three deliveries agree on the numbered style, including the Word list |
| V6a | **Verified** — selecting the mode writes nothing into the workspace |
| V6b | **Verified** — opening a session does not re-initialise the project |

## V3b correction (2026-10-06): the channel exists

The earlier finding below concluded "no verified channel" and asked for the requirement to be
re-scoped with the user. **That conclusion was wrong, and the requirement needed no re-scoping.**
It searched the host's *API surface* — the workspace-files Remote API and the directory picker —
and missed that this plugin already reads outside a workspace through the two mechanisms it uses
for its own global storage and its local Skill imports:

1. **`PresetLibrary` uses `node:fs/promises` directly** for `<DSH_HOME>/scholarflow/presets/`
   (`src/host/presets/library.ts`), which is outside every workspace. V2 verified this end to end,
   including atomic replacement and corruption isolation.
2. **`LocalSkillSource` reads an operator-picked absolute directory** (`src/host/skills/local.ts`),
   reached through `skills.pickLocal` → `directoryPicker.pick()` → `skills.scanLocal`. It validates
   an absolute path, refuses links, and walks a bounded tree. `tests/integration/private-skills.test.ts`
   covers it.

The host's own contract agrees: `dsh-fs-sandbox` confines *writes and edits* while
"**preserving the local filesystem's read behavior**" — "Reads, listings, metadata, and read-only
watches work exactly as with `fs-local`; the mutation fence does not restrict observation."

So the read half was never blocked. What was genuinely absent is a *single-file* chooser (V3c),
which is why an external file is reached as a member of a chosen folder.

**Implemented and verified on the installed host** — `sources.pickExternal` and
`sources.externalStatus` are registered, and the external source travels through the project as an
opaque handle:

| Probe | Result |
|---|---|
| `V3b 外部来源状态接口` | **PASS** — an unauthorised handle returns `live: []` |
| `V3b 外部来源只存句柄` | **PASS** — the project stores `external_source_probe` and contains no absolute path |
| `V3b 外部内容不复制进项目` | **PASS** — no copy of the external file appears in the project, by name or by content |
| `V3b 外部来源不得携带路径` | **PASS** — a source that smuggles a `path` instead of a handle is rejected with `INVALID_REQUEST` |
| `V3a 选择器仅原生、无浏览后端` | **PASS** — `directory-picker/unavailable`, `capability: native` |

The grant is minimal and read-only by construction, and each of those properties has a test in
`tests/integration/external-requirement-source.test.ts`: one chosen folder and nothing above it,
symlinks refused at open and on every segment of a read, sensitive names and dependency directories
refused even when named directly, a bounded walk (200 members, depth 8) and a bounded read
(50 MiB) with a change detected mid-read, member names always relative, and the write gate still
refusing any path outside the workspace root. A grant belongs to the operator who made it and
lapses, which is why "reconnect" is a normal wizard state rather than an error.

## Prototype run (2026-10-06, `tests/e2e/g0-probe.mjs`)

Booted the installed Host with an isolated `DSH_HOME`, an isolated profile and a
`TEST_ONLY` workspace, then called the RPC endpoint directly from the served page. No
model call was made and no paid usage occurred.

| Probe | Result |
|---|---|
| `directoryPicker/list` (the real wire verb, found in `dsh-api-workspace-controller`) | 200 with `directory-picker/unavailable`, `{"capability":"native"}` — **the composed picker serves the native OS chooser** |
| `directoryPicker/list` on a path outside the workspace | same refusal: the browse verb does not exist on this host |
| `workspace/create` + `session/create` with `agentPreset: scholarflow` | workspace registered, session created, **no file created in the workspace** |
| `scholarflow.v1/project.inspect` after creating that session | ran, but this probe read the wrong field and could not confirm `initialized` — not established |

**V3a conclusion (verified):** the directory picker exists on the installed host and serves
**only the native backend**. The available verb is `pick(signal)`, which opens an OS chooser
and returns the chosen absolute directory path; `list` and `createDirectory` (the in-app
browser) are refused because the composition does not provide that backend. Two consequences
for the design, both now recorded rather than assumed:

1. An in-app folder browser is **not available** on this host, so the external-source flow
   must use the OS chooser and therefore needs a display; a remote client cannot pick.
2. There is still **no single-file chooser**: only a directory can be chosen, so an external
   *file* has to be reached as a member of a chosen directory.

Calling `pick` itself was deliberately not attempted: it opens a modal OS dialog, which a
headless probe cannot answer. Confirming it needs a real Desktop session with a person
present, and that is where the external-source feature stays until it happens.

**V3b (superseded — kept for the record):** every read method of the host's workspace-files API
takes a workspace file scope and the package also exposes `confine(root, workspaceRoot, path)`, so
that surface is bounded by the workspace by construction. The directory picker refuses to enumerate
outside the workspace (native-only, see V3a). The only remaining theoretical route is the raw
`ctx.fs` service, which `dsh-fs-sandbox` documents as confining writes while preserving reads — but
no concrete read entry point could be established from the installed bundle, and no prototype
exercised it.

**Why that reasoning failed:** it treated the host's Remote API surface as the only route to a
file, and so never looked at how this plugin already reaches outside a workspace. `PresetLibrary`
writes and reads `<DSH_HOME>/scholarflow/presets/` with `node:fs/promises`, and `LocalSkillSource`
reads an operator-picked absolute directory. Both were already verified. The correction above
records the real conclusion: the requirement stands as designed, and it is implemented.

**V3c (resolved by design):** an external *file* still has no chooser of its own — the OS dialog
picks directories. The requirement is therefore met by reaching a file as a member of a chosen
folder, which is what `sources.pickExternal` returns and what the wizard lists. The upload fallback
(`dsh-client-file-upload`) is not needed for this and stays unused.

**V5 (verified):** `tests/integration/export-citation-order.test.ts`
registers two sources, cites them in the reverse of their registration order, and delivers
the project. Verified:

| Check | Result |
|---|---|
| LaTeX declares `\bibliographystyle{unsrt}` and `\bibliography{references}` | **PASS** |
| LaTeX emits real keys in the manuscript's citation order | **PASS** |
| BibTeX entries follow the citation order, not the registration order | **PASS** |
| Markdown keeps the machine keys in the same order | **PASS** |
| Both deliveries carry the same manuscript bytes | **PASS** |
| Word numbered list | **PASS** — real OOXML whose reference list is numbered `[1]`/`[2]` in the same order as the citations |

**BibTeX title truncation — found by this check, fixed.** The entry used to be produced by a
CSL formatter, which dropped every non-ASCII character: `TEST_ONLY 来源乙` arrived as
`TEST\textunderscore{}{ONLY} `, losing the Chinese text and leaving a trailing space. The
project now writes the entry itself from the fields the ledger actually holds, escaping only
the LaTeX specials and keeping non-ASCII text as UTF-8. The same title now arrives whole as
`TEST\textunderscore{}ONLY 来源乙`.

The check covers it: the two citations carry Chinese titles, both must arrive complete with
the underscore escaped and no trailing space, in citation order.

**AT-36 (user acceptance 7 and 8) — verified in the isolated host, no model call:** the probe
saves the current structure as a user preset, then writes to the project and re-hashes.

| Check | Result |
|---|---|
| The preset lands in `<DSH_HOME>/scholarflow/presets/user/user-<32 hex>.json` | **PASS** |
| A project write leaves that file **byte-identical** (same SHA-256) | **PASS** |
| From a second workspace and session the library lists 13 entries (12 built-ins plus the saved one) | **PASS** |

This is the first evidence for two of the eight acceptance items: a user preset is reusable
across projects, and editing a paper never writes to the global library.

One API detail the probe surfaced: a Remote with no arguments still needs an explicit
`request` object, because the handler parses it strictly.

**AT-29 substance (user acceptance 1) — verified in the isolated host:** the probe writes
`defaultProjectType` through the host's `settings/update` and reads it back through the
plugin's diagnostics RPC. The value changed and the read-back showed the new one, so the
global settings section and the top entry genuinely share one document rather than holding
two configurations.

Getting there established how these two host RPCs differ from the plugin's own, which is
worth keeping: **`diagnostics` takes no arguments at all** and answers without the
`applicationResult` wrapper (the row sits at `result.value.settings[0]`), and
**`settings/update` takes `ns`, `patch` and `expectedRevision` at the top level of the
arguments**, not inside a `request`. Passing a `request` wrapper is refused with
`gateway/arguments-invalid`. The settings row carries `ns, revision, value, base, user,
schema, applies, secrets`; note that `revision` is `0` on a fresh profile, so a truthiness
check on it is wrong.

The interface-level confirmation (clicking both entries) still needs the real Desktop.

**Rendered-UI presence — attempted, not established.** A further probe step tried to open the
ScholarFlow session in the real client and assert that the wizard container, its three-step
nav and the requirement-source area actually render. It could not navigate: a session created
over RPC does not appear in the sidebar until the client refreshes, so the row click found
nothing and the wizard container count was 0. That is a probe limitation, not a product
finding.

The interface-level confirmation of items 2-5 therefore stays with the real Desktop, where a
person opens the session normally. The substance that can be checked without a person is
already recorded above: V6a/V6b for the session behaviour, AT-29 for the shared settings
document, AT-36 for preset reuse and library isolation.

**Rendered-UI presence — two things observed in the real client, the full flow not driven.**
Dumping the client's buttons after an RPC-created session showed that **the top entry renders as
`ScholarFlow 设置`**, and that the mode chip renders showing the *current* mode
(`标准模式` on a fresh session) rather than the target. So both surfaces of item 1 exist in the
real client, and item 2's entry point exists too.

Driving the rest did not work from the probe: a session created over RPC settles the client on a
blank session with no workbench, its sidebar row is present in one run and absent in the next,
and opening the chip and selecting ScholarFlow did not complete inside the probe. Reaching the
workbench this way is therefore not dependable here, and the interface confirmation of items 2-5
plus the Phase 0 §2.1 visual review stay with the real Desktop, where a person opens the session
normally. With the implementation already built, the artifact worth reviewing is the real page,
not a mockup of it.

**Items 3-5 substance — verified in the isolated host, no model call.** The probe drives the
creation loop through the public RPCs with the payload the wizard sends, then reads what the
host actually wrote into the new project:

| Check | Result |
|---|---|
| `creation.prepare` then `creation.start` on a fresh workspace | **PASS** — a writing task id came back |
| The requirement source is recorded in `.scholarflow/writing/requirements.json` | **PASS** — one source with its workspace path |
| The material list stays its own list | **PASS** — one material, independent of the source |
| The preset reference and both chapters are recorded | **PASS** — `course-argumentative`, two sections |

So the wizard's payload reaches the project intact: requirement sources and materials are two
independent lists (the old build forced a requirement file to also be a material), and the
chosen preset is recorded alongside the structure.

Together with the checks above, all eight acceptance items now have evidence at the substance
level: 1 (one settings document), 2 (V6a/V6b), 3-5 (this), 6 (twelve built-ins), 7 and 8
(AT-36). What remains for items 2-5 is a person looking at the rendered pages, and the top
entry and mode chip were already observed rendering in the real client.

**AT-40 and AT-38 — verified through the host surface.** Two more checks the probe now runs,
both without a model call:

| Check | Result |
|---|---|
| Submitting the same confirmed creation plan twice | **PASS** — the second call is refused with `INVALID_APPROVAL`, so a repeated click cannot create a second project |
| Renaming a user preset through `presets.rename` | **PASS** — the stored title changes |
| Removing a user preset through `presets.remove` | **PASS** — `removed: true` and it leaves the list |

The rename and remove paths were previously only exercised against the library class in the
integration tests; they now have evidence through the operator-only Remote surface the UI
calls.

**AT-43 — verified: an old project is read in place.** The probe rewrites a created project's
`requirements.json` into the pre-change shape (a single `assignmentPath`, no
`requirementSources`), hashes it, then calls `project.inspect`:

| Check | Result |
|---|---|
| The old shape is still readable | **PASS** — `initialized: true` |
| Opening it does not migrate or rewrite it | **PASS** — the file's SHA-256 is unchanged |

That is the compatibility promise from SPEC v1.1 §13 ("打开不写迁移") holding on the installed
host rather than only in the domain tests.

**AT-37 — verified: a requirement source needs no reference material.** A project created with
exactly one requirement source and an empty material list records the source and no material
(来源=1, 材料=0), so clearing the material list cannot remove a requirement source and a
requirement file no longer has to double as a material. That is the property the old build
enforced the other way round.

**AT-32, registration half — verified without spending anything.** An image can be registered as
a requirement source: the creation preflight accepts a spec whose only source is a `.png` and
returns a plan. The probe deliberately stops there, because starting the task would run the
materials stage into the planning stage and call a model, which needs the user's approval. So
the registration half of AT-32 is verified and the recognition half stays with V4.

**V6a (verified):** selecting the ScholarFlow mode creates a conversation and writes nothing
into the workspace. **V6b:** not established by this probe.
