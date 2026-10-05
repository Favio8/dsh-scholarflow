# Explicit project copy identity

2026-10-05. Implements SPEC §4 copy binding. Frozen PRD/SPEC are unchanged.

The operator chooses the current authenticated Workspace/Session, gives a reason,
previews both full configurations and original file hashes, and confirms a
server-held plan. Four previews, ten-minute expiry and 32 MiB aggregate storage
bound retained inputs. Cancellation changes no project file. The Host checks live
execution by actual Session cwd, including canonical aliases. It does not abort
another root's request. Normal gateways continue refusing duplicate identities.

The Core transaction creates a new project ID and increments ledger revision.
It preserves requirements, materials, sources, evidence, claims, outline,
document/revision IDs, manuscript and bibliography bytes, resource bindings and
complete resource trees. YAML comments and unknown keys stay in the displayed
configuration; only the effective project ID changes. Memory/Profile current
header IDs are rebound, retaining their original confirmation attribution.
Pending proposals become stale; review issues become stale and proposed fixes
reopen. The old ledger, headers and operational pointer texts are retained exactly
in `.scholarflow/identity/history/project_copy_*.json`.

Four old operational pointers receive explicit `project-copy-detached` records.
Readers verify their archive, path, previous hash and current identity before
treating them as inactive. Actual FileImages remain available for CAS replacement;
they are never presented to the store as absent files. Old run/input/checkpoint
files stay immutable. Old requests, pending charges and unknown responses are not
cancelled, refunded or replayed. A new goal and budget need separate confirmation.
Execution and proposal acceptance still require the exact current project ID.

Verified ancestry permits only historical display and resource-reference
protection. Old memory entry author/session/time metadata remains unchanged.
Inherited runs show their old status and counts with a readonly archive marker;
UI resume, close, retry and migration controls are suppressed. Stage executors
still reject those records. Reference scans retain old fixed Skill versions and
reject unrelated IDs or damaged lineage. No lineage record supplies permissions,
credentials, a Session binding or a provider request.

Identity history can be inspected and downloaded under current operator scope.
Reads are bounded to sixteen ancestors, eight MiB per record and 32 MiB total.
Identity headers are limited to two MiB each; publication text is limited to
twelve MiB so its escaped journal stays within the gateway's 32 MiB reader.
Unknown, too-new, oversized or changed state fails without truncation or defaults.

For recovery, an identity transition exemption comes only from the exact complete
copy publication journal, reconstructed from its validated immutable record.
Every target, before/after byte image, hash and order must match the Core's pure
publication function. Extra targets or unrelated transactions receive no
exemption. The writable gateway pins one root and exactly the old/new config
hashes, rechecking actual Session authorization and SDK sandbox policy on each
write. It uses ordinary text transactions/CAS; no native ledger or body writes,
directory moves, deletions, or guessed execution terminal states are introduced.

Six domain tests cover retained bytes/IDs, unknown paid requests, two-generation
memory ancestry, stale plans, thirteen publication fault points and recovery
target injection. Two new gateway seams cover config transition and duplicate
journal inspection. A reference-scan contract covers inherited fixed resources.
Installed DSH verifies preview cancellation, readonly-session denial, complete
copy binding, all original/non-header copied file hashes, binary Skill reads,
archive download and foreign-record refusal, restoration of selected pre-images
from a genuinely confirmed journal, explicit recovery, and cold binding restore.
The restoration step is labelled TEST_ONLY fault injection, not an observed crash.

These checks do not replace final simultaneous A/B/ordinary-session isolation,
three complete project examples, full automatic workflow, or final Desktop
installation/uninstallation acceptance. Native OS directory selection and other
model routes still need their existing capability reports.
