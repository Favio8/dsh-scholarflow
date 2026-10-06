# Continuous writing and co-writing

Date: 2026-10-06. Implements the user-approved UI-08 change in the parent design workspace. This change supersedes the old per-stage manual preparation flow for newly created papers.

## Entry and authorization

The native ScholarFlow preset opens a three-page wizard. Choosing it grants no file creation or model writing by itself. The final “创建论文并开始撰写” action confirms requirements, selected materials, structure, output directories and the first-draft job. A planned job and pointer are included in the initialization transaction. Wizard drafts stay in client storage until creation. Existing projects do not require reinitialization.

The native preset seat is wrapped through the public Slot registry; the original component, injection and locale remain intact. The right sidebar stays under native DSH ownership and opens only on an explicit chat action. Native New Session navigation retracts the workbench even when DSH reuses a blank session. No core files are patched.

2026-10-06 startup correction: the wrapper and caption shortcut inspect the public `slots.entries()` registration ledger. In the installed rc.2 source (`@deepseek-ai/dsh-client-ui-slots/lib/index.js`, `SlotCore.entriesOfSlot`), `entriesOfSlot()` exposes only the winning entry in this single slot. Looking for the native seat through that projection after shadowing it alternated wrapper disposal and registration on every queued slot notification, starving startup. Reading the ledger preserves the same native entry identity while its wrapper wins and stops that cycle. This correction is based on source inspection; no runtime or automated tests were performed.

2026-10-06 RPC correction: the full-text gateway imports HTTPS `request` as `httpsRequest`. The previous top-level name caused esbuild to rename Remote method parameters to `request2` across the host bundle. DSH rc.2 source-mode discovery (`@deepseek-ai/dsh-api-gateway/lib/index.js`) reflects emitted parameter names using `Function.prototype.toString`; the client sends `{ request }`, so the renamed field was rejected before `project.inspect` or other handlers could execute. The distinct transport name preserves the existing RPC contract without changing clients or DSH core. Build/packaging and artifact inspection are separate from runtime validation; no tests are added or run.

## Persistent writing

`writing/requirements.json` holds the shared creation specification; `writing/tasks/` holds the job and checkpoints. Core coordinates material parsing, evidence selection, outline planning, existing controlled section generation, proposal publication and review. It does not create a second Agent Loop. Paid call attempts stay charged across interruption; an explicit budget continuation extends allowance instead of erasing usage. Pause stops after the current operation. Questions are answered in the center pane; resume after application restart is explicit.

Each generated section is automatically applied only while the authorized document version remains current and no dirty editor buffer exists. Human edits interrupt automatic application. Generated candidates remain available for explicit adoption or rejection. Later chat and editor modifications use immutable suggestions tied to the live editing buffer. Acceptance changes the buffer; saving uses the existing document transaction. Unknown citations are rejected, while numeric/qualifier and citation changes are displayed for review. The native chat tool can propose changes but cannot accept them.

## Public full text

[OpenAlex authentication](https://help.openalex.org/api/authentication/) and [locations](https://help.openalex.org/data/locations/) support the approved anonymous open-access path. Search results are cached, DOI identity is checked through the existing Crossref provider, and alternative public locations are tried. Metadata registration never implies full-text acquisition.

The pinned DSH `web.fetch` supports text responses and rejects binary PDF. A plugin-owned Host gateway therefore downloads anonymous HTTPS bytes with pinned public DNS, bounded redirects, size and cancellation. It sends no credentials or browser cookies. Bytes remain in the project cache, with source URL/version/hash. PDF uses the existing worker; HTML uses [Readability](https://github.com/mozilla/readability) and [linkedom](https://github.com/WebReflection/linkedom). Only actual parsed content supplies located evidence. The automatic paper path requests all PDF text pages, while existing manual range parsing retains its contract. Parser time, size, image/OCR and structure limitations remain explicit.

## Interface and delivery

Default editing remains Markdown plus live preview. Compact requirements, materials/references and manuscript versions replace the large stage menu; review issues appear as document markers and an on-demand panel. The default-format export button performs the existing preflight and snapshot creation, then downloads the chosen real `.docx`, `.tex` or `.md`. LaTeX also supplies its BibTeX file. Full bundles and quality reports remain in delivery history; unsaved edits retain the explicit saved-version choice.

## Delivery evidence

Per explicit user instruction, this implementation adds/runs no tests, type checking, runtime/model smoke checks or UI automation. Build and packaging are performed separately; compilation is not a claim of functional validation. Old validation documents describe earlier revisions and do not validate UI-08.
