# Coverage review scope and evidence

Date: 2026-10-10. Baseline: [PRD v1.9](../../../docs/ScholarFlow_PRD_v1.9.md), [SPEC v1.9](../../../docs/ScholarFlow_Design_SPEC_v1.9.md), SF-107–108 / AT-107–108.

## Defect and cause

The installed host's completed review responses included requirements about cover, pagination and delivery with empty section IDs. The previous `assessOutline` invariant required every covered/partial requirement to reference a chapter. It rejected these valid non-chapter requirements, discarded an otherwise usable outline and exposed `OUTLINE_REVIEW_INVALID` with `{}`. Fixing JSON code fences did not address this independent error.

The review context also lacked configured cover and typography facts. A task summary asserting a cover or page count is not evidence of configured settings or actual pagination.

## Implementation

The model identifies each requirement's scope: sections, document, submission, or unclassified. No task title, keyword or fixed chapter template determines this scope. The host supplies the actual read-only document plan, excluding personal cover fields. Chapter coverage still requires real IDs. Document coverage references allowlisted configured fields; actual pagination and submission are always pending at this stage. Legacy empty nonmissing references become unclassified/pending rather than receiving invented IDs or a fabricated pass. Genuine missing/partial content remains a visible gap.

Review and candidate projection retain identical statuses. The wizard separates pending checks from chapter gaps and labels coverage as model assessment. Old persisted candidates remain parseable; historical records are not rewritten.

Unknown/duplicate IDs, missing chapter references in explicitly chapter-scoped positive claims and missing review items receive one bounded review contract repair. It does not regenerate a valid outline or soften negative semantic/source judgments. Persistent failure includes operation, affected item and field paths.

## Evidence and limits

Three recent completed real review returns were replayed from compressed installed-host audit records in memory, with no paid requests and no private payload copied into the repository. All three passed the corrected contract: 17/16/19 requirements respectively, with 4/2/2 pending items and 6/6/7 remaining gaps. Passing the contract does not mean those outlines satisfied all semantic requirements.

The full suite passes 580/580 tests; build and typecheck pass. Unit and controller cases cover mixed chapter/cover/length/pages/submission, legacy empty references, unknown fields/IDs, bounded repair and retained diagnostic details. Browser fixtures are explicitly `TEST_ONLY`; real provider quality and actual pagination are separate checks.

Two standalone browser attempts exposed fixture errors (an unnormalised brief and candidate metadata passed to the strict generation schema). They are not product failures or successful acceptance results. Both fixtures were corrected; verification then moved to the installed-host interface with isolated workspace and controlled model responses.

The installed-host run passes: one outline request, legacy empty references shown as pending, deferred pagination/submission separated from a real chapter gap, unchanged structure before adoption, nine adopted model-proposed rows and an enabled creation action. Four candidate and six adopted-structure layouts (light/dark, wide/narrow) have no horizontal overflow or contrast failures. Evidence: `.dsh-tmp/scoped-coverage-host.log`, `.dsh-tmp/outline-host-report.json`, `.dsh-tmp/scoped-coverage-host-{light,dark}-{1440,390}.png`. These are controlled responses in the real installed interface, not paid model acceptance or proof of full manuscript generation.
