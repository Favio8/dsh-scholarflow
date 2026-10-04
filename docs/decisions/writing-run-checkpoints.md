# Writing run checkpoints and explicit recovery

Date: 2026-10-05. Implements PRD SF-027 and SPEC §10 / §11 / §27.

Before provider IO the controlled writer stores the complete approved plan,
input version snapshot, actual fixed Skill resources, run state and checkpoint.
Every call is charged before dispatch. Run, active projection and checkpoint
updates use the previous committed hashes under the project writer lock. Model
IO runs outside that lock. Pause stops further scheduling after the current call
settles; valid output and the remaining structured-format attempt are durable.

Resume is operator-only: read-only preview, peer/project/session approval,
unchanged input/checkpoint hashes, then an archived control operation. The
original run/session provenance stays intact; the new execution session is
recorded separately. A valid saved candidate needs no additional provider call.
An unanswered pre-crash call stays charged; its result is not guessed from chat.
Active elapsed time is retained, paused time excluded, unanswered call time
charged conservatively. Two format attempts remain the bound across resumes.

An executing owner must be provably dead before takeover. Same PID with an old
plugin boot token is not proof: unload may still be settling IO. A paused run has
no unanswered call. Explicit close preserves original state/control history and
all artifacts, and releases the old run without changing the manuscript. Legacy
records without complete frozen inputs can be closed and migrated, not guessed
into resumable tasks. Failed/cancelled retries create linked new runs and retain
the original terminal record; they preview current confirmed project inputs.

The candidate proposal identity is checkpointed before ledger publication. If
that ledger publication succeeded before a crash, recovery only completes the
run record. It does not regenerate, re-store or apply an accepted proposal, even
when the manuscript has since changed. Unknown or changed artifacts block replay.

Validation: typecheck and 151 full-suite tests passed. New integration cases
cover pause before dispatch, bounded repair after resume, valid-candidate reuse,
dead/live ownership, accepted-artifact recovery, stale Profile, explicit close
and linked retry preserving terminal bytes. Installed DSH 0.2.0-rc.2
`--live-model` passed: pause through the native UI, cancel the resume preview
without state change, resume in a fresh actual session and accept the same run's
candidate. Saved valid output did not incur another model call. Raw manuscript
bytes stayed unchanged until explicit acceptance.

This writer checkpoint does not yet provide all seven workflow stage executors,
multi-query research recovery or automatic semantic review/revision cycles.
