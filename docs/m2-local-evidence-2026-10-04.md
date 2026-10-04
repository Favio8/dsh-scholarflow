# Local evidence chain verification — 2026-10-04

This is implementation evidence for the local-material vertical slice of SPEC
v1.0, not a claim that all M2 requirements or V1 acceptance cases are complete.

The native UI supports metadata-only directory listing, explicit selection and
registration, bounded parsing, source metadata, locator-specific quotation
confirmation, claims with explicit support scope and rationale, and a confirmed
small outline. All persist through the project ledger and transaction store.

TXT/MD text retains original 1-based line positions and Markdown source markers.
PDF uses PDF.js 6.3.289, physical 1-based pages and a default initial 20-page range;
scanned/no-text pages do not yield invented OCR text. DOCX uses Mammoth 1.13.0
paragraph traversal, including empty paragraphs in the position index. Output HTML
is discarded. Images, formula semantics and table structure remain unverified.

Parsing runs outside the project lock in a worker limited to 128 MiB old-generation
heap and 20 seconds. Material input is capped at 50 MiB. DOCX preflight caps ZIP
entries at 250, each declared entry at 10 MiB, total declared uncompressed bytes at
50 MiB, and compression ratios at 100 with a 64 KiB small-entry floor. Actual XML
streams are bounded, DTD/entities are rejected and XML opening tokens capped at
200,000. Native/external allocations are not an absolute process memory cap.
Mammoth external-file access and embedded style maps are disabled. Worker output
logs are not forwarded to Host logs, avoiding inadvertent source-fragment logging.

References consulted: [PDF.js](https://github.com/mozilla/pdf.js),
[Mammoth security and transform contracts](https://github.com/mwilliamson/mammoth.js),
[JSZip container limitations](https://github.com/Stuk/jszip/blob/main/documentation/limitations.md).
The shipped package source and types were checked alongside these upstream docs.

The immutable cache key contains the material byte hash, parser version and actual
range set. Re-parsing changed source bytes marks old evidence and dependent claims
stale, retaining their original quotations. Cache deletion does not delete ledger
evidence. Credential paths and canonical aliases into credential/owned output
directories are denied at the Host read boundary.

A source starts with `identity.status: unverified`. Parsing its text does not prove
publication identity. Metadata-only sources cannot become located quotation
evidence. Evidence confirmation checks the actual block/locator, exact excerpt and
current source hash. Claim support requires a separately stated relation, scope and
rationale; it is a user judgment, not an automated proof of truth.

Validation: 62 passing tests and typecheck, plus the real installed DSH
0.2.0-rc.2 smoke in an isolated TEST_ONLY DSH_HOME. The native test registers and
parses actual fixture bytes, confirms evidence, a scoped claim and an outline,
restarts the Host and reads the same persisted objects. The raw fixture remains
byte-identical. See `tests/e2e/installed-host-smoke.mjs` and `.dsh-tmp/g0-smoke.json`.

Remaining work: full requirement extraction/conflict confirmation, online provider
search and independent identity verification, model-supported evidence proposals,
complete outline editing, full acceptance matrix and the drafting/edit/export
portion of the vertical slice. Corpus fixtures are explicitly TEST_ONLY and are
never presented as real online search results or published research.
