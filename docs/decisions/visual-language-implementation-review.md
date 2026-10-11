# Visual-language implementation review

Date: 2026-10-11. Authority: [02 visual-language PRD](../../../docs/ui-design-language/02-design-language-prd.md), especially the approved decisions in section 10, implementation sequence in section 11 and conflict priority in section 13. This is an implementation record, not a replacement PRD/SPEC baseline.

The code implements warm paper and ink, content/interface font separation, the seven font roles, shared controls, flatter content surfaces, SVG actions, shared empty/loading/error layouts, restrained motion and the light manuscript page in a dark shell. The final corrections reserve space for the drawn select arrow and full format label, restore the zoom controls' compact padding, and wrap the header/captions in narrow panes (`src/client/theme/tokens.ts:116–119,131,156`).

| Requirement | Implemented evidence and current result |
|---|---|
| SF-121 | Serif selector allowlist and computed-size checks; no serif below 15px. Windows SimSun/YaHei probe differs by 5,175 pixels. |
| SF-122 | Zero literal font-size declarations; seven font tokens, all observed in rendered surfaces. |
| SF-123 | Preview heading ratios checked against actual `headingSizes()` for body sizes 10, 12 and 14; within the approved tolerance. |
| SF-124 | Warm neutrals and brighter card than shell; appearance audit reports zero contrast failures across its registered coverage in both themes. |
| SF-125 | Ink-blue accent family; former violet wash folded into that family. Semantic marks/washes retain their specified exceptions. |
| SF-126 | Padding declaration text reduced to 19 kinds. Reading maximum enforced; the narrow-pane minimum remains constrained as recorded below. |
| SF-127 | Owned content has at most two painted ancestor layers; radius checks use the approved mapping and explicit exemptions. |
| SF-128 | One primary base definition, four variants and three sizes with state probes; selects use the shared drawn arrow. All three format labels and header/caption controls fit the initialized workbench at 320/420/720/1440px in both themes. Material content cards use automatic height; populated/busy seats and native Desktop checks prove filename/status containment. `!important` occurrences 54 → 42. |
| SF-129 | Text operation glyph count zero; covered SVGs use 16/20px and stroke 1.6. |
| SF-130 | Actual empty/loading/error/boundary component seats render. The boundary's existing ordinary-conversation escape remains an explicit interaction exception. |
| SF-131 | Paper entrance/exit and easing tokens implemented; hover position probes show no movement. Mark reduced-motion pixel change remains zero. |
| SF-132 | Host alias inventory recorded by surface; owned page content uses ScholarFlow page roles. The AT-132/Q5 wording discrepancy is recorded below. |
| SF-133 | First separate commit expands the registry and activates the real dark attribute. Current audit has 20 registered surfaces, coverage complete and actual Host theme activation. Populated and busy material seats close the gap identified by the user's screenshot. |
| SF-134 | Mirror alignment offset zero; wrap/cache invalidation checks pass. Browser typing p95 22.4ms, native Desktop 23.5ms; current client growth 0.410%. See the performance ADR. |
| SF-135 | Split seat checks the themed source and fixed light page roles, warm border colours, flat source and downward page shadow. Both native Desktop themes captured. |

Build and typecheck passed; all 610 existing tests passed. The current render run produced 58 captures with zero reported problems. The current appearance audit reported zero problems. Original markup seats are CSS/measurement rendering evidence; added React seats and installed-Host checks are identified separately in the SF-133 record. These checks do not claim every conditional product state has been exercised.

The earlier full review evidence is archived under `.dsh-tmp/visual-language-baseline/2026-10-11-final/`:
`render.json`, `appearance.json`, `performance-browser.json`, `performance-desktop.json`,
`desktop-final-interactions.json`, `native-workspace-light.png` and `native-workspace-dark.png`.
The final initialized-workbench layout journal and captures are stored in `initialized-layout/`.
Its eight viewport/theme cases report no document overflow, no header/caption button
clipping and enough text width for Markdown, LaTeX and Word. This adds actual initialized
Host coverage beyond the wizard and rendering fixtures. Earlier full/Desktop interaction
and typing journals are retained separately; they precede the final CSS-only correction,
and no new typing performance number is claimed for it. Report timestamps identify each run.

The subsequent material-card correction and current render/appearance/native-material
evidence are archived under `.dsh-tmp/visual-language-baseline/2026-10-11-material-cards/`.
See [material-card regression record](./material-card-content-layout.md). The native material
run uses actual registered/parsed TEST_ONLY files; the React seats also exercise source
records and all four material parse statuses. It does not replace full-session human acceptance.

Unresolved or explicitly subordinate items:

- SF-126's 34-character lower reading-width bound cannot hold inside a narrower pane. Per section 13, AT-41's no-overflow requirement wins. Reports expose `constrainedByPane`; the lower bound remains unmet in those cases, without reducing body font size.
- The error boundary retains retry plus the existing ordinary-conversation escape. Section 13's behavior/safety priority wins over the single-action visual pattern; the gate records total actions separately.
- AT-132 says page background is unchanged across themes, while section 10 Q5 supplies two near-white values. Implementation uses the sole approved section 10 values; this wording discrepancy awaits user-owned baseline incorporation.
- U-15 (Host UI primitive reuse) remains open and is not waived by this work.

Human acceptance is pending. Section 9 requires the user to inspect a real DSH session:
paper warmth next to Host chrome, serif tone, body size, the bright page in dark mode,
recognizably fillable fields and overall identity. Screenshots do not replace that step.
No push has been authorized or performed. Parent `ScholarFlow_PRD_*.md` and
`ScholarFlow_Design_SPEC_*.md` files were not modified; baseline incorporation remains
the user's decision. No dependencies or webfonts were added.
