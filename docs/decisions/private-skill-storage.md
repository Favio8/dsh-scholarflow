# Operator-owned private Skill storage — 2026-10-05

SPEC §16 and PRD SF-019–022 require `<DSH_HOME>/scholarflow/skills`, outside the
session Workspace. G0 originally established that an unbound `ctx.fs` request
cannot write that root; a session workspace-write policy should not authorize it.
The implemented boundary separates application resource storage from workspace
document writes. This does not change the frozen product baseline.

`PrivateSkillLibrary` uses the exact installed SDK `resolveDshHome`,
`withFileLock` and `writeFileAtomic`, plus narrowly scoped native file operations
under two fixed application-owned directory segments. It does not manufacture
an unrestricted session policy, alter workspace authorization, or provide a
general native-file Remote. Authenticated operator Remotes alone can prepare and
confirm installation. Model tools cannot choose source paths or invoke installation.

Source selection is a separate operator read grant. Local source files are
canonical ordinary files, rejecting symbolic links, hard links, special files,
credentials, dependency directories, traversal and Windows case aliases.
The original source is read-only. Package limits are 200 files, 20 MiB total,
64 KiB instructions; compatibility metadata grants no capabilities. Original
instructions and static resources retain their bytes; scripts never execute.

Versions live at `sha256(qualifiedId)/digest/`, with original files under `files/`
and a generated sibling manifest. An import is verified in private scratch before
atomic directory publication. Existing versions are never overwritten; scratch
from a failed import is retained for inspection. Fixed reads revalidate actual
file bytes. Missing or corrupted resources fail closed instead of using latest.
No ordinary DSH Skill catalog is populated or watched by this adapter.

Public GitHub reads use only `ctx.web.fetch`, preserving Host DNS/proxy/redirect
and response bounds. Default branch is queried and resolved to a commit. Tree
and blob modes reject links and submodules; every blob verifies its Git object
SHA-1 and the installed tree receives SHA-256. Only instructions are downloaded
for preview; the complete selected static tree downloads after confirmation.
Host truncation and GitHub 403/429 stop without retries, credentials or `git clone`.
Root-tree size and Host response limits can require a narrower URL/subdirectory
or local import. This is not an OS sandbox against other installed plugins.

Protocol references, checked 2026-10-05:

- [GitHub trees](https://docs.github.com/en/rest/git/trees)
- [GitHub blobs](https://docs.github.com/en/rest/git/blobs)
- [GitHub commits](https://docs.github.com/en/rest/commits/commits)
- Installed SDK `dsh-home-paths/lib/index.js`, `dsh-atomic-write/lib/index.js`,
  `dsh-host-directory-picker/README.md`, fixed at **0.2.0-rc.2**.

Verification: unit packaging/GitHub fixtures are labelled TEST_ONLY. Native local
import and a real public `openai/skills` multi-candidate import passed through the
installed Host settings UI. The isolated DSH_HOME global-catalog sentinel and
source bytes remain unchanged; private versions survive a read-only Host restart.
Evidence: `.dsh-tmp/skills-smoke.json` (ignored; no auth token or credentials).
Stage bindings, run snapshots and safe version removal are separate follow-up work;
this import verification alone is not full AT-17/18 or V1 acceptance.
