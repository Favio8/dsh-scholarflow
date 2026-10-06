# Native navigation and ScholarFlow restoration fix

Date: 2026-10-06. Applies to the installed DSH 0.2.0-rc.2 integration.

## Problem and evidence

The user reported that native new-session buttons did nothing even in ordinary
chat, and selecting ScholarFlow left the ordinary surface visible. The exact
state of that existing Desktop profile was not reproduced. Investigation found
a reproducible cancellation bug and several restoration failures in the plugin:

- The preset catalog subscriber called `layout.selectPanel(null)`. In the installed
  `dsh-client-ui-layout/lib/client.js:462–471`, this aborts the pending navigation
  signal used by `uiWorkspace.openWorkspace` to commit a native new session
  (`dsh-client-ui-workspace/lib/client.js:824–845`). The regression test proves
  that a preset update cancelled this signal before the fix.
- Initial already-loaded ScholarFlow sessions never enabled the workbench.
- Reopening the same blank session deliberately suppressed restoration.
- A temporary projection gap could undo an explicit return to ordinary chat.

These installed source paths are inside `resources/app.asar/dsh/node_modules/
@deepseek-ai/`; the archive is read, never patched.

## Change

`src/client/native-dock.tsx:13–77` derives the visible surface from the current
session's preset and active global panel. Catalog observation does not navigate.
Explicit opening selects the conversation panel only when leaving a global
panel. Returning to ordinary chat is remembered until the next explicit navigation
or mode entry. Deferred selection handling is cancelled when the plugin unloads.

The mode-picker wrapper captures the session before awaiting selection, so a
completion for an older session cannot reopen a newer one
(`src/client/native-dock.tsx:80–106`). No Host methods or native button handlers
are replaced, and no additional Agent loop is introduced.

DSH's native new-session action reuses an available empty session. Reusing an
empty ScholarFlow session retains its actual mode and wizard draft; the plugin
no longer displays an ordinary surface while that session's mode is ScholarFlow.

## Verification

- Build and `pnpm typecheck`: pass.
- Full unit, contract, integration and fault-injection suite: **411/411 pass**.
- `pnpm verify:navigation`: **7 Desktop scenario checks pass**, no client errors.
  The test launches the installed Electron application with isolated `DSH_HOME`
  and Electron user data, using the Desktop profile's bundle list. Its window is
  hidden while the native renderer is driven with mouse clicks.
- Scenarios: workspace new button, global new button, mode entry, both buttons
  while ScholarFlow is active, return from a global panel to the same blank
  session with its draft, renderer reload restoration, ordinary workspace isolation.
- Artifacts for this run: `.dsh-tmp/native-navigation/1791277205576/`; full test
  output: `.dsh-tmp/navigation-tests.tap`. They are local, ignored artifacts.

The test does not copy the user's sessions, credentials or saved provider patches.
It does not send prompts, initialize a paper project, or modify the user's workspaces.
The linked Desktop installation uses the rebuilt `dist/client.js` on renderer reload.

## Follow-up: blank pane with existing local drafts (2026-10-06)

The user still saw a blank main pane after the navigation fix. Read-only inspection
of the running production Electron renderer found the actual failure:
`CreationWizard` threw `TypeError: Cannot read properties of undefined (reading 'map')`.
The existing `scholarflow:creation:<workspace>:<session>` localStorage records
predated `requirementSources`, `countingPolicy` and section allocation fields.
The wizard restored their raw objects, bypassing the shared schema defaults.
Earlier navigation tests used fresh Electron storage and therefore missed this case.

DSH's own `SlotErrorBoundary` handled the exception inside `scholarflow.project`,
rendering only an empty `data-slot-error` marker. Our boundary around `renderSlot`
was outside this Host boundary, so it never received the failure. It now wraps
`Project` inside the registered entry (`src/client/plugin.tsx:143–147,299`).

`restoreCreationDraft` normalizes the known missing fields once at the storage
boundary (`src/client/creation-wizard.tsx:71–86,90`). It preserves unfinished titles,
requirements, selected materials, wizard step and chapter lengths. Old chapter lengths
are manual, preventing automatic redistribution. A legacy assignment selection becomes
one visible requirement source; the old field is removed from this local draft so
removing the source cannot leave a hidden read selection. Stored project files are
not migrated. No generic validation of unfinished drafts or scattered null guards
are introduced.

Verification after the follow-up:

- Build and typecheck pass; **413/413** unit/contract/integration/fault-injection
  tests pass, including rendering every wizard step with a pre-upgrade draft.
- The Desktop navigation test adds restoration of a pre-upgrade third-step draft,
  checks its title and manual lengths, and clicks both native new buttons again.
  **8 Desktop scenario checks pass**, with no client errors; ordinary conversations
  still render the native mode picker. Artifacts:
  `.dsh-tmp/native-navigation/1791278276042/`.
- The actual user's running Desktop was reloaded. Its original old draft in
  `dsh-scholarflow-ai` restored with the new fields and unchanged manual lengths.
  The global new button and new buttons in `dsh-scholarflow-ai` and
  `科技论文写作` each emitted a native `session/create` request and displayed the
  ScholarFlow wizard with no Slot errors or console errors. Native blank-session
  reuse kept their existing session IDs. The initially selected session was restored.

Inspection does not read credentials, send prompts, initialize a project or change
the installed DSH archive. Temporary debugger connections are removed afterward.
