# Retiring the unwired path, binding and workbench-layout modules

Date: 2026-10-07. Applies to the repository at `71beb53` and the installed DSH
0.2.0-rc.2 integration. Product and acceptance records live in the parent `docs/`
workspace; this note is an implementation record only and changes no baseline.

## What was removed

| Path | Lines | Role it claimed |
|---|---|---|
| `src/core/paths/containment.js` | 172 | SPEC §8.1 path containment policy (19 offline tests) |
| `src/core/project/binding.js` | 151 | SPEC 5.1/5.2 `WorkspaceBinding` re-verification (15 offline tests) |
| `src/client/workbench-layout.tsx` | 56 | resizable/collapsible scoped conversation panel |
| `tests/unit/path-containment.test.js` | 150 | the 19 tests above |
| `tests/unit/binding.test.js` | 144 | the 15 tests above |

`src/core/paths/` held only `containment.js`, so the directory is gone too.

## How the determination was made

Three independent checks, because "nothing imports it" is easy to get wrong:

1. **Import graph over `src/`** — every module's basename was searched as an import
   specifier across `src/`. Both core modules returned zero references;
   `workbench-layout.tsx` returned zero as well. The only other unreferenced files
   are the three real entry points (`host/plugin.ts`, `host/agent.ts`,
   `host/parsers/worker.ts`, referenced by `scripts/build.mjs`) and
   `client/motion/jsx-runtime.ts`, which `build.mjs` aliases by path.
2. **Built-artifact symbol hits** — `checkWritablePath`, `isInsideRoot`,
   `createWorkspaceBinding` and `WorkbenchLayout` each have **0 hits** in
   `dist/host.js`, `dist/agent.js`, `dist/parser-worker.js` and `dist/client.js`.
3. **Dynamic imports** — the only `import()` in `src/` is
   `host/parsers/worker.ts:57` (`pdfjs-dist`), so nothing loads these modules at
   runtime.

Git history explains the two security modules differently:

- `containment.js` was added by `b2815d5` ("add host-free path containment policy
  with 19 offline boundary cases") and `git log -S "containment.js" -- src` is
  empty, i.e. no commit ever wired it into a production import. It was born as a
  policy module whose only consumer was its own test.
- `binding.js` was genuinely wired once: `726eda9` introduced a live-session
  binding probe and `641299e` ("verify authenticated host integration and scoped
  tool isolation") superseded it. It was replaced, not abandoned mid-flight.

`workbench-layout.tsx` is the same shape: `fb3c69e` ("move desktop entry and dock
native chat composer") replaced it with the dock in `client/native-dock.tsx` plus
the resize affordance in `client/plugin.tsx:42`. Nothing documents it either.

## Where the guarantees actually live

Removing these modules takes no guarantee away, because none of them was on the
production path. The three requirements they appear to implement are met here:

| Requirement | Actual enforcement |
|---|---|
| SPEC §8.1 — canonical-root containment for writes | `src/host/gateway/file-store.ts:30` (path must start with `.scholarflow/` or `<manuscriptDir>/`), `:36` (`fs.contains(root, target)`), `:40` (the canonical path must still land in an owned directory). All three raise `PATH_OUTSIDE_ALLOWED_ROOT`. |
| SPEC 5.2 — re-verify session → workspace → project on every write | `src/host/bridge/project-api.ts:30-48`: the session's real `cwd` must equal the workspace root and the session must be in `workspace.sessionIds`; the config file is checked with `fs.contains`. |
| Writable text files are a closed set | `projectTextPaths` in `src/core/project/project.ts`, asserted by `tests/integration/project-store.test.ts:85` and `tests/integration/project-text-buffer.test.ts:40`. |
| Reading outside the workspace is refused | `src/host/sources/external.ts` and `registry.ts` (absolute path, real directory, link refusal, bounded walk), asserted by `tests/integration/external-requirement-source.test.ts` against production code. |

SPEC §8.1 and §5.2 are therefore satisfied, and this change is the removal of a
duplicate implementation, not a relaxation. Deleting the modules also follows the
workspace `AGENTS.md` ("pre-creating unused abstractions is not required") and the
SPEC's own note that a domain rule must not exist as a second copy.

## What was migrated rather than deleted

One assertion had real production meaning: "an externally authorised read does not
make the chosen folder writable". It now runs against the actual write gate.

- `tests/integration/external-requirement-source.test.ts` keeps its production read
  coverage and now reads a member through `ExternalRequirementSource` and asserts the
  chosen folder is byte-identical and the workspace gained nothing. Its former
  `checkWritablePath` assertions (including the allow direction) are gone.
- `tests/contracts/project-resource-gateway.test.ts` gained "the write gate refuses
  anything outside the owned project directories, including prefix-sharing
  siblings": a sibling sharing a prefix with `manuscript/` and a non-owned directory
  both raise `PATH_OUTSIDE_ALLOWED_ROOT`; two traversal spellings are refused earlier
  by the relative-path contract (so they are deliberately **not** asserted as
  `PATH_OUTSIDE_ALLOWED_ROOT`); and a write into `manuscript/` still succeeds, so the
  gate is not a reject-everything check.

Domain suite count moved from 486 to 453: the two deleted files contributed 34 tests,
and the migrated gateway test added one new case (486 − 34 + 1). The 34 removed tests
verified modules that never entered a build.

## Documentation amendments

`docs/integration-verification.md` (sections 03.4 and 07.6) and
`docs/decisions/g0-entry-presets-verification.md` (V3b) named these modules as the
enforcement point. Each section now carries a dated amendment that keeps the original
claim and its measurement, points at the real enforcement site, and states that the
15/15 and 19/19 results describe the removed module rather than production behaviour.
No historical conclusion was rewritten.

## Deliberate non-changes

- `src/host/providers/openalex.ts:17` still classifies a malformed provider response
  body as `request-validation` rather than `provider/transport`. It has no consumer
  today, so it is recorded here rather than changed in this pass.
- Nothing on the production path was touched. The strongest evidence is that
  `dist/host.js`, `dist/agent.js`, `dist/parser-worker.js` and `dist/client.js` are
  byte-identical before and after: the deleted code never reached the bundle.
