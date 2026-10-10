# One place for colour, density and the dark key

Date: 2026-10-08. Requirements: SF-088 / AT-88 in `dsh-scholarflow-ai/docs/ScholarFlow_PRD_v1.5.md`
and `ScholarFlow_Design_SPEC_v1.5.md`. Targets installed Windows DSH Desktop 0.2.0-rc.2.

## The problem, counted

The palette had grown by copy-paste, and the counts say how far:

| | HEAD `b7c6813` | after |
|---|---|---|
| `border-radius` declarations | 87 (17 distinct, **78 of them raw lengths**) | 86 (9 distinct, **0 raw lengths**) |
| `padding` / `padding-*` declarations | 176 (100 distinct values) | 175 (52 distinct values) |
| grey line, spellings of `#888*` | 100 occurrences, **6 spellings** | **0** |
| `var(--sf-space-*)` uses | 0 | 438 |
| `--sf-*` definitions under `src/client` | 32 | 113 |

Eight tokens the surfaces referenced were defined nowhere — `--sf-border-strong`, `--sf-focus-width`,
`--sf-radius-xl`, `--sf-space-5`, `--sf-scrim`, `--sf-shadow-3`, `--sf-surface`,
`--sf-selection-tint` — so each of those `var()` calls silently took whatever the declaration site
happened to carry. Four more (`--sf-caption-left`, `--sf-editor-font`, `--sf-editor-line`,
`--sf-overlay-space`) are set at runtime from measured geometry and stay that way.

The same duplication had produced a defect with consequences. The dark palette was keyed off
`@media (prefers-color-scheme: dark)` **inside a component**, while the host signals dark by setting
`data-ds-dark-theme` on the body. Those are not the same condition, and the case they disagree on is
the common one: dark chosen in the host, light OS. Measured on HEAD in a real Chromium, with the
host's own surface colours:

| HEAD, four combinations | accent-text | muted | danger | warn-text |
|---|---|---|---|---|
| light surface / light OS | 6.15:1 | 4.96:1 | 5.35:1 | 5.8:1 |
| **dark surface / light OS** (host dark, OS light) | **2.97:1** | **3.67:1** | **3.41:1** | **3.15:1** |
| dark surface / dark OS | 8.74:1 | 6.92:1 | 8.89:1 | 10.19:1 |
| **light surface / dark OS** | **2.09:1** | **2.64:1** | **2.05:1** | **1.79:1** |

Two of the four are below AA on every token, and both are the mismatched rows. After the change all
four rows are AA: 6.15 / 5.93 / 5.35 / 5.8 and 8.74 / 6.92 / 8.89 / 10.19, selected by the surface
rather than by the OS.

## One definition, injected where it is used

`src/client/theme/tokens.ts` now holds a single `THEME_CSS`: one `:root` block of 64 tokens and one
`body[data-ds-dark-theme]` block of 37 overrides, no new names in the dark block. It follows the
convention `motion/tokens.ts` already set, and for the same reason — the render gate extracts CSS
with `extractCss` (`/export const <name> = \`/` up to the first backtick), so the string must be pure
literal with zero interpolation. It is, so the token layer can be injected as its own `<style>` text
without breaking the gate.

All eight injection points carry it themselves (`plugin.tsx` ×6, `preset-picker.tsx`,
`text-prompt.tsx`), rather than relying on being nested inside another surface's stylesheet. A
surface that only ever renders inside the workbench looks fine either way; a surface the host mounts
on its own — a settings section, a portal, a dialog — got nothing. Repetition is safe: injecting the
same sheet twice is a no-op, measured by rendering the wizard with the sheet applied once and twice
(0/0/0 px on six frame heights, below).

The two blocks are literals and not `var(--dsw-alias-*)`. A custom property is substituted where it
is *declared* and the host defines its aliases on `body`, not on `:root`, so a `var()` inside `:root`
would always take its fallback and freeze the light value into the dark theme. Host aliases stay at
the use sites, where they do resolve.

