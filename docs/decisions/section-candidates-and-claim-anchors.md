# Section candidates and claim anchors

Implementation record, 2026-10-05. Product baseline remains unchanged.
Sources: paired PRD SF-011/013/014/016/028 and AT-10/13/24;
SPEC sections 7.8, 18 and 19.2 in `../../../docs/`.

`src/core/editing/sections.ts` uses the positioned Markdown AST. A confirmed
outline section identifies an exact normalized title, heading depth and parent.
Duplicate titles, wrong hierarchy and an ambiguous insertion order fail closed.
Existing section replacement keeps the heading and stops before the next heading,
including a child heading. New sections insert at an outline boundary without
removing existing manuscript bytes. Unsupported or ambiguous titles require
explicit manual alignment; no similarity relocation occurs.

The frozen Writer plan includes one outline branch, its scoped claims and located
evidence. The approval dialog explains that the saved manuscript is also sent for
cross-section consistency. Research results remain explicit pending markers when
not actually available. A section result must include the same section ID, valid
project citation tokens, paragraph-to-claim mappings and actual limitations. The
mapping covers every Markdown paragraph, including list paragraphs, with zero-based
indices; an empty claim list explicitly means no registered claim association.
These associations do not establish academic support or verify model truth.

Immutable proposals include the outline version and complete candidate. Acceptance
recomputes the actual edit, checks the proposal hash, project revision, manuscript
hash and raw evidence versions, and commits the manuscript, bibliography, revision
snapshots and claim anchors through the existing guarded transaction. Neither the
model nor a changed preview can approve a different write scope.

Anchors store the exact paragraph block ID, source-text SHA256 and manuscript
SHA256. Controlled edits retain unaffected anchors using known positional shifts
and identical source bytes. Manual editing can retain an exact unique paragraph;
duplicates or altered text require explicit remapping. The operator-only
`anchors.upsert` endpoint confirms a current whole paragraph, validates claim IDs,
and supports explicit remapping or removal without changing manuscript bytes.
It invalidates evidence/logic/integrity review and never upgrades claim support.

Validation: typecheck and all 135 automated cases pass, including adjacent and
nested human content, CRLF/Unicode, missing-section insertion, malformed model
maps, stale outline/patch refusal, exact anchors and duplicate-paragraph ambiguity.
The real DSH 0.2.0-rc.2 operator UI verifies manual paragraph association and
selection display in an isolated DSH_HOME. A real DeepSeek stage generates a
section candidate and accepts it with actual citation and claim anchors while
preserving the original manuscript; bounded rewrite/cancellation checks remain.
Local evidence lives in ignored `.dsh-tmp/g0-smoke.json` and `model-smoke.json`.

This implements a validated section-writing action, not all AT-10 or V1:
multi-section end-to-end examples, complete semantic review, automatic pipeline
recovery and full acceptance mapping remain required.
