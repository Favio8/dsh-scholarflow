# Stopped legacy task upgrade visibility

2026-10-10. Bug correction within PRD/SPEC v1.10 SF-112/114/115 and explicit historical-task compatibility; no new product baseline.

The desktop profile links this repository. Read-only investigation found the user's current task predates `mode`, is cancelled at the evidence stage, and retains an unanswered historical question. The app and host started at 21:39, after the previous 21:21 build. Restarting alone could not expose the new workflow: `WritingProgress` returned null for cancelled guided tasks, hiding its explicit `start-first-draft` control. The editor separately polled pending questions without filtering terminal status.

Stopped guided tasks now show their retained-content state and guided-mode label, with the existing explicit upgrade action. They do not offer a misleading generic resume while historical questions are hidden. Cancelled, completed and failed tasks no longer reopen historical questions; guided waiting/paused tasks retain their existing question flow. Task records, source files, accepted manuscript and authorization are unchanged until the user clicks. Backend approval/version checks remain intact.

Validation:

- `tests/e2e/legacy-draft-render.mjs` renders the real progress and editor with a pre-mode cancelled task, verifies repeated observation produces no question/model dispatch, waiting questions remain available, stopping removes them, and the explicit upgrade click submits once while pending. Evidence: `.dsh-tmp/legacy-draft-render/1791639835467/report.json`.
- Typecheck, production build and 602/602 domain tests pass.
- `tests/e2e/installed-plugin-build.mjs` boots the installed Harness in an isolated profile linked to the production repository. Its served executable module factory exactly matches the local client. Evidence: `.dsh-tmp/installed-plugin-build/1791639961624/report.json` (local SHA-256 `afb9d879ae814e622ad4f62a4b169f1074581aaef788383e26b29c1575938df9`). Two initial byte-equality checks exposed the installed host's extra 72-byte debugger trailer; verification changed to capture and compare the registered module factories without executing them. Installed host uses metadata build revisions; the older local Harness checkout's content-hash description is not used as verification of this installation.

No paid calls, user profile modifications or manuscript changes. This isolated installed-build check does not assert that the user's already-running renderer has reloaded the latest fix; saving and restarting the desktop app is still needed after this build.
