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
This import verification alone is not full AT-17/18 or V1 acceptance.

## Stage binding follow-up — 2026-10-05

Overview explicitly previews and confirms fixed versions, enabled stages and
priority order. Install remains separate. Library updates add immutable versions;
projects are not silently migrated. Changing bindings invalidates pending plans
and dependent review. The exact SPEC resource-lock shape is used for new projects.
Legacy empty locks remain readable; explicit migration archives their complete
original bytes and YAML before editing only the owned binding key. Unsupported
or inconsistent locks fail closed.

The writer resolves the actual stage's fixed resources before approval, copies
instruction strings and bounded UTF-8 references into its plan, and checkpoints
these values in `runs/<runId>/skills.json`. It uses those bytes after approval;
later library changes do not replace them. Run snapshots record the digests and
resource-lock hash. Core receives a reader callback and does not import Host APIs.
Four built-in instruction-only resources are packaged as assets; enabling them is
explicit. Missing or changed fixed assets fail instead of selecting latest.

`scholar_skill` lists and reads only this project's operator-selected conversation
stage, with no caller-selected root or project. It rejects program/resource-script
reads. Writer stages choose their own fixed stage independently of that conversation
setting. Selection actions expose only enabled compatible selection-transform
resources. Ordinary modes retain their own catalog and tools. Disable does not
erase instructions already present in conversation history.

125 automated cases and typecheck pass at this checkpoint. Native DSH proves
binding preview cancellation, confirmation, stage-scoped Agent reads, script-read
denial, built-in binding and the selection menu. Real DeepSeek model execution
with the new bindings also passed draft rejection, citation-preserving repeated
paragraph rewrite/acceptance and cancellation. Actual resources are retained in
the isolated test run directories. These checks do not certify all other V1 work.
Project-local resource resolution remains.

## Reference-aware retirement follow-up — 2026-10-05

The operator prechecks a specific installed version before confirming removal.
Only the Host's registered local workspace metadata and bounded run snapshots are
read. Reference observations are hashed; absolute roots and configuration text
are not returned. Project and historical run references block removal. Missing,
inconsistent or unreadable reference state also blocks rather than being counted
as unreferenced. The UI states that unknown or remote copies are outside this scan.

Binding commits and version retirement use the same SDK cross-process catalog
lock. Retirement rechecks the reference observation hash after confirmation.
An unreferenced version is atomically moved into an owned `.retired/` directory;
its original bytes remain, and same-version reimport restores catalog availability.
There is no recursive deletion, project/run cleanup, or cleanup of global Skill
roots. Model tools cannot initiate this operation. External editors that bypass
both plugin locks remain outside a cross-filesystem transaction guarantee.

128 automated cases pass. Native DSH additionally verifies an active project
reference blocks retirement and that an unused version can be prechecked and
retired through Settings without altering the active version or original source.
The isolated `.dsh-tmp/g0-smoke.json` records these checks. Unit tests verify retained
binary/original/script bytes and same-version reimport after retirement.
