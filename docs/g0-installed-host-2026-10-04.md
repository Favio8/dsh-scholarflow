# Installed Host verification — 2026-10-04

This record supersedes the settings and sandbox hypotheses in the earlier
`integration-verification.md`; it does not change the frozen PRD or SPEC.

Target: DeepSeek Harness **0.2.0-rc.2**, Windows, Electron 44, Node 24.18.1.
`scripts/installed-runtime.mjs` reads selected SDK files from the installed
`app.asar` without modifying or executing archive entries. The extracted files
and generated evidence are ignored under `.dsh-tmp/`.

## Verified behavior

- Client factories receive `require`, and must return their namespace. The build
  wraps its CommonJS output in a local `module`/`exports` scope. The regression
  test runs the actual bundle without either global.
- Slots use `register(options, component)`. ScholarFlow owns `main/scholarflow`,
  declares `scholarflow.agent` with `session-maybe` scope, and renders the existing
  `conversation.content` factory inside it. It neither replaces host conversation
  registrations nor declares their children again. The own workspace and host
  composer render side by side; the host sidebar remains visible.
- The settings service selects **volatile** schema fields. Missing volatility,
  rather than module evaluation timing, caused the previous missing projection.
  `@deepseek-ai/schemastery` fields marked `.volatile()` project the `scholarflow`
  namespace. `settings/update` with its expected revision persists across process
  restart. No private settings writer is used.
- `TypertRemoteService` + `@Remote` provide the `scholarflow.v1` namespace through
  the existing authenticated Connection RPC. Requests use an envelope containing
  `args`; runtime schemas validate plugin inputs. No additional server is opened.
- Workspace Remote projections use `workspaceId`, not `id`. Chinese roots without
  Git resolve correctly; sessions are created with that exact workspace identity.
- `fs.readText()` returns a string. Mutations pass a guarded write intent and the
  policy returned by `sandboxPolicy.resolve({session})`. Workspace writes succeed;
  a fresh read-only session fails with the real sandbox denial. Existing sessions
  preserve their own policy overrides across Host restarts.
- The initial scoped preset used `tools.restrict({allow:[]})` with a monotonic
  guard. The actual academic registrations require the corrected ancestor-scope
  mask described in the 2026-10-05 addendum below.

## Reproduction and evidence

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
node tests/e2e/installed-host-smoke.mjs
```

The opt-in installed-host smoke launches the actual packaged CLI and Chrome in
headless mode. It uses a separate **DSH_HOME**, profile, and `TEST_ONLY` workspace
under `.dsh-tmp/`. It does not use model credentials or make model calls. It skips
fresh-home credential setup through the Host's “稍后配置” action. Evidence:
`.dsh-tmp/g0-smoke.json` and `.dsh-tmp/g0-three-columns.png`.

Initial attempts using only a separate profile exposed shared global session
storage and active write-handle conflicts. All subsequent smoke tests isolate the
whole DSH_HOME. The desktop application remains running; test processes are closed
by the harness.

## Remaining integration evidence

This is not a full V1 acceptance report. Product binding durability, project
transaction recovery, model-stage execution with the final academic tools, active
conversation layout, and live plugin-disable cleanup remain to be verified as
those services become concrete. Earlier real model/cancellation and private Skill
scope findings remain in `integration-verification.md`.

The old automatically executing G0 probe entry has been retired. Production boots
no longer start probe model calls. The `verifyGateway` endpoint is refused unless
the isolated Host explicitly sets `SCHOLARFLOW_G0_VERIFY=1` and has an authenticated
invocation; it is never registered as a model tool.

## Academic tool scope addendum — 2026-10-05

The installed Host smoke now executes the real Tool SDK with a bound Agent,
without making a model request. The preset exposes exactly nine controlled tools:
`scholar_project`, `scholar_materials`, `scholar_research`, `scholar_evidence`,
`scholar_outline`, `scholar_manuscript`, `scholar_review`, `scholar_skill`,
`scholar_export`. Current actions read actual project data, run deterministic
review, or preflight export. They cannot accept proposals, grant user approval,
install Skills, initialize projects, write manuscripts, or publish.

`tools.restrict({allow:[]})` on a standing preset also masks that preset's own
registrations when inherited by an Agent. The corrected mask denies inherited
global names, updates on `tools/change`, and keeps an exact-name monotonic guard.
The effect belongs to the preset, so switching a blank session to ScholarFlow
and back does not leave an Agent-owned restriction on Standard.

Verified in `tests/e2e/installed-host-smoke.mjs`: exact nine-tool catalog;
scoped complete policy with normal runtime contexts retained; project identity
and manuscript hash from actual tool execution; forged root/workspace rejected;
shell execution denied; academic tools and policy absent from Standard; blank
Standard → ScholarFlow → Standard restores the original catalog; a later global
registration remains hidden from ScholarFlow. Tests use isolated DSH_HOME only.
G0 verification Remotes require the actual authenticated operator plus the
explicit test environment flag. Full prompt text and credentials are not returned.

Online lookup, private Skill resolution, model-native proposal creation, section
generation, and model-assisted review remain incomplete. The nine registered
tool names do not imply those actions are implemented. Production reports these
limits explicitly. This addendum is not full V1 acceptance.
