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
 * The mark band's two constants are here but off the ladder, for the same reason: the mark gate
 * samples a strip across the band's top edge, so its corner radius moves the measured spread — the
 * 3px below holds the recorded 173, and the 4px ladder step drops it to 172.
 *
 * Two kinds of accent tint, and the difference is measurable: a `--sf-*-soft` is a panel's own
 * background, so it is opaque and themed for contrast against the text it carries. A `--sf-wash-*`
 * and the selection tint sit *above* something that has to stay visible through them — the rainbow
 * band behind a selection, the sweep passing over a status row — so they keep an alpha channel.
 * Swapping one for the other is invisible in a screenshot until the thing underneath disappears.
 */
export const THEME_CSS = `:root{--sf-text:#0f1115;--sf-muted:#5e6472;--sf-text-faint:#697080;
--sf-border:rgba(15,17,21,.12);--sf-border-soft:rgba(15,17,21,.07);--sf-border-strong:rgba(15,17,21,.26);--sf-fill:rgba(15,17,21,.04);--sf-fill-strong:rgba(15,17,21,.08);--sf-fill-sunken:rgba(15,17,21,.03);
--sf-accent:#3f68d8;--sf-accent-text:#2f5bc4;--sf-accent-soft:#eef2fd;--sf-accent-soft-strong:#e0e9fb;--sf-accent-border:#c2d0f4;--sf-on-accent:#fff;
--sf-selection-tint:rgba(63,104,216,.1);--sf-wash-accent:rgba(63,104,216,.18);--sf-wash-accent-faint:rgba(63,104,216,.05);--sf-wash-violet:rgba(122,79,224,.18);--sf-wash-ok:rgba(60,163,111,.18);
--sf-danger:#b04a4a;--sf-danger-soft:#fdeeee;--sf-danger-border:#f0cccc;
--sf-ok:#2f7d52;--sf-ok-soft:#eef7f2;--sf-ok-border:#bfe0cd;
--sf-warn-text:#8a5c15;--sf-warn-soft:#fdf4e3;--sf-warn-border:#eed9ae;
--sf-surface:#fff;--sf-surface-2:#f7f8fa;--sf-hover:#f3f4f6;
--sf-scrim:rgba(15,17,21,.35);
--sf-shadow-1:0 1px 2px rgba(15,17,21,.06),0 1px 3px rgba(15,17,21,.07);
--sf-shadow-2:0 6px 20px rgba(15,17,21,.10),0 2px 6px rgba(15,17,21,.06);
--sf-shadow-3:0 18px 44px rgba(15,17,21,.16);
--sf-space-hair:2px;--sf-space-1:4px;--sf-space-2:8px;--sf-space-3:12px;--sf-space-4:16px;--sf-space-5:24px;--sf-space-6:32px;--sf-space-7:40px;--sf-space-8:48px;
--sf-radius-sm:4px;--sf-radius-md:6px;--sf-radius-lg:8px;--sf-radius-xl:12px;--sf-radius-pill:999px;
--sf-font-xs:11px;--sf-font-sm:12px;--sf-font-md:13px;--sf-font-lg:15px;--sf-font-xl:18px;--sf-font-2xl:24px;
--sf-leading-tight:1.4;--sf-leading-body:1.6;--sf-leading-prose:1.75;
--sf-focus-color:#3f68d8;--sf-focus-width:2px;--sf-disabled-opacity:.5;--sf-mark-band-radius:3px;--sf-mark-band-opacity:.78}
body[data-ds-dark-theme]{--sf-text:#f9fafb;--sf-muted:#9aa0a8;--sf-text-faint:#8b9099;
--sf-border:rgba(255,255,255,.16);--sf-border-soft:rgba(255,255,255,.09);--sf-border-strong:rgba(255,255,255,.30);--sf-fill:rgba(255,255,255,.05);--sf-fill-strong:rgba(255,255,255,.10);--sf-fill-sunken:rgba(255,255,255,.03);
--sf-accent-text:#8fb3ff;--sf-accent-soft:rgba(143,179,255,.14);--sf-accent-soft-strong:rgba(143,179,255,.22);--sf-accent-border:rgba(143,179,255,.32);
--sf-selection-tint:rgba(143,179,255,.12);--sf-wash-accent:rgba(143,179,255,.16);--sf-wash-accent-faint:rgba(143,179,255,.06);--sf-wash-violet:rgba(178,140,255,.16);--sf-wash-ok:rgba(123,201,160,.16);
--sf-danger:#f0a0a0;--sf-danger-soft:rgba(240,160,160,.14);--sf-danger-border:rgba(240,160,160,.30);
--sf-ok:#7bc9a0;--sf-ok-soft:rgba(60,163,111,.16);--sf-ok-border:rgba(123,201,160,.30);
--sf-warn-text:#f0b860;--sf-warn-soft:rgba(240,184,96,.14);--sf-warn-border:rgba(240,184,96,.30);
--sf-surface:#151517;--sf-surface-2:#1c1c1f;--sf-hover:rgba(255,255,255,.08);
--sf-scrim:rgba(0,0,0,.55);
--sf-shadow-1:0 1px 2px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.4);
--sf-shadow-2:0 6px 20px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.4);
--sf-shadow-3:0 18px 44px rgba(0,0,0,.6);
--sf-focus-color:#8fb3ff;--sf-disabled-opacity:.4;--sf-mark-band-opacity:.45}`
