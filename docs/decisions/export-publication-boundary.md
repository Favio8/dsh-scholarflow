# Export publication boundary

Implemented 2026-10-05 for SF-025/SF-032, PRD §9.6 and SPEC §26.

Copying a manuscript unchanged into an export directory used to retain local
relative link addresses, which could refer to a different target after moving.
Preflight now refuses unbundled local resources and unsupported URL schemes,
including reference definitions. It does not read or package the link targets.
Public HTTP(S)/mailto URLs and in-document anchors retain their original bytes.
Inline and referenced images remain explicitly unsupported, as does raw HTML
whose resource addresses have not been verified. Optional image packaging is not
represented as a completed capability.

Publication checks reject obvious credential assignments, conventional secret-key
strings, Windows/UNC paths and user-home paths in the manuscript. Public URLs
with userinfo or recognized credential/signature query parameters also fail.
The exact raw fields destined for the cited bibliography are checked before
Citation.js escapes them, and the resulting bibliography and all three final
artifacts are checked again before transaction publication. Uncited Sources and
unselected raw materials stay excluded. This pattern-based check is not a claim
that every arbitrary user-defined secret can be recognized.

Refusal does not rewrite the manuscript, alter a Source, create a delivery or
change existing archived deliveries. The operator must make an explicit saved
edit and preview the new version. No linked file is fetched and no provider call
is made by these checks. The mandatory exported files remain paper.md,
references.bib and quality-report.md with their actual immutable byte hashes.

Three integration tests exercise relative/reference URL failures, referenced
images/HTML, path and credential failures in the manuscript and cited metadata,
uncited metadata exclusion and byte-identical BOM/CRLF public exports. The first
bibliography privacy test caught escaped paths bypassing a post-format scan; raw
export-field validation fixed that before publication. All 308 independent tests
and type checking pass. The installed Host test also rejects a relative raw-file
link, a private reference definition and a credential URL through the actual UI,
preserving body/ledger bytes and an earlier archived delivery on each refusal.
