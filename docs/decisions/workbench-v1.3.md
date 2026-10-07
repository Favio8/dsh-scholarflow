# Workbench v1.3 implementation decisions

Date: 2026-10-07. Target: installed Windows DSH Desktop 0.2.0-rc.2,
Electron 44.0.0, Chromium 152.0.7977.54, embedded Node 24.18.1.
Product and acceptance documents live in the parent `docs/` workspace.

## Historical data and requirements

The real legacy task uses schema 1 and contains an answered `budget` question.
The current producer schema still excludes budget. A separate stored-question
enum accepts that one historical value; its original answer is retained. Budget
history is excluded from pending questions and future stage instructions. Opening
a task never writes it or launches a paid run.

`writingTask.requirements` resolves the ordinary workspace/session/project binding
and reads only the requirements record. It returns its spec and the SHA-256 of the
same bytes. Task corruption cannot block this read; a foreign project request
still fails. Requirements saves check the expected ledger revision and optional
spec hash, preserving edits on refusal. Legacy fallback projects explicit fields
from config/ledger and uses the existing allocation algorithm for missing chapter
lengths; it does not spread project.id or invent a 4000-word task.

Stored JSON, request validation, model JSON, cancellation and provider failures
are classified at their actual boundaries. Client errors retain their safe code,
operation and field paths. Provider details retain only selection, stream phase,
run ID, validated status and retry delay, never raw failure bodies or credentials.

## Native chat and models

The actual guide click failed with `layout: tab true has no pane`: global
`sidebarRight.openTab` requires a tab ID for replacement, whereas the bound
`useTabInfo().tab.actions.openTab` accepts `replaceTab: true`. ChatGuide now uses
the latter, matching the shipped guide in
`dsh-client-ui-sidebar-right/lib/client.js:517–530`. No host source was changed.
The public contract is also documented in the [DSH repository](https://github.com/deepseek-ai/deepseek-harness).

The host model selection is resolved per operation and cloned for that request.
The real configured `opencode-go/deepseek-v4.1-flash` route passed native chat and
polishing. Changing the isolated session through the native picker to
`opencode-go/qwen3.8-flash` produced the next real polishing request with that
model; the session was restored to DeepSeek V4.1 Flash / High. No plugin model
default, credential form, vendor endpoint or independent loop was added.

## Independent panes and candidate geometry

Editor and preview ratios are client preferences keyed by project and pane.
Only their actual scroll surfaces consume Ctrl wheel, with a non-passive listener,
delta accumulation and frame batching. Editor font/line height and measuring
mirror agree; preview uses Chromium layout zoom rather than an ancestor transform.
Offsets and hashes stay in source coordinates. Range menus follow scrolling and
scaling, and no longer steal focus from the editor during source selection.

Preview candidates are AST blocks following the captured target. A textarea has
no inline block-widget API. Source candidates therefore reserve a readable row
below the panes and keep the captured source target above it, rather than covering
following source lines or squeezing the candidate into half of a narrow split.
This geometry choice preserves the existing editor, original text, and direct
adopt/discard/undo controls without an editor framework migration.

Only ready, nonempty candidates render reading content or differences. They use
the existing Markdown/KaTeX projection and manuscript citation numbering. Detailed
differences are secondary. Failed/stopped candidates contain recovery controls and
their instruction, with no deletion proposal or pretend new text.
The diff is computed only when its details are opened; reading a long candidate
does not eagerly build the word comparison table.

The bottom input is normally one line (50 px measured), grows only itself, and
supports Enter, Shift+Enter, composing input and Esc. Exiting presence is inert;
empty overlay space passes pointer input to the manuscript. Existing Motion/CSS
is reused; no new dependency or confirmation layer was introduced.
Native window hide/restore was observed from Electron's main process: document.hidden
stayed false, while blur paused the gradient and focus restored it. Both states
retained exactly one request. Reduced-motion removed the persistent animation;
stopping ignored the delayed test response without changing the manuscript.

## Evidence and limits

Real provider results, actual Electron input, controlled Fetch responses and
domain tests are recorded separately. Desktop uses a `dsh-app` transport, so a
Playwright HTTP route alone did not intercept its requests. That failed test
assumption was corrected; simulation is explicitly labeled and restores fetch.
The native export completed and saved its DOCX even though the renderer download
event was unavailable. Its XML and actual Microsoft Word 16.0 pagination were
checked separately. The historical long manuscript is five pages; this is not
the already validated v1.2 four-page assignment or a new academic-quality pass.

Original project files remained unchanged across all 504 hashes. Private projects,
credentials, screenshots, recordings, downloaded exports and build output stay
under the ignored `.dsh-tmp/` directory. No publication was performed.

The final domain/contract/integration/fault suite passed 485 tests with no skips;
build and TypeScript checks passed. These are separate from desktop and provider
checks. The desktop long-input run retained all 567 typed characters on a 9,364
character manuscript across 30 seconds. Actual middle widths were 584/904/400 px
for requested approximate 640/960/360 scenarios; 400 px was the host minimum.
The old transport screenshot's DNS/TLS/server cause was not reproduced. Current
same-route successes do not establish that every future network failure is fixed.

## Repeating scoped desktop checks

`tests/e2e/v13-workbench.mjs --setup <ignored setup.json>` runs the installed
desktop against an already prepared isolated copy; `--live` explicitly sends a
paid polishing request. Without it, failures use labeled controlled Fetch responses.
The setup records absolute root/home/workspace/source paths plus workspaceId,
testSessionId and the legacy taskId. Home and workspace must stay inside an ignored
`.dsh-tmp` root. Copy the user's existing desktop configuration and credentials
privately; do not point DSH_HOME or workspace at the originals or put setup files
in Git. Workspace IDs must resolve only to the isolated copy. No test script
provisions a new model or provider.

Additional scoped helpers export `additional`, `projects`, `motionCheck` and
`hiddenCheck` from `tests/e2e/v13-{additional,projects,motion,hidden}.mjs`. They accept
the running page/app/setup, and where needed the public RPC helper. Select the
actual workbench session through the native UI before invoking a helper. Geometry
fixtures remain unsaved TEST_ONLY text and are restored; project preparation uses
public initialization without starting a paid writing task. Keep each invocation's
operation log: an earlier partially failed runner is not a whole-suite pass.
