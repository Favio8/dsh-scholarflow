# Run state authority and legacy migration

Date: 2026-10-05. Implements SPEC §5.4 / §10 / §27 without changing the frozen baseline.

New writing runs persist `runs/<id>/run.json` and `input.json`. `active.json`
is a checked projection, not a second independent state authority. Each state
write compares both images with the previous committed hash. External state
edits stop the writer rather than become its new preimage.

Legacy `state.json` / `snapshot.json` remain readable. Operator-only migration
requires an exact preview, project/session/peer binding and unchanged hashes.
It copies the original bytes to the prescribed paths, archives the full prior
images and retains the original files. Once `run.json` exists, the legacy state
is only history. Migration performs no model call, manuscript change or replay.
Legacy executing runs require explicit interruption handling before migration.

The Draft history reads persistent records and exposes refresh and migration.
Malformed or cross-project records are diagnosed rather than adopted. Tests:
`tests/integration/run-store.test.ts` and `generation-run.test.ts`; full suite
144 passed. Installed Host smoke exercises cancelling then confirming a
TEST_ONLY legacy migration, with byte equality for original input, state and
manuscript. The installed `--live-model` smoke also passed with the new paths
and three fixed Skill instruction resources. This storage migration is separate
from execution resumption.
