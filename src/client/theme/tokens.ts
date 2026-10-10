/**
 * One place for colour, density and elevation (SPEC v1.5 §8). Surfaces read these tokens instead
 * of carrying their own hex values, so a colour or a spacing step is decided once.
 *
 * The two blocks below are literals rather than `var(--dsw-alias-…)` references on purpose: a
 * custom property is substituted where it is *declared*, and the host defines its alias tokens on
 * `body`, not on `:root`. A `var()` inside `:root` would therefore always take its fallback and
 * freeze the light value into the dark theme. Host aliases stay at the use sites, where they do
 * resolve; this layer covers what used to be a literal.
 *
 * Dark is keyed off `body[data-ds-dark-theme]`, the attribute the host sets for both a dark system
 * preference and an explicit dark theme choice (`prefers-color-scheme` only covers the first, which
 * is why an explicitly dark workbench used to keep the light palette). Every value below is checked
 * for ≥ 4.5:1 against the surface it is used on, in both themes.
 *
 * Scales: space runs on the 8px step (plus a 2px hairline for icon clusters), radius has five
 * steps, type has six sizes and three leadings. The editor metrics (`--sf-editor-font`,
 * `--sf-editor-line`) and the source padding that aligns the gutter are deliberately not here:
 * the wrap gate measures them.
 *
 * The mark chip's radius is here but off the ladder: the chip is the paper the gradient glyphs sit
 * on, and a corner that cuts into a glyph would put that glyph's pixels on the pane's own background
 * instead of on paper, so it is set by the measurement rather than by the radius scale.
 *
 * Two kinds of accent tint, and the difference is measurable: a `--sf-*-soft` is a panel's own
 * background, so it is opaque and themed for contrast against the text it carries. A `--sf-wash-*`
 * and the selection tint sit *above* something that has to stay visible through them — the rainbow
 * band behind a selection, the sweep passing over a status row — so they keep an alpha channel.
 * Swapping one for the other is invisible in a screenshot until the thing underneath disappears.
 *
 * Visual-language colours follow the approved decisions in design-language PRD §10.
 * The manuscript page keeps its own near-white paper and light ink in the dark shell.
 * Page-scoped aliases below make that exception explicit without changing the Host theme.
 *
 * The mark's gradient, period and paper are one set for both themes on purpose (SPEC v1.6 §8): the
 * gradient is carried by glyphs on paper in both panes — the preview's paper page and the source
 * pane's paper chip — so the host theme never enters the glyph contrast calculation, and a dark
 * override would only split the two panes back into two palettes. Every stop is dark enough to read
 * on that paper (worst measured 4.9:1, gate 4.5:1); the band-era stops were bright and measured
 * 1.6:1, which is why the mark moved onto glyphs in the first place. The period lives here rather
 * than in motion/tokens.ts because it is a geometry of the background image, not a duration, and it
 * is the smallest value that still fits one whole cycle inside the narrowest pane the gate measures
 * — a line narrower than the period would show a slice of the rainbow instead of all of it.
 */
