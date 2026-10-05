# Unsubmitted editor recovery

Implemented 2026-10-05 for SF-014, SF-018, SF-028 and SPEC §23.6.

Saved Markdown, Profiles and confirmed memory remain the project facts.
Scratch text is an uncommitted user draft. It cannot approve memory, change
provenance, advance a ledger revision or enter a model request.

Explicit edits synchronously update a browser backup under a key containing the
Host's canonical root fingerprint, project ID, actual Session ID and document.
It contains draft text and its original content hash, and survives page closure
in the same browser profile. Clearing browser data, storage denial, an origin or
profile change, or an unacknowledged browser storage failure can remove it.
Before-unload warnings remain; an unacknowledged Host request is not described
as durably saved.

Host staging starts immediately rather than waiting 500 ms. A serial queue keeps
one in-flight request and the latest pending edit. Ambiguous acknowledgements or
CAS conflicts stop dispatch. Explicit reread keeps both versions for comparison;
it never retries by guessing a new preimage. Recovery changes only the editor.
Saving the document still requires its original hash and explicit user action.

The five existing project instruction paths receive separate Session/path-bound
scratch files under `.scholarflow/drafts/project-text-buffers/`. Path allowlisting,
identity validation, 64 KiB UTF-8 content bounds, a 512 KiB serialized reader
bound, the normal Host sandbox and atomic CAS apply. Cleanup publishes an
explicit cleared record. Cross-project copies retain old scratch bytes without
rebinding old Sessions.

Instruction editing supports Host recovery, browser backup, service-version
comparison and explicit adoption/discard. A file changed again after save keeps
both the draft and original base hash instead of silently rebasing. Profile
replacement is disabled while instruction edits are dirty. Failed scratch
cleanup after a successful fact save is reported separately.

Four queue/storage tests and three domain tests cover last-key backup, isolated
scopes, quota denial, coalescing, lost acknowledgements, five-path cold reads,
unchanged approved facts, stale external edits, malformed identity and limits.
Installed DSH verifies unsubmitted terminology recovery with all original facts
unchanged, forced page closure while offline in the same browser profile, and
cold readonly Host recovery of an unsubmitted Unicode Review Profile. These are
explicit TEST_ONLY fixtures without model or online provider calls.
