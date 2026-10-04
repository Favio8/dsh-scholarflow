# Project-local Skill resource reader

2026-10-05. Implementation of SPEC 16.1/16.3/16.6 and PRD SF-021/022/034;
the paired frozen baseline in `../../../docs/` remains unchanged.

Owned resources use `.scholarflow/skills/<namespace>/<id>/SKILL.md` and the
qualified identity `project:<namespace>:<id>`. Original instructions and all
static bytes remain intact. A separate `scholarflow.json` declares
`schemaVersion: 1`, `capabilities` and `suggestedStages`. A missing or invalid
sidecar blocks routing rather than inventing compatibility metadata. The digest
covers the complete tree including this sidecar; the computed manifest has
project origin and does not contain an absolute workspace path.

`src/core/skills/project-resources.ts` depends on a narrow optional FileStore
capability, not DSH or native filesystem APIs. The Host gateway implements
`resourceStat` and `readResourceBytes` only for the current bound project's Skill
subtree. Actual content reads use the installed Host filesystem byte service.
Native lstat inspects inode/link metadata only, because the installed SDK
`lstat(path, opts, signal)` returns type/size/version without a hardlink count.
Every ancestor must be ordinary and each file must have nlink=1. Canonical roots,
paths, type, size and before/after versions are checked; sensitive names,
special files, links and arbitrary metadata paths are refused. Raw material
`readBytes` continues denying all metadata and output paths.

Packages have the same 200-file/20-MiB bounds as other Skills; instructions and
sidecars cap at 64 KiB before content reads. Discovery caps candidates/directories
and cumulative content reads at 20 MiB, returns generic diagnostics for unavailable
trees, and never creates files. Overview has explicit resource refresh for files
copied outside the plugin; installation does not imply enabling this project.

All project and stage resolution requires the current validated workspace IO.
A project binding cannot be read without it or point to another identity's entry.
Default/library/builtin lookup never substitutes a missing project version.
Changed bytes or routing invalidate new reads under the old digest; already frozen
run instructions remain their original strings. A user must explicitly rebind the
new digest. Project resource copying/editing UI is a separate remaining action.

Validation: typecheck and 141 automated cases pass. New tests cover original BOM,
CRLF, binary bytes, workspace isolation, sidecar/byte change refusal, missing
capability, sensitive trees, junctions and hardlinks before any Host content read.
Real DSH operator UI discovers/enables a project resource; the actual scoped Agent
reads its original instructions, refuses script loading, and refuses an externally
changed digest. Native fixtures verify binary resources are unchanged. Evidence is
the isolated ignored `.dsh-tmp/g0-smoke.json`.
