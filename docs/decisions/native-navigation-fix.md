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