## The dark key

`body[data-ds-dark-theme]` is the attribute the host sets for both a dark system preference and an
explicit dark choice, which is why one key now covers both and the OS no longer decides. There is no
`prefers-color-scheme` left under `src/client`.

The palette is not a filter over the light one: the accent's *text* role flips (`#2f5bc4` →
`#8fb3ff`), `--sf-muted` lifts, the soft tints become translucent, and the shadow stack darkens.
`--sf-surface` is `#fff` / `#151517`, matching the surface the probe measured, so a surface that only
gets this layer still has the right page colour.

## The scales, and what is deliberately off them

Space runs on the 8px step (`--sf-space-1..8`) plus a 2px `--sf-space-hair` for icon clusters; radius
has five steps; type has six sizes and three leadings. Kept out of the ladder, each because it is
measured rather than chosen:

- `--sf-editor-font` and `--sf-editor-line`, and the source pane's padding that aligns the gutter —
  the wrap gate measures them (40.0 rows wide, 137.0 rows narrow, gutter 1248/1248 and 3576/3576 px).
- `--sf-mark-band-radius` (3px) and `--sf-mark-band-opacity` — see below.
- `.sf-line-gutter`'s `18px` list indents and `flex: 0 0 18px` section index — sized to the marker
  glyphs next to them, and changing them moves text without any gate measuring the result, so they
  were left as they were rather than "rounded" to 16px.
- `PAPER_CSS` in `paper-workspace.tsx`, which simulates a sheet of paper: it stays white in both
  themes on purpose, and the intent is written at the top of the block.

Two kinds of accent tint, and the difference is measurable rather than stylistic: a `--sf-*-soft` is
a panel's own background, so it is opaque and is themed for contrast against the text it carries; a
`--sf-wash-*` and `--sf-selection-tint` sit *above* something that has to stay visible through them —
the rainbow band under a selection, the sweep over a status row — so they keep their alpha. Swapping
one for the other is invisible in a screenshot until the thing underneath disappears.

The accent is also two roles, not one colour: `--sf-accent` (`#3f68d8`) is a **fill** and carries
white text at 5.02:1; `--sf-accent-text` is the **text** role and flips per theme (`#2f5bc4` light,
`#8fb3ff` dark). Soft accent backgrounds therefore only ever carry `--sf-accent-text`, never
`--sf-accent` — the latter measures 4.48:1 on `#eef2fd` and 4.28:1 on `#e6edfc`, both below 4.5.

## What the review caught

The first pass replaced literals with `var(--sf-*)` in three places that had never been given the
token layer — `plugin.tsx`'s settings section, `preset-picker.tsx`, `text-prompt.tsx` — turning a
literal into a dangling reference. The tokens exist, but not in those surfaces' own subtree, so those
three surfaces lost the values entirely. This is the failure mode the change itself was meant to
remove, reintroduced by the change.

Nobody's existing check could have caught it: `tests/contracts/client-boot.test.ts` asserts that
`render(component)` returns a string and does not look inside the `<style>`; the render gate extracts
and renders `THEME_CSS`, `WIZARD_CSS`, `PRESET_CSS`, `PAPER_CSS` and `RANGE_MARK_CSS` and **never**
renders `plugin.tsx`'s own CSS; and the e2e acceptance script opens the caption entry, not the
settings section. It was found by reading the diff adversarially, not by a gate.

The fix injects the sheet in all three, rather than adding a fallback to each `var()`. A fallback
would have been shorter and wrong: it would pin the light value into the dark theme, which is exactly
the defect the token layer exists to prevent.

## The band radius is measured, not stepped

Changing `.sf-range-band`'s corner radius from its 3px literal to `var(--sf-radius-sm)` (4px) moved
two recorded gate numbers: within-row colour spread **173 → 172** and the difference against an
unmarked row **128.8 → 128.4**, at 1060px, with the other twelve ink values unchanged in the same
run. Cause: the mark gate samples a strip across the **top edge** of the band, so the corner radius
is inside the measured span and a wider corner rounds off more of the rainbow.

