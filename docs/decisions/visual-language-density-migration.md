# Visual language density migration

Date: 2026-10-11. Implements SF-126/127/128 from the approved visual-language PRD.

Counts use padding declaration text; computed lengths are recorded separately. Source textarea and gutter padding retain their measured values. Editor font and line-height inputs are unchanged.

| Previous declaration | Migrated declaration |
|---|---|
| `0` | `0` |
| `0 0 0 var(--sf-space-3)` | `0` |
| `0 0 0 var(--sf-space-4)` | `0` |
| `0 var(--sf-space-1)` | `0 var(--sf-space-2)` |
| `0 var(--sf-space-2)` | `0 var(--sf-space-2)` |
| `0 var(--sf-space-3)` | `0 var(--sf-space-3)` |
| `0 var(--sf-space-4)` | `0 var(--sf-space-4)` |
| `0 var(--sf-space-5)` | `0 var(--sf-space-4)` |
| `0!important` | `0` |
| `10px` | `var(--sf-space-2)` |
| `20px 10px 20px 0` | `20px 10px 20px 0` |
| `20px 18px` | `20px 18px` |
| `22px 18px` | `var(--sf-space-4) var(--sf-space-5)` |
| `24` | `'var(--sf-space-5)'` |
| `28px 24px` | `var(--sf-space-4) var(--sf-space-5)` |
| `42px 38px` | `var(--sf-space-5) var(--sf-space-6)` |
| `4px 0` | `var(--sf-space-2) 0` |
| `7px 9px` | `var(--sf-space-2)` |
| `var(--sf-space-1)` | `var(--sf-space-1)` |
| `var(--sf-space-1) 0` | `var(--sf-space-2) 0` |
| `var(--sf-space-1) 0 0` | `0` |
| `var(--sf-space-1) 0 var(--sf-space-1) var(--sf-space-2)` | `var(--sf-space-2) var(--sf-space-3)` |
| `var(--sf-space-1) var(--sf-space-2)` | `0 var(--sf-space-2)` |
| `var(--sf-space-1) var(--sf-space-2)!important` | `0 var(--sf-space-2)` |
| `var(--sf-space-1) var(--sf-space-3)` | `0 var(--sf-space-2)` |
| `var(--sf-space-2)` | `var(--sf-space-2)` |
| `var(--sf-space-2) 0` | `var(--sf-space-2) 0` |
| `var(--sf-space-2) 0!important` | `var(--sf-space-2) 0` |
| `var(--sf-space-2) var(--sf-space-3)` | `var(--sf-space-2) var(--sf-space-3)` |
| `var(--sf-space-2) var(--sf-space-3)!important` | `var(--sf-space-2) var(--sf-space-3)` |
| `var(--sf-space-2) var(--sf-space-4)` | `var(--sf-space-2) var(--sf-space-3)` |
| `var(--sf-space-2) var(--sf-space-5)` | `var(--sf-space-2) var(--sf-space-3)` |
| `var(--sf-space-2)!important` | `var(--sf-space-2)` |
| `var(--sf-space-3)` | `var(--sf-space-3)` |
| `var(--sf-space-3) 0` | `var(--sf-space-3) 0` |
| `var(--sf-space-3) var(--sf-space-4)` | `var(--sf-space-4) var(--sf-space-5)` |
| `var(--sf-space-4)` | `var(--sf-space-4)` |
| `var(--sf-space-4) 0` | `var(--sf-space-4) 0` |
| `var(--sf-space-4) var(--sf-space-3)` | `var(--sf-space-4) var(--sf-space-5)` |
| `var(--sf-space-4) var(--sf-space-5)` | `var(--sf-space-4) var(--sf-space-5)` |
| `var(--sf-space-4)!important` | `var(--sf-space-4)` |
| `var(--sf-space-5)` | `var(--sf-space-5)` |
| `var(--sf-space-5) 0` | `var(--sf-space-4) 0` |
| `var(--sf-space-5) var(--sf-space-3)` | `var(--sf-space-4) var(--sf-space-5)` |
| `var(--sf-space-5) var(--sf-space-5) var(--sf-space-7)` | `var(--sf-space-6)` |
| `var(--sf-space-5) var(--sf-space-6)` | `var(--sf-space-5) var(--sf-space-6)` |
| `var(--sf-space-6)` | `var(--sf-space-6)` |
| `var(--sf-space-6) var(--sf-space-5)` | `var(--sf-space-5) var(--sf-space-6)` |
| `var(--sf-space-hair) var(--sf-space-2)` | `0 var(--sf-space-2)` |
| `var(--sf-space-hair) var(--sf-space-2)!important` | `0 var(--sf-space-2)` |

Radius mapping: sm/md to control; lg/xl to surface; pill retained. Circular 50%, paper 0 and measurement-owned mark radius are explicit exemptions.

Borders have two roles: hairline dividers and control/surface edges. Shadow 1 belongs to paper and the primary action; shadow 2 to local menus; shadow 3 to modal overlays. Inner explanatory panels become typography and whitespace.

Buttons use primary/secondary/ghost/danger, with one primary base rule in THEME_CSS. The existing narrow/zoomed 44px minimum takes precedence over nominal control sizes.

The reading column uses the approved maximum measure. When the pane cannot fit the minimum measure, AT-41 no-overflow wins under PRD section 13; constrained measurements remain explicit in the report.

The container audit counts painted ancestors within the owned surface, including its root.
Interactive controls have their own AT-128 appearance contract and are not nested content
containers; source annotations retain their independent SF-089/090 measurement contract.
The native wizard is checked from the real project root so Host fixture wrappers cannot
hide an extra painted layer. Border roles are measured without treating Host shell ancestors
outside the owned project as ScholarFlow content containers.
Native tool factories and embedded native conversation content are explicitly excluded;
their UI remains owned by DSH, as required by SF-132.
