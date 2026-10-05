# Paper editor workspace and derived deliveries

Date: 2026-10-05. Requirement: parent `docs/ui-refinement-2026-10-05.md`, UI-06-A–G, approved mockup and user-confirmed implementation plan.

## Interaction and source of truth

The current ScholarFlow Session keeps its existing native DSH dock and header components. The project surface owns a compact paper header, editor view switch and paper tools menu. The initial view is Draft/split. Tool surfaces and the Draft remain mounted while hidden, preserving local editor buffers, run controls and pending proposals.

Markdown remains the sole manuscript truth. Format selection chooses derived layout/export, not a new editable `.tex` or `.docx` source. Preview and statistics derive from the current manual buffer; AI selections continue to require the saved revision. Unsaved exports offer save-and-export or the saved snapshot. Explicit save and the existing scratch recovery mechanisms remain authoritative; a buffered edit is never labelled saved.

Project presentation updates use the current config hash, ledger revision and project writer lock. YAML comments and unrelated keys are preserved. Editing title, type and language does not rewrite manuscript bytes, materials, project Profiles or existing research; reviews become stale and pipeline dependency hashes reject superseded plans.

## Rendering and export

KaTeX renders math AST nodes as protected preview content. Fonts and scoped styles are bundled locally. Paper-like browser preview has no invented pagination or PDF compilation status.

The existing AST drives DOCX and LaTeX output. DOCX uses `docx`, preserves TeX math text, and includes numbered cited references. LaTeX uses ctex for Chinese, actual citation keys and `references.bib`. Every delivery also contains the Markdown source and quality report. Source/privacy publication checks precede conversion.

The Host preflight binds the format into its digest and returns converter-specific notes. DOCX is stored as real OOXML bytes in the new delivery directory; a create-only Host capability retains the current Session policy, writer lock and fixed export path boundary. Transaction journals optionally encode byte images as base64 and hash decoded bytes, so existing text journals remain readable and incomplete binary publication participates in recovery. Download responses add encoding/MIME metadata while retaining text fields for older text deliveries. The UI downloads individual files or a ZIP containing the same delivery manifest and artifacts.

## Delivery status

User explicitly requested no tests: no new tests, typecheck, browser automation or runtime/model verification were run for this change. Building the installed plugin is packaging only. Earlier UI/core verification records do not validate these additions. The binary writer follows the installed rc.2 checked-target seam already used for static Skill resource publication; its new export behavior is implemented but has not been exercised in this round.