Reverting just that one declaration reproduced the HEAD numbers exactly (173 / 128.8, and
172 / 260.6 narrow), which is what identified it as the only variable. The value now lives in the
token layer as `--sf-mark-band-radius: 3px` — in the same block as `--sf-mark-band-opacity`, off the
ladder, and the reason is in the file header. "Do not regress the measurement" outranked "everything
on the ladder", and the two constants that the gate measures were already living here.

## Small targets

`pnpm audit:appearance` was reporting three sub-28px hit boxes in each theme — the three wizard step
buttons, `89×25`. They are `padding: 0` flex buttons whose only content is the numbered badge, so the
badge's `width: 25px; height: 25px` was the whole hit area. The badge is now `var(--sf-space-6)`
(32px), and the audit reports no target under its floor in either theme. Measured before and after
with the same script: `smallTargets` 3 → **0** (light and dark), `contrastChecked` 51 unchanged,
`contrastFailures` empty, `clipped` and `tinyText` empty, `zoom200` all zero, `narrowOverflow` 0.

## The wizard got slightly taller

The density steps are now ladder values, so the wizard's own geometry moved. Measured with one probe
that renders each sheet over the same markup, so the two columns are the same harness:

| surface | HEAD sheet | this sheet | Δ |
|---|---|---|---|
| step 1, 1100px | 830×1091 | 830×1122 | +31 |
| step 2, 1100px | 830×629 | 830×638 | +9 |
| step 3, 1100px | 830×891 | 830×928 | +37 |
| step 1, 420px | 380×1435 | 380×1450 | +15 |
| step 2, 420px | 380×651 | 380×672 | +21 |
| step 3, 420px | 380×1352 | 380×1476 | +124 |

Widths are unchanged at both column widths. The probe's control arms are what make the attribution
safe: this sheet applied over this sheet is 0/0/0 (idempotent), the HEAD sheet over HEAD is 0/0/0,
and the HEAD sheet over this markup returns all six frames to the HEAD column exactly — so the whole
delta is the sheet, not the measure. The contributors visible in the wizard's own rules are the step
badge (25 → 32px) and the step strip's padding/gap (20 and 22 → 24px); the probe measures the total,
not each contributor.

## Evidence

Reproducible without a host, from the repository root:

- `node scripts/build.mjs`, `tsc --noEmit`, the four test globs, `node scripts/render-surfaces.mjs`,
  `node scripts/audit-appearance.mjs` — build 0, typecheck 0, **460/460**, render **14/14**,
  appearance exit 0.
- `node scripts/render-surfaces.mjs` is the readability gate for the mark: 40 bands and spread 173
  at 1060px, 137 bands and spread 172 at 420px, text contrast 6.8:1 and 5.2:1 (floor 4.5:1), no
  overflow, and the same 40.0 / 137.0 wrapped rows as HEAD.
- The dark matrix and the wizard geometry come from two read-only probes over the real CSS, with the
  host's own surface colours; the numbers in the tables above are their output.

Not verified, and still owed from the previous version: the render harness's host stand-in is
light-only (`scripts/render-surfaces.mjs` hard-codes one set of `--dsw-alias-*` values for every
theme), so the dark palette is evidenced by the probe rather than by the render gate — extending the
gate with a dark surface is not done here. AT-88's zoom, narrow-column and view-switching cases and
the installed-host pass remain unrun, as do AT-71/AT-72/AT-73 and the typing baseline that v1.4 left
void. Two environment boundaries are likewise unmeasured: whether the host's settings modal mounts in
the same document as the caption overlay, and behaviour on non-win32 runtimes. No pass is claimed for
any of these.

The requirement itself was written **after** the change rather than before it, against PRD v1.5 §7.1.
It is recorded as a revision rather than presented as the plan, in PRD v1.5 §9 `1.5 r6` and SPEC v1.5
§9 `1.5 r6`, and §7.1 still says not to work this way.
