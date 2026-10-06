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
| V3a/V3b/V3c | Source facts recorded; prototype ran but could not reach the capability — see below |
| V4 | Outstanding |
| V5 | Source review complete; end-to-end outstanding |
| V6 | Outstanding |

## Prototype run (2026-10-06, `tests/e2e/g0-probe.mjs`)

Booted the installed Host with an isolated `DSH_HOME`, an isolated profile and a
`TEST_ONLY` workspace, then called the RPC endpoint directly from the served page. No
model call was made and no paid usage occurred.

| Probe | Result |
|---|---|
| `directoryPicker/capability`, `directory-picker/capability`, `directoryPicker/describe` | **404 not found** for all three |
| `workspaces/list` | 200, empty — the fixture workspace is not registered as a DSH workspace in this profile |
| `workspace/files/read` on an absolute path outside the workspace | **404 not found** |

**Conclusion: V3a is not verified.** The directory picker's Remote namespace appears in the
host source (`dsh-api-workspace-controller` mentions `directoryPicker` and
`directoryPickerController`), but the names probed are not exposed as client RPC methods —
so the capability is reached by the workspace flow rather than by a generic call a plugin
can make. Verifying it needs the actual call site inspected in the workspace controller and
a UI-driven attempt, which this probe did not do.

The same run shows the probe harness itself works (isolated boot, page, RPC round trip),
so a follow-up run can reuse it once the real method names are known. Until then the
external-source feature stays unimplemented, and the wizard says so rather than offering a
control that cannot work.

**Not attempted here:** V3b (external read) and V5 (numbered style across three exports)
need a registered workspace and a project fixture respectively; both remain source-verified
only, as recorded above.
