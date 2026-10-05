# ScholarFlow 1.0.0 runtime validation

Date: 2026-10-05. Product acceptance and the 35 P0 / 28 AT mapping live in the
parent documentation workspace, `../docs/v1-acceptance-2026-10-05.md`.
Those documents remain outside this package; the frozen PRD/SPEC were not changed.

The supported tested runtime is Windows 11, DSH Desktop 0.2.0-rc.2,
Electron 44 and Host Node 24.18.1. Other OS/runtime versions have not been tested.
DeepSeek text requests use the current Host Session model and credential service.
The installed SDK retry audit is in [provider-retry-audit.md](decisions/provider-retry-audit.md).

The original browser boot failure was caused by a CommonJS bundle expecting
global `exports`. `scripts/build.mjs` provides local module/exports objects inside
the actual ModuleLoader factory. The browser contract and actual Electron
Desktop client/Host connection both pass. No DSH core files were patched.

## Consolidated evidence

| Verification | Result |
|---|---|
| Typecheck, build, unit/contracts/integration/fault tests | 343 passed; no failures/skips |
| Installed Host with real Crossref and public GitHub | Passed; no client errors |
| Ordinary model-invocable Skill catalog and concurrent A/B scope | Private Skills absent, forged project target refused, A bytes preserved |
| Keyboard preview/Escape | Actual initiating button regains focus |
| Native request killed while pending | One original charged call retained; no replay, refund or body change |
| Actual Electron Desktop | ScholarFlow client loaded and Host connected |
| Tarball install/remove/reboot | Passed; complete 18-file project tree preserved |
| Three real model teaching projects, five generated sections each | Passed: course 10/12, literature 6/12, research 9/12 original calls |

Reproduction scripts are `tests/e2e/installed-host-smoke.mjs`,
`installed-paper-types.mjs` and `installed-package-lifecycle.mjs`.
All test workspaces and metadata are under ignored `.dsh-tmp/`; exact native
inputs/results stay in their owning TEST_ONLY Session, not project diagnostics.
No keys or authenticated browser addresses are printed. Provider tests are
opt-in and incur bounded actual calls; fixture adapters are separately labelled.

The long cases use the original twelve-call allowance, frozen at initialization.
Course-paper used 10/12, including a refused two-attempt correction. The actual
accepted correction was reassessed by the provider; repetition in other sections
still failed, so the finding remains open. Literature-review used 6/12 and
research-paper 9/12, retaining two calls from its failed review run. Resume
reuses accepted chapters and same-version reports; failed calls remain charged.

Delivery is a same-version Markdown/BibTeX/quality-report working draft.
Unverified source identities, unknown checks, missing experiments and outstanding
issues remain visible. A reviewed-draft request is refused when its gates fail.
Passing plugin acceptance does not make TEST_ONLY teaching papers publishable.

This package reads text PDF/DOCX materials, supports Markdown manuscripts and
does not claim OCR, a DOCX/PDF full editor or optional image export support.
Crossref supplies metadata, not full text. Missing Retry-After causes an explicit
batch pause. Skills are static instructions/resources; bundled scripts do not run.
The private library never registers an ordinary global Skill provider.

The source-map paths are relative, build/dependency/test data are excluded from
Git, and the tarball includes its README-linked explanatory documentation.
The source implementation checkpoint is `e6c2ade`. All three cases completed,
their frozen summary inputs matched the actually accepted preceding body, and
all frozen model inputs excluded unselected teaching material. Credential bytes
remained unchanged. Package SHA-256 is recorded outside the tarball in the parent
acceptance record to avoid a self-referential archive hash.
