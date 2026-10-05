# Local saved-fact workflow progression

Date: 2026-10-05. Implements the local portion of PRD §7 and SF-027;
full model/search stage orchestration remains in development.

The operator previews a policy against the actual current seven-stage goal,
project ledger, manuscript and dependency hashes. Confirmation can acknowledge
saved facts, run deterministic review and create a working draft delivery.
Insufficient research and stopping revision require explicit reasons. Missing
requirements, unconfirmed outlines, missing chapters and unauthorized gaps stop
for user input. This phase makes no model or search calls and accepts no proposal.

Immutable input and durable state live inside the original workflow run's
`automatic/` directory. Steps are charged to that goal before execution.
Maximum steps, elapsed time and consecutive no-progress limits survive retries
and explicit resume. Progress uses actual saved facts and check/issue outcomes;
new report names and model wording cannot alone demonstrate progress.

Ordinary paid stages cannot start while this local scheduler is queued or
running. The scheduler also refuses an executing ordinary stage. All admission,
step registration and settlement checks run under the existing project lock;
multi-file writes use the existing transaction journal. A partially published
registration prevents error cleanup from writing a third version over recovery
preimages or postimages. Recovery keeps the charged pending step; it never
replays an unknown operation.

Cold inspection is read-only. Explicit resume verifies unchanged scope and the
original budget; a new session is recorded separately from immutable original
input. Pending unknown steps cannot resume. Ending their registration requires
proof the owner is no longer alive and preserves history and charged quota.
Running controls belong to the actual initiating project/workspace/session.

Verification: `pnpm typecheck`, full `pnpm test` 320/320, including twelve new
integration cases for no-progress stops, frozen limits, cold resume, unknown
steps, paid-stage exclusion, transaction recovery and competing dispatchers.
Installed DSH 0.2.0-rc.2 UI smoke verified preview cancellation, research
insufficiency, browser reload, explicit resume and close, with unchanged body
and ledger and retained original quota. These fixtures are TEST_ONLY; no online
research or academic completion is claimed by this local test.
