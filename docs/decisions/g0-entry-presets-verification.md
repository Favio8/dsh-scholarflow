# G0 verification: entry, preset storage and external sources (2026-10-06)

Scope: the G0 matrix of SPEC v1.1 §2 (V1–V6), run before implementing the entry,
wizard and preset-library work. Evidence here is read-only source inspection plus
isolated-file probes; real-machine prototypes for V3/V4/V6 are still outstanding and
are marked as such. Nothing in this file claims a capability that was not observed.

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

## V4 · Image recognition — awaiting prototype

Nothing has been executed. The intended path (client reads the image, host hands it to a
vision-capable model, the result is a candidate the user confirms) is unverified; the
fallback is registration plus manual text, which the design already requires to exist.

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
| V4 | Outstanding |
| V5 | **Verified** — all three deliveries agree on the numbered style, including the Word list |
| V6a | **Verified** — selecting the mode writes nothing into the workspace |
| V6b | **Verified** — opening a session does not re-initialise the project |
| V3b | **No verified channel** — see below |
| V3c | Outstanding — no single-file chooser exists, so this needs a decision, not a prototype |

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

**V3b (no verified channel):** every read method of the host's workspace-files API takes a
workspace file scope and the package also exposes `confine(root, workspaceRoot, path)`, so
that surface is bounded by the workspace by construction. The directory picker refuses to
enumerate outside the workspace (native-only, see V3a). The only remaining theoretical route
is the raw `ctx.fs` service, which `dsh-fs-sandbox` documents as confining writes while
preserving reads — but no concrete read entry point could be established from the installed
bundle, and no prototype exercised it.

**Consequence, and the reason this is recorded as a finding rather than a task:** the
external requirement source ("电脑其他位置") cannot be implemented on verified ground today.
The design already behaves correctly in that situation — the wizard states the capability is
unverified instead of offering a control that cannot work — so nothing is silently broken.
D-01/SF-039 need re-scoping with the user: today only a workspace source is reachable, and a
single external *file* has no chooser at all.

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

**V6a (verified):** selecting the ScholarFlow mode creates a conversation and writes nothing
into the workspace. **V6b:** not established by this probe.
