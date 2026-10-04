# Provider retry ownership and installed SDK audit

Date: 2026-10-05. SPEC §10.5 requires bounded temporary retries and respected
provider windows; authentication/configuration failures must not loop.

ScholarFlow's single-call Host adapter carries only validated `status` and
`providerRetryAfterMs` facts from the SDK terminal failure into Core. It does not
copy provider response bodies, request IDs, headers or credentials into errors.
Core schedules at most two temporary retries in the entire writer run, with
exponential delay and jitter. Provider windows are minimum waits. Every attempt
is charged before IO; retries never renew the call/time or format-repair budget.
Waits are abortable and pause stops the next dispatch. The not-before timestamp
survives pause, recovery and explicit linked retries. Project inputs/resources
are rechecked at every new dispatch. Unknown errors and 401/403/auth/configuration
failures do not qualify. A window longer than remaining time ends the run with a
budget reason and retains the window for a later explicit retry.

Primary audit source: installed DSH **0.2.0-rc.2** `resources/app.asar` runtime
packages, extracted read-only by `scripts/installed-runtime.mjs` into ignored
`.dsh-tmp/installed-sdk`. Line numbers below refer to those bundled files:

- `dsh-llm-retry/lib/index.js:175`: retry listener is `agent/request-error`,
  not a wrapper around direct `llm.stream` calls. ScholarFlow stages do not
  invoke this Agent Loop extension point.
- `dsh-llm/lib/index.js:2372`: direct stream uses `llm/stream` waterfall and
  one adapter dispatch. `adapterStream` at line 2283 normalizes the terminal
  failure. `LlmError` at line 1616 preserves validated status and provider window.
- `dsh-llm-deepseek/lib/index.js:2188`: Messages dispatch; line 2210 calls
  `files.retry` only for rejected file IDs. That method at line 1311 returns
  false when no files were used. ScholarFlow sends system/user text only,
  with no files, tools, images or replayed attachments. This verified route
  does not add hidden Messages retries to the Core attempt count.

SHA-256 of extracted primary bundled JS (in the same order as the bullets,
with `dsh-llm` second):

| Package | SHA-256 |
|---|---|
| dsh-llm-retry | cbb99f1c5038e4a9167aedf333343cb3e3adfb5c9f45a37ef7562b024429d050 |
| dsh-llm | 9132c8a8053ee82b9fb1ded4f98c85cf557f288a15a85c552c6b1fb319ead120 |
| dsh-llm-deepseek | 226e2047b843f954d8478207613f3e44448671c6f98f8edee77008d0fe005484 |

This evidence covers the installed standard DeepSeek text route. Arbitrary
third-party `llm/stream` middleware and other provider adapters need their own
audit; this document does not assert a universal SDK no-retry guarantee.

Validation: unit schedule/abort contracts and integration failures are explicitly
TEST_ONLY. They prove the two-retry limit, pre-dispatch charging, no auth retry,
retained provider window, cancellation during wait and stale-input suspension.
The Host contract test checks safe failure facts and one adapter invocation.
The earlier installed real-model pause/recovery test is provider success evidence,
not a fabricated live 429 test. No SDK package or credential file was modified.