export const THEME_CSS = `:root{--sf-paper:#fbf9f5;--sf-text:#1f1c17;--sf-muted:#6b6157;--sf-text-faint:#756b5f;
--sf-border:rgba(31,28,23,.13);--sf-border-soft:rgba(31,28,23,.08);--sf-border-strong:rgba(31,28,23,.28);--sf-fill:rgba(31,28,23,.04);--sf-fill-strong:rgba(31,28,23,.08);--sf-fill-sunken:rgba(31,28,23,.03);
--sf-accent:#2d55a8;--sf-accent-text:#2d55a8;--sf-accent-soft:#edf1f9;--sf-accent-soft-strong:#dfe7f5;--sf-accent-border:#c2cfea;--sf-on-accent:#fffdf9;
--sf-selection-tint:rgba(45,85,168,.1);--sf-wash-accent:rgba(45,85,168,.18);--sf-wash-accent-faint:rgba(45,85,168,.05);--sf-wash-accent-strong:rgba(45,85,168,.26);--sf-wash-violet:var(--sf-wash-accent-strong);--sf-wash-ok:rgba(60,163,111,.18);
--sf-danger:#b04a4a;--sf-danger-soft:#fdeeee;--sf-danger-border:#f0cccc;
--sf-ok:#2f7d52;--sf-ok-soft:#eef7f2;--sf-ok-border:#bfe0cd;
--sf-warn-text:#8a5c15;--sf-warn-soft:#fdf4e3;--sf-warn-border:#eed9ae;
--sf-surface:#fffdf9;--sf-surface-2:#f5f1e9;--sf-hover:#f2ede3;
--sf-page-bg:#fbf9f5;--sf-page-text:#1f1c17;--sf-page-muted:#6b6157;--sf-page-faint:#756b5f;--sf-page-accent:#2d55a8;--sf-page-border:rgba(31,28,23,.13);--sf-page-border-soft:rgba(31,28,23,.08);--sf-page-border-strong:rgba(31,28,23,.28);
--sf-scrim:rgba(31,28,23,.35);
--sf-shadow-1:0 1px 2px rgba(31,28,23,.06),0 1px 3px rgba(31,28,23,.07);
--sf-shadow-2:0 6px 20px rgba(31,28,23,.10),0 2px 6px rgba(31,28,23,.06);
--sf-shadow-3:0 18px 44px rgba(31,28,23,.16);
--sf-space-hair:2px;--sf-space-1:4px;--sf-space-2:8px;--sf-space-3:12px;--sf-space-4:16px;--sf-space-5:24px;--sf-space-6:32px;--sf-space-7:40px;--sf-space-8:48px;
--sf-radius-sm:4px;--sf-radius-md:6px;--sf-radius-lg:8px;--sf-radius-xl:12px;--sf-radius-pill:999px;
--sf-font-xs:11px;--sf-font-sm:12px;--sf-font-md:13px;--sf-font-lg:15px;--sf-font-xl:18px;--sf-font-2xl:24px;
--sf-leading-tight:1.4;--sf-leading-body:1.6;--sf-leading-prose:1.75;
--sf-focus-color:#2d55a8;--sf-focus-width:2px;--sf-disabled-opacity:.5;--sf-mark-radius:3px;
--sf-mark-gradient:linear-gradient(90deg,#d6246e,#c2410c,#a16207,#15803d,#1d4ed8,#7e22ce,#d6246e);--sf-mark-period:240px;--sf-mark-paper:#fbf9f5}
body[data-ds-dark-theme]{--sf-paper:#1a1917;--sf-text:#f1ede6;--sf-muted:#a8a196;--sf-text-faint:#a8a196;
--sf-border:rgba(241,237,230,.16);--sf-border-soft:rgba(241,237,230,.09);--sf-border-strong:rgba(241,237,230,.30);--sf-fill:rgba(241,237,230,.05);--sf-fill-strong:rgba(241,237,230,.10);--sf-fill-sunken:rgba(241,237,230,.03);
--sf-accent:#93b0e8;--sf-accent-text:#93b0e8;--sf-accent-soft:rgba(147,176,232,.14);--sf-accent-soft-strong:rgba(147,176,232,.22);--sf-accent-border:rgba(147,176,232,.32);--sf-on-accent:#1a1917;
--sf-selection-tint:rgba(147,176,232,.12);--sf-wash-accent:rgba(147,176,232,.16);--sf-wash-accent-faint:rgba(147,176,232,.06);--sf-wash-accent-strong:rgba(147,176,232,.22);--sf-wash-violet:var(--sf-wash-accent-strong);--sf-wash-ok:rgba(123,201,160,.16);
--sf-danger:#f0a0a0;--sf-danger-soft:rgba(240,160,160,.14);--sf-danger-border:rgba(240,160,160,.30);
--sf-ok:#7bc9a0;--sf-ok-soft:rgba(60,163,111,.16);--sf-ok-border:rgba(123,201,160,.30);
--sf-warn-text:#f0b860;--sf-warn-soft:rgba(240,184,96,.14);--sf-warn-border:rgba(240,184,96,.30);
--sf-surface:#21201d;--sf-surface-2:#292722;--sf-hover:#302c26;--sf-page-bg:#fdfbf7;
--sf-scrim:rgba(0,0,0,.55);
--sf-shadow-1:0 1px 2px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.4);
--sf-shadow-2:0 6px 20px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.4);
--sf-shadow-3:0 18px 44px rgba(0,0,0,.6);
--sf-focus-color:#93b0e8;--sf-disabled-opacity:.4}
body .sf-app{color:var(--sf-text)}
body .sf-paper-project{background:var(--sf-paper)}
body :is(.sf-wizard-scroll,.sf-create-scroll,.sf-settings){background:var(--sf-paper)}
body :is(.sf-wizard,.sf-preset-dialog,.sf-create-card,.sf-settings-card,.sf-wizard .sf-picker-panel){background:var(--sf-surface)}
body .sf-source-pane{background:var(--sf-surface)}
body .sf-preview-pane{background:var(--sf-surface-2)}
body .sf-muted{color:var(--sf-muted)}
body .sf-wizard p:not(:where(.sf-wizard-error p,.sf-wizard-issues p,.sf-brief-conflict p)){color:var(--sf-muted)}
body .sf-wizard .sf-material-checklist small{color:var(--sf-text-faint)}
body .sf-preset-dialog :is(.sf-preset-preview p,.sf-preset-scene,.sf-preset-subsections li,.sf-preset-draft p){color:var(--sf-muted)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog) :is(input,textarea)::placeholder{color:var(--sf-text-faint);opacity:1}
body .sf-wizard :is(.sf-field-hint,.sf-wizard-eyebrow,.sf-field-label,.sf-source-name small,.sf-source-badge:not([data-kind]),.sf-picker-current small,.sf-picker-current em,.sf-picker-caret,.sf-picker-dir,.sf-picker-row small,.sf-source-members,.sf-source-note,.sf-material-count,.sf-picker-note,.sf-brief dt,.sf-confirm dt,.sf-wizard-step-compact,.sf-wizard-clear){color:var(--sf-muted)}
body .sf-paper-page{--sf-text:var(--sf-page-text);--sf-muted:var(--sf-page-muted);--sf-text-faint:var(--sf-page-faint);--sf-accent-text:var(--sf-page-accent);--sf-border:var(--sf-page-border);--sf-border-soft:var(--sf-page-border-soft);--sf-border-strong:var(--sf-page-border-strong);background:var(--sf-page-bg);color:var(--sf-text);border-color:var(--sf-border);box-shadow:var(--sf-shadow-1)}`
