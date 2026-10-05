# Duplicate project identity diagnostics

2026-10-05. Implemented; explicit identity reassignment remains in development.

SPEC §4 requires explicit copy binding when two registered canonical roots share
one project identity. Read-only inspection previously failed before it could show
the current root's originals. `resolveStore(..., readonlyFuture=true)` now reports
the conflicting registration IDs and opaque root fingerprints, then uses the
existing bounded diagnostic reader. It does not select which root should receive
a new identity, create a lock, repair metadata, restore transactions, inspect raw
materials, or read the other root's manuscript. Normal operational gateways and
commit revalidation still reject duplicate identities.

Multiple registrations of the same canonical root are one project, with Windows
case folding. A request claiming a different project ID or another session scope
still fails. Removing a duplicate registration resolves the conflict without
editing either project; this is a diagnostic fact, not identity reassignment.

Two TEST_ONLY Host-reader contracts verify scope, bounded originals, denial,
canonical aliases and unchanged bytes. The installed DSH 0.2.0-rc.2 smoke verifies
two real registrations, read-only UI, write rejection before lock creation, and
registration removal retaining all copied and original files. It creates only
dedicated TEST_ONLY fixtures, never duplicates a user-owned project.

The subsequent explicit copy transaction must preserve content IDs and originals,
retain immutable old execution/approval provenance, detach old operational
pointers, and establish a new current identity. Historical session IDs are
attribution, never permission bindings. Old in-flight requests, unknown responses
and charged budgets cannot be refunded, replayed or cancelled from another root.
Identity-transition and pre-publication interruption recovery need separate
gateway verification before offering the confirmation action.
