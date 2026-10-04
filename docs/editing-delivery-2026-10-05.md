# Editing, review and delivery verification — 2026-10-05

This is implementation evidence for an unfinished 0.1.0-dev, not V1 acceptance.
The frozen paired PRD/SPEC in `../docs/` remain unchanged.

## Implemented boundaries

- `src/core/editing/markdown.ts`: positioned remark/GFM/math AST, decoded text
  units, citation numbering and UTF-16 source ranges. Duplicate paragraphs have
  distinct source identities. Cross-paragraph, table, code, math, image and
  ambiguous formatting boundaries refuse selection without silently expanding it.
- `src/client/markdown.tsx`: explicit leaf mappings and real browser Range
  capture. External images are not fetched; raw HTML renders as text.
- `src/core/editing/proposals.ts`: immutable candidate files; current document,
  evidence, ledger and proposal hashes checked before accepting. Reject does not
  alter manuscript bytes. Accept and manual save regenerate cited-only BibTeX,
  retain preimages and produce revisions. Undo is a new guarded revision.
  Externally modified reference projections are preserved, not overwritten.
- `src/core/pipeline/generation.ts`: finite one-model-stage execution with durable
  request state, cancellation, call/time bounds, at most one JSON format repair,
  explicit privacy preview, and pending-only output. No model call under the
  writer lock. Enabled unresolved Skill bindings fail closed. This stage does
  not yet implement the complete pipeline, pause/resume or temporary retries.
- `src/host/executor/model.ts`: installed Host session model selection and public
  LLM stream API; authenticated operator starts; request messages are durably
  recorded in the existing Host session before model IO. The new adapter has
  not yet been validated against an actual model provider at this checkpoint.
- `src/core/review/review.ts`: immutable deterministic review, current dependency
  digest including approved raw bytes, explicit model/manual unknown checks,
  stable issue identities and corresponding-check revalidation before closure.
  Accepted risks and dismissals require reasons. Research without recorded own
  results remains B0 regardless of a dismissal.
- `src/core/export/delivery.ts`: operator-confirmed preflight and immutable
  Markdown, BibTeX and quality-report files with SPEC 26.2 manifests. Unknown
  checks prevent reviewed status. Missing citation keys refuse export. Working
  drafts retain B0 and accepted risks. Image resource copying is explicitly
  unavailable at this checkpoint; documents with images refuse preflight.

## Verification

`pnpm typecheck` passed. `pnpm test` passed 86 tests across unit, contract,
integration and transaction interruption layers. Deterministic model fixtures
are marked TEST_ONLY and do not establish real provider quality.

`node tests/e2e/installed-host-smoke.mjs` passed against installed DSH 0.2.0-rc.2
and headless Chrome in an isolated DSH_HOME. Added actual UI evidence:

1. Manual Markdown save and cited-only BibTeX on disk.
2. A real DOM selection of the second identical paragraph, including emphasis,
   escaped punctuation, entity-decoded emoji and citation `[1]`; exact source
   positions identify the second paragraph.
3. Cross-paragraph selection rejection without expansion.
4. Manuscript cold restoration after actual Host restart.
5. Deterministic review, working-draft confirmation and downloaded quality report.
6. Exported body and quality report match the saved revision; export leaves the
   manuscript unchanged. Unknown checks do not expose reviewed-draft approval.

Generated evidence and screenshots remain ignored under `.dsh-tmp/`.
This smoke makes no model request and does not modify the desktop profile.
Rebuilding updates disk assets; an already-running Desktop process may still
hold old loaded modules until its next reload/restart.

## Follow-up verification on 2026-10-05

The new adapter was subsequently tested with actual `deepseek-official /
deepseek-flash` streams through the installed Host credential service. The
`--live-model` smoke uses a separate `.dsh-tmp/model-home`, points only the Host
credentials plugin at the existing credential store, and checks its byte hash
before/after. It does not parse keys, copy them into fixtures, change the desktop
profile, or log a credential. All academic materials are TEST_ONLY fixtures.

Verified actual UI paths: a cited whole-document candidate is generated and
rejected with unchanged manuscript; the second duplicate paragraph is shortened
and accepted with its citation retained and first paragraph untouched; an active
model stage is cancelled, its terminal checkpoint is saved, and the manuscript
remains unchanged. This establishes these execution boundaries, not general
academic quality or all three paper types.

The first real candidate exposed bare cite keys instead of parsed Markdown
tokens. This now fails the stage output contract. One repair is allowed; continued
invalid citations fail with no proposal. Source IDs' digits no longer create
false numeric-fact warnings. Accept no longer re-caches an intermediate old editor
state as a stale manual buffer. Consumed/cancelled plans leave the confirmation UI.
Unimplemented section generation fails explicitly rather than treating section
output as a whole-document replacement.

`src/core/requirements/requirements.ts` extracts conservative candidates only
from actually parsed selected blocks, requires origin locators, and leaves
counting policy unknown until user confirmation. Disagreeing numeric constraints
block confirmation; an operator's reasoned choice archives both originals and
still requires confirmation of the selected requirement. Forbidden AI policies
remain hard constraints. Project Profile/memory editing uses the authenticated
API and original hash. Test coverage increased to 92 automated cases.

The workbench now has Overview / Research / Outline / Draft / Review / Export
tabs. Kept-mounted panes preserve unsaved manuscript across tab switches; roving
keyboard focus, explicit focus rings and narrow layouts are exercised by the
updated no-model installed smoke. Browser-reload durability is still pending.

## Remaining acceptance work

All three paper types end to end;
section generation and claim anchors; model-assisted review; reviewed-draft
readiness; private Skill resource locking; online research; requirements and
full editable requirements/history and Profile/memory provenance; complete run
recovery; durable unsaved-buffer restoration; approved image packaging;
complete P0/AT matrix.
