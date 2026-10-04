# Project store verification — 2026-10-04

Implementation evidence for the project-persistence portion of M1, using the frozen
PRD/SPEC v1.0. This is not a claim that M1 or V1 is complete.

## Implemented boundaries

- `src/core/project/project.ts`: read-only initialization planning, collision
  detection, confirmed initialization, schema validation, derived configuration
  defaults, warnings for unsupported configuration keys, disk-based snapshots,
  ledger revision checks and controlled project Profile/memory writes.
- `src/core/store/transactions.ts`: durable preimage/postimage journals, guarded
  publication, explicit recovery planning, whole-plan validation before recovery,
  and third-content conflicts that preserve external edits.
- `src/host/gateway/file-store.ts`: canonical Host filesystem containment, owned
  output directories, session sandbox policy, Host atomic CAS writes, local
  process queues and the installed SDK's cross-process lock. Node filesystem
  operations are limited to the SDK's lock metadata after Host authorization.
- `src/host/bridge/project-api.ts`: real WorkspaceRegistry membership, cold session
  inspection, ScholarFlow mode verification, duplicate-project detection and
  repeated binding checks immediately before writes.
- `src/host/plugin.ts`: authenticated operator-only initialization and recovery
  confirmations bound to stored, expiring plans, exact workspace/session and
  current content hashes. Model tools cannot invoke these confirmation handlers.
- `src/client/plugin.tsx`: actual Host session creation with the ScholarFlow preset,
  preview/cancel/confirm initialization and explicit interrupted-transaction recovery.

Raw files are never transaction targets. A custom output directory is supported,
including recovery interrupted before the initial configuration was published.
Configuration and ledger corruption fail closed; they are not replaced by empty
defaults. A damaged journal prevents recovery writes.

## Reproducible verification

`pnpm typecheck` and `pnpm test`: 51 passing tests, including original boot and
containment contracts, AT-01/02 collision and cancellation cases, AT-23 publication
interruption/conflict cases, and AT-24 competing revision writes.

`node tests/e2e/installed-host-smoke.mjs` exercises the actual installed DSH
0.2.0-rc.2 Host and Chromium using an isolated, explicitly TEST_ONLY DSH_HOME.
It checks native initialization preview/cancellation/confirmation, raw-byte
preservation, a second session reading the same project, rejection of a mismatched
workspace/session and project binding restoration after a Host restart. It also
reproduces an interrupted initialization and confirms recovery through the real UI.
The generated evidence is `.dsh-tmp/g0-smoke.json`; screenshots and isolated
fixtures remain untracked. No model call or model credential is used in this test.

## Remaining work and limits

Private Skill installation/management, Profile and memory editors, project-copy
identity resolution and requirement editing remain open M1 work. The Core Profile
write function is not yet an exposed product editor.

Independent external editors do not obey the plugin lock. CAS guards, hashes and
transaction snapshots protect against silent overwrite; this is not an absolute
cross-editor serializability guarantee. Real multi-process crash/lock takeover and
the full V1 acceptance matrix remain to be tested. The evidence here does not claim
the running user's Desktop process has reloaded the newly built client.
