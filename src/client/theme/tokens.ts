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
 * Scales: spacing uses the shared 4px steps, radius has two roles plus pills and explicit
 * mark/circle exceptions, and type has seven roles. The editor metrics (`--sf-editor-font`,
 * `--sf-editor-line`) and the source padding that aligns the gutter are deliberately not here:
 * the wrap gate measures them.
 *
 * Depth is carried by surface tint, not by borders. `--sf-plane-0/1/2/3` are four background
 * steps that climb away from the viewer; a rule is only drawn where a boundary would otherwise
 * be invisible — between the workbench chrome and the canvas, and around anything that floats.
 * A stacked set of hairline separators reads as stripes rather than as hierarchy: the eye
 * cannot tell a title bar from a status line when both are one hairline tall, so the workbench
 * groups its bands by tint and keeps a rule only at the chrome edge. `--sf-border` and its
 * siblings stay for form controls and floating layers, where an outline is the affordance.
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
--sf-selection-bg:#2d55a8;--sf-selection-text:#fff;--sf-selection-tint:rgba(45,85,168,.1);--sf-wash-accent:rgba(45,85,168,.18);--sf-wash-accent-faint:rgba(45,85,168,.05);--sf-wash-accent-strong:rgba(45,85,168,.26);--sf-wash-ok:rgba(60,163,111,.18);
--sf-danger:#b04a4a;--sf-danger-soft:#fdeeee;--sf-danger-border:#f0cccc;
--sf-ok:#2f7d52;--sf-ok-soft:#eef7f2;--sf-ok-border:#bfe0cd;
--sf-warn-text:#8a5c15;--sf-warn-soft:#fdf4e3;--sf-warn-border:#eed9ae;
--sf-surface:#fffdf9;--sf-surface-2:#f5f1e9;--sf-hover:#f2ede3;
/* Depth steps. 0 is the canvas the panes sit on, 1 the workbench chrome, 2 an inset well,
   3 a grouped band that must read as a unit without drawing a rule around it. Each step is a
   tint of the same paper hue, so a band is quieter than a border but still separable. */
--sf-plane-0:#f7f4ee;--sf-plane-1:#fbf9f5;--sf-plane-2:#f1ece3;--sf-plane-3:#ece6da;
--sf-page-bg:#fbf9f5;--sf-page-text:#1f1c17;--sf-page-muted:#6b6157;--sf-page-faint:#756b5f;--sf-page-accent:#2d55a8;--sf-page-surface-2:var(--sf-surface-2);--sf-page-border:rgba(31,28,23,.13);--sf-page-border-soft:rgba(31,28,23,.08);--sf-page-border-strong:rgba(31,28,23,.28);
--sf-scrim:rgba(31,28,23,.35);
--sf-shadow-1:0 1px 2px rgba(31,28,23,.06),0 1px 3px rgba(31,28,23,.07);
--sf-shadow-2:0 6px 20px rgba(31,28,23,.10),0 2px 6px rgba(31,28,23,.06);
--sf-shadow-3:0 18px 44px rgba(31,28,23,.16);
--sf-space-hair:2px;--sf-space-1:4px;--sf-space-2:8px;--sf-space-3:12px;--sf-space-4:16px;--sf-space-panel:20px;--sf-space-5:24px;--sf-space-6:32px;--sf-space-7:40px;--sf-space-8:48px;
--sf-radius-control:6px;--sf-radius-surface:10px;--sf-radius-sm:var(--sf-radius-control);--sf-radius-md:var(--sf-radius-control);--sf-radius-lg:var(--sf-radius-surface);--sf-radius-xl:var(--sf-radius-surface);--sf-radius-pill:999px;
--sf-control-sm:30px;--sf-control-md:34px;--sf-control-lg:40px;--sf-hit-min:0px;--sf-measure:38rem;
--sf-font-xs:11px;--sf-font-sm:12px;--sf-font-md:13px;--sf-font-prose:15px;--sf-font-title:17px;--sf-font-display-2:20px;--sf-font-display-1:28px;
--sf-family-serif:'Source Han Serif SC','Noto Serif SC','华文中宋','SimSun','宋体',Georgia,'Times New Roman',serif;
--sf-family-sans:'Microsoft YaHei UI','微软雅黑',system-ui,'Segoe UI',sans-serif;--sf-family-mono:Consolas,'SFMono-Regular',monospace;
--sf-leading-tight:1.4;--sf-leading-body:1.6;--sf-leading-prose:1.8;--sf-leading-display-1:1.25;--sf-leading-display-2:1.35;--sf-leading-title:1.45;--sf-leading-sm:1.55;
--sf-focus-color:#2d55a8;--sf-focus-width:2px;--sf-disabled-opacity:.5;--sf-mark-radius:3px;
--sf-mark-gradient:linear-gradient(90deg,#d6246e,#c2410c,#a16207,#15803d,#1d4ed8,#7e22ce,#d6246e);--sf-mark-period:240px;--sf-mark-paper:#fbf9f5}
body[data-ds-dark-theme]{--sf-paper:#1a1917;--sf-text:#f1ede6;--sf-muted:#a8a196;--sf-text-faint:#a8a196;
--sf-border:rgba(241,237,230,.16);--sf-border-soft:rgba(241,237,230,.09);--sf-border-strong:rgba(241,237,230,.30);--sf-fill:rgba(241,237,230,.05);--sf-fill-strong:rgba(241,237,230,.10);--sf-fill-sunken:rgba(241,237,230,.03);
--sf-accent:#93b0e8;--sf-accent-text:#93b0e8;--sf-accent-soft:rgba(147,176,232,.14);--sf-accent-soft-strong:rgba(147,176,232,.22);--sf-accent-border:rgba(147,176,232,.32);--sf-on-accent:#1a1917;
--sf-selection-bg:#2d55a8;--sf-selection-text:#fff;--sf-selection-tint:rgba(147,176,232,.12);--sf-wash-accent:rgba(147,176,232,.16);--sf-wash-accent-faint:rgba(147,176,232,.06);--sf-wash-accent-strong:rgba(147,176,232,.22);--sf-wash-ok:rgba(123,201,160,.16);
--sf-danger:#f0a0a0;--sf-danger-soft:rgba(240,160,160,.14);--sf-danger-border:rgba(240,160,160,.30);
--sf-ok:#7bc9a0;--sf-ok-soft:rgba(60,163,111,.16);--sf-ok-border:rgba(123,201,160,.30);
--sf-warn-text:#f0b860;--sf-warn-soft:rgba(240,184,96,.14);--sf-warn-border:rgba(240,184,96,.30);
--sf-surface:#21201d;--sf-surface-2:#292722;--sf-hover:#302c26;--sf-page-bg:#fdfbf7;
/* Dark inverts the climb: chrome sits above the canvas, so plane 1 is lighter than plane 0.
   Same order of separation, opposite direction. */
--sf-plane-0:#1e1d1b;--sf-plane-1:#252422;--sf-plane-2:#2b2926;--sf-plane-3:#33302c;
--sf-scrim:rgba(0,0,0,.55);
--sf-shadow-1:0 1px 2px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.4);
--sf-shadow-2:0 6px 20px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.4);
--sf-shadow-3:0 18px 44px rgba(0,0,0,.6);
--sf-focus-color:#93b0e8;--sf-disabled-opacity:.4}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-boundary){color:var(--sf-text);font-family:var(--sf-family-sans);font-size:var(--sf-font-md);line-height:var(--sf-leading-body)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-boundary) :is(button,input,select,textarea,label,small,summary):not(.sf-native-tools *){font-family:var(--sf-family-sans)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-boundary) :is(button,input,select,textarea):not(.sf-native-tools *){font-size:var(--sf-font-md)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-boundary) small{font-size:var(--sf-font-sm);line-height:var(--sf-leading-sm)}
body :is(.sf-wizard h2,.sf-wizard h3,.sf-paper-title,.sf-paper-project h2,.sf-paper-project h3,.sf-paper-project h4,.sf-preset-preview h3,.sf-preset-draft h3,.sf-preset-dialog>header strong,.sf-preset-row strong,.sf-preset-sections strong,.sf-preset-subsections li>span,.sf-boundary h3,.sf-chat-empty h3,.sf-settings h2,.sf-settings h3){font-family:var(--sf-family-serif)}
body .sf-wizard h2{font-size:var(--sf-font-display-1);line-height:var(--sf-leading-display-1);font-weight:600;letter-spacing:-.025em}
body :is(.sf-wizard h3,.sf-paper-project h2,.sf-paper-project h3,.sf-preset-preview h3,.sf-preset-draft h3,.sf-preset-dialog>header strong,.sf-boundary h3,.sf-settings h2,.sf-settings h3){font-size:var(--sf-font-display-2);line-height:var(--sf-leading-display-2);font-weight:600}
body :is(.sf-paper-title,.sf-paper-project h4,.sf-preset-row strong,.sf-preset-sections strong,.sf-preset-subsections li>span,.sf-chat-empty h3){font-size:var(--sf-font-title);line-height:var(--sf-leading-title);font-weight:600}
body .sf-wizard .sf-outline-title{font-family:var(--sf-family-serif);font-size:var(--sf-font-title);line-height:var(--sf-leading-title)}
body :is(.sf-wizard-eyebrow,.sf-preset-group,.sf-outline-status,.sf-chat-mode){letter-spacing:.04em}
body .sf-paper-project{background:var(--sf-plane-1)}
body :is(.sf-wizard-scroll,.sf-create-scroll,.sf-settings){background:var(--sf-plane-0)}
body :is(.sf-wizard-scroll,.sf-create-scroll){background:transparent}
/* The workspace owns the outer gutter. Its wizard scroll seat must not add a second one. */
body .sf-create-scroll>.sf-wizard-scroll{padding:0}
body .sf-create-card,body .sf-settings-card{background:var(--sf-surface)}
body :is(.sf-wizard,.sf-preset-dialog){background:var(--sf-surface)}
body .sf-source-pane{background:var(--sf-surface)}
/* The pane stays unpainted: the canvas tint belongs to .sf-paper-project, and a second tinted
   layer here would sit between the app and the paper, costing the prose an extra painted ancestor
   under AT-127. Transparent also lets the paper's edge read against the darker root step. */
body .sf-preview-pane{background:transparent}
body .sf-muted{color:var(--sf-muted)}
body .sf-wizard p:not(:where(.sf-wizard-error p,.sf-wizard-issues p,.sf-brief-conflict p)){color:var(--sf-muted)}
body .sf-wizard .sf-material-checklist small{color:var(--sf-text-faint)}
body .sf-preset-dialog :is(.sf-preset-preview p,.sf-preset-scene,.sf-preset-subsections li,.sf-preset-draft p){color:var(--sf-muted)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog) :is(input,textarea)::placeholder{color:var(--sf-text-faint);opacity:1}
body .sf-wizard :is(.sf-field-hint,.sf-wizard-eyebrow,.sf-field-label,.sf-source-name small,.sf-source-badge:not([data-kind]),.sf-picker-current small,.sf-picker-current em,.sf-picker-caret,.sf-picker-dir,.sf-picker-row small,.sf-source-members,.sf-source-note,.sf-material-count,.sf-picker-note,.sf-brief dt,.sf-confirm dt,.sf-wizard-step-compact,.sf-wizard-clear){color:var(--sf-muted)}
body .sf-paper-page{--sf-text:var(--sf-page-text);--sf-muted:var(--sf-page-muted);--sf-text-faint:var(--sf-page-faint);--sf-accent-text:var(--sf-page-accent);--sf-surface-2:var(--sf-page-surface-2);--sf-border:var(--sf-page-border);--sf-border-soft:var(--sf-page-border-soft);--sf-border-strong:var(--sf-page-border-strong);background:var(--sf-page-bg);color:var(--sf-text);border-color:var(--sf-border);box-shadow:var(--sf-shadow-1);max-width:var(--sf-measure);border-radius:0}
/* Shared controls own the defaults; named content and navigation controls own their layout.
   A secondary action has a quiet fill. Outlines describe fields and floating surfaces,
   rather than putting every action into an equally prominent box. */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button:not(:where(.sf-native-tools *)){box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:var(--sf-space-2);min-width:var(--sf-control-sm);height:max(var(--sf-control-size,var(--sf-control-md)),var(--sf-hit-min));min-height:max(var(--sf-control-size,var(--sf-control-md)),var(--sf-hit-min));padding:0 var(--sf-space-3);border:1px solid transparent;border-radius:var(--sf-radius-control);background:var(--sf-fill);color:var(--sf-text);font-family:var(--sf-family-sans);font-weight:500;cursor:pointer;transition:background var(--sf-dur-quick),border-color var(--sf-dur-quick),box-shadow var(--sf-dur-quick)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button.sf-primary{background:var(--sf-accent);border-color:var(--sf-accent);color:var(--sf-on-accent);box-shadow:none}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button.sf-secondary{background:var(--sf-fill);border-color:transparent;color:var(--sf-text)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button:is(.sf-ghost,.sf-wizard-back,.sf-chat-icon,.sf-overlay-close,.sf-wizard-clear,.sf-source-action){background:transparent;border-color:transparent;box-shadow:none;color:var(--sf-muted)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button.sf-danger{background:var(--sf-danger-soft);border-color:transparent;color:var(--sf-danger)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button:not(:disabled):not(.sf-primary):not(:where(.sf-native-tools *)):hover{background:var(--sf-hover);border-color:transparent}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button.sf-primary:hover:not(:disabled){background:var(--sf-accent);filter:brightness(.94)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button:active:not(:disabled):not(:where(.sf-native-tools *)){box-shadow:none;filter:brightness(.88)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) button:disabled{cursor:default;opacity:var(--sf-disabled-opacity)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog) button[aria-pressed=true]:not(.sf-primary){background:var(--sf-accent-soft);border-color:transparent;color:var(--sf-accent-text)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt) :is(input,select,textarea):not(.sf-source-input):not(:where(.sf-native-tools *)){box-sizing:border-box;max-width:100%;min-width:0;border:1px solid var(--sf-border);border-radius:var(--sf-radius-control);background-color:var(--sf-surface);color:var(--sf-text);padding:0 var(--sf-space-3);transition:border-color var(--sf-dur-quick),background-color var(--sf-dur-quick)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt) :is(input,select,textarea):not(.sf-source-input):not(:disabled):not([type=checkbox]):not([type=radio]):hover{border-color:var(--sf-border-strong)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt) :is(input:not([type=checkbox]):not([type=radio]),select):not(.sf-source-input):not(.sf-native-tools *){height:max(var(--sf-control-size,var(--sf-control-md)),var(--sf-hit-min));min-height:max(var(--sf-control-size,var(--sf-control-md)),var(--sf-hit-min))}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt) textarea:not(.sf-source-input){height:auto;min-height:max(var(--sf-control-md),var(--sf-hit-min));padding:var(--sf-space-2) var(--sf-space-3);line-height:var(--sf-leading-body)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt) select:not(.sf-native-tools *){appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--sf-muted) 50%),linear-gradient(135deg,var(--sf-muted) 50%,transparent 50%);background-position:calc(100% - 16px) center,calc(100% - 12px) center;background-size:4px 4px;background-repeat:no-repeat;padding-inline-end:var(--sf-space-6)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt) select:not(.sf-native-tools *):not(.sf-source-input){padding-inline-end:var(--sf-space-6)}
body .sf-app .sf-paper-header>select:not(.sf-native-tools *){flex-shrink:0;min-width:9em}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) :is(button,input,select,textarea):focus-visible:not(.sf-source-input):not(.sf-native-tools *){outline:var(--sf-focus-width) solid var(--sf-focus-color);outline-offset:2px;border-color:var(--sf-accent)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog) :is(button,input,select)[data-size=sm]{--sf-control-size:var(--sf-control-sm)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog) :is(button,input,select)[data-size=lg],body .sf-wizard-nav{--sf-control-size:var(--sf-control-lg)}
body .sf-wizard{box-sizing:border-box;width:100%;padding:var(--sf-space-5);border:0;box-shadow:none}
body .sf-wizard .sf-wizard-steps{gap:var(--sf-space-5);padding:var(--sf-space-4) 0;margin:var(--sf-space-4) 0 var(--sf-space-5)}
body .sf-wizard .sf-wizard-steps button{background:transparent;padding:0 var(--sf-space-2);font-size:var(--sf-font-sm)}
body .sf-wizard .sf-wizard-steps span{width:var(--sf-control-sm);height:var(--sf-control-sm);font-size:var(--sf-font-sm)}
body .sf-wizard .sf-wizard-footer{margin-top:var(--sf-space-6);padding-top:var(--sf-space-4)}
body .sf-wizard .sf-wizard-page>.sf-form{margin-top:var(--sf-space-4)}
body .sf-settings-card{padding:var(--sf-space-panel)}
body .sf-capability-panel{max-width:960px;margin:auto}
body .sf-capability-panel fieldset{min-width:0;border:0;margin:0;padding:var(--sf-space-3) 0}
body .sf-capability-panel legend{font-weight:600;color:var(--sf-text)}
body .sf-capability-panel label:has(input[type=checkbox]){display:inline-flex;align-items:flex-start;gap:var(--sf-space-2);margin:var(--sf-space-2) var(--sf-space-3) var(--sf-space-2) 0}
body .sf-capability-panel :is(input,select,textarea){max-width:100%}
body .sf-paper-toolbar .sf-paper-menu-popover{max-height:60vh;overflow:auto}
body .sf-settings{width:100%;box-sizing:border-box;max-width:800px;padding:var(--sf-space-5);height:auto;min-height:100%}
body .sf-settings-heading{display:flex;align-items:center;gap:var(--sf-space-3);margin-bottom:var(--sf-space-6)}
body .sf-settings-heading>svg{color:var(--sf-accent-text);flex:none}
body .sf-settings-heading>h2{font-size:var(--sf-font-display-1);margin:0}
body .sf-settings .sf-group{padding:var(--sf-space-4) 0;gap:var(--sf-space-4)}
body .sf-settings .sf-group h3{font-size:var(--sf-font-title);line-height:var(--sf-leading-title)}
body .sf-settings :is(.sf-group,.sf-group-body)>button{align-self:flex-start;max-width:100%;height:auto;min-height:max(var(--sf-control-md),var(--sf-hit-min));padding:var(--sf-space-2) var(--sf-space-3);text-align:left;white-space:normal}
body .sf-settings .sf-group>header button{--sf-control-size:var(--sf-control-sm);font-size:var(--sf-font-sm);background:transparent;color:var(--sf-muted)}
body .sf-settings .sf-form{row-gap:var(--sf-space-3)}
body .sf-settings .sf-field-label{max-width:12em}
body .sf-settings :is(p[role=status],p[role=alert]):empty{margin:0}
body .sf-requirements-panel fieldset{min-width:0;border:0;margin:0;padding:var(--sf-space-4) 0}
body .sf-requirements-panel .sf-requirements-actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--sf-space-2) var(--sf-space-4);margin-top:var(--sf-space-4)}
body .sf-wizard.sf-requirements-panel .sf-requirements-actions button.sf-requirements-save{background:var(--sf-accent-soft);border-color:var(--sf-accent-border);color:var(--sf-accent-text);box-shadow:none;white-space:nowrap;font-weight:600}
body .sf-wizard.sf-requirements-panel .sf-requirements-actions button.sf-requirements-save:hover:not(:disabled){background:var(--sf-hover);border-color:var(--sf-accent)}
body .sf-requirements-panel .sf-requirements-actions .sf-requirements-save-status{display:flex;align-items:center;gap:var(--sf-space-2);margin:0;font-size:var(--sf-font-sm);color:var(--sf-muted)}
body .sf-requirements-save-status svg{flex-shrink:0;color:var(--sf-ok)}
body .sf-preset-dialog button.sf-preset-row{height:auto;min-height:var(--sf-control-lg);display:flex;justify-content:flex-start;padding:var(--sf-space-2) var(--sf-space-3);border-color:transparent;border-radius:var(--sf-radius-surface);text-align:left;white-space:normal}
body .sf-wizard .sf-source-members,body .sf-preset-subsections{border:0}
body .sf-wizard :is(.sf-wizard-steps,.sf-wizard-footer,.sf-picker-panel){border:0;background:transparent;box-shadow:none}
body .sf-line-gutter{background:transparent}
body :is(.sf-paper-toolbar,.sf-pane-caption){height:auto;min-height:max(var(--sf-control-sm),var(--sf-hit-min))}
body .sf-pane-caption{border-bottom:0}
body .sf-app .sf-pane-zoom button{padding:var(--sf-space-1)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog) input:is([type=checkbox],[type=radio]){padding:0;background:transparent;accent-color:var(--sf-accent)}
body .sf-wizard :is(.sf-output-conflict,.sf-brief,.sf-outline-candidate,.sf-create-summary,.sf-wizard-summary,.sf-wizard-error,.sf-wizard-issues,.sf-cover-fields,.sf-source-list,.sf-source-row,.sf-member-reads,.sf-member-reads li){border:0;background:transparent;box-shadow:none;border-radius:0;padding:var(--sf-space-2) 0}
body .sf-wizard :is(.sf-source-row,.sf-member-reads li){gap:var(--sf-space-3);margin-top:var(--sf-space-2)}
body .sf-wizard :is(.sf-outline-edit-row,.sf-outline-group>header){border:0;background:transparent}
body .sf-wizard .sf-outline-edit-row[data-child=true]{border-left:0;padding-left:var(--sf-space-3)}
body .sf-wizard .sf-material-checklist label.sf-material-disabled{opacity:1;color:var(--sf-text-faint)}
body .sf-wizard :is(.sf-material-checklist,.sf-material-checklist label){border:0;background:transparent;border-radius:0}
body .sf-paper-page .sf-prose p{margin:.9em 0}
body .sf-caption-entry button{color:var(--sf-muted);font-family:var(--sf-family-sans)}
body .sf-chat-toolbar button.sf-chat-icon{width:max(var(--sf-control-sm),var(--sf-hit-min));height:max(var(--sf-control-sm),var(--sf-hit-min));min-height:max(var(--sf-control-sm),var(--sf-hit-min));border-radius:var(--sf-radius-control);color:var(--sf-muted)}
body .sf-overlay-row select{width:7.5em;min-width:7.5em}
body .sf-state{display:flex;align-items:center;gap:var(--sf-space-4);box-sizing:border-box;width:100%;max-width:640px;min-height:160px;margin:var(--sf-space-5) auto;padding:var(--sf-space-4) var(--sf-space-5);font-family:var(--sf-family-sans);color:var(--sf-text)}
body .sf-state.sf-state-compact{min-height:0;margin:var(--sf-space-2) 0;padding:var(--sf-space-2) 0}
body .sf-state.sf-state h3{font-family:var(--sf-family-serif);font-size:var(--sf-font-title);line-height:var(--sf-leading-title);margin:0;font-weight:600}
body .sf-state .sf-state-body{flex:1;min-width:0;overflow-wrap:anywhere}
body .sf-state .sf-state-body>p{font-family:var(--sf-family-sans);font-size:var(--sf-font-md);line-height:var(--sf-leading-body);margin:var(--sf-space-2) 0 0;color:var(--sf-muted)}
body .sf-state-icon{display:grid;place-items:center;flex:none;width:32px;height:32px;color:var(--sf-accent-text)}
body .sf-state-error .sf-state-icon{color:var(--sf-danger)}
body .sf-state-icon[data-animated]{animation:sf-state-spin var(--sf-state-spin,1.2s) linear infinite}
body .sf-state-details{font-family:var(--sf-family-sans);font-size:var(--sf-font-sm);margin-top:var(--sf-space-4);overflow-wrap:anywhere}
body .sf-state-details pre,body .sf-boundary pre{background:transparent;border:0;border-radius:0}
@keyframes sf-state-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){body .sf-state-icon[data-animated]{animation:none}}
@media(max-width:520px){body .sf-state{flex-wrap:wrap;align-items:flex-start}body .sf-state>button{margin-left:48px}}
@container(max-width:420px){body .sf-paper-header{flex-wrap:wrap}body .sf-paper-header .sf-native-tools{margin-left:auto}body .sf-pane-caption{gap:var(--sf-space-1)}body .sf-pane-caption>span:first-child{flex:1}body .sf-pane-caption>button{flex-shrink:0;white-space:nowrap}body .sf-status-heading{display:none}}
@media(max-width:720px){:root{--sf-hit-min:44px}body .sf-create-scroll{padding:var(--sf-space-3)}body .sf-wizard{padding:var(--sf-space-4)}body .sf-wizard-footer{flex-wrap:wrap;gap:var(--sf-space-2)}body .sf-wizard-footer>span{display:none}body .sf-wizard-footer>button{flex:1 1 auto;white-space:normal}body .sf-wizard .sf-outline-toolbar{gap:var(--sf-space-2)}}
@media(max-width:420px){body .sf-wizard .sf-wizard-clear{float:none;margin-left:0}}
/* Layout primitives (SF-136..139). One definition each — a field row, a section band, a
   disclosure — living here rather than in a component constant, because the screens had grown
   three different field-markup idioms and a second implementation would reintroduce the drift.
   .sf-form is the grid, .sf-field is display:contents so its three children become grid items:
   that is what puts every control in a group on one left edge. Because .sf-field has no box it
   must not carry padding, border or background, and must not carry role/aria/id — display:contents
   removes it from the accessibility tree, so those belong on the input. */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-form{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;column-gap:var(--sf-space-4);row-gap:var(--sf-space-3);max-width:100%}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field{display:contents}
/* Column mode for a cluster of short, mutually independent fields (type / language / format).
   The same markup, laid across instead of down: stacking those three would triple the height of
   the step for no gain in legibility. Each field stacks label-over-control here, because a label
   column per column of fields is what makes a form look ragged. --sf-form-columns sets the count. */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-form[data-layout=columns]{grid-template-columns:repeat(var(--sf-form-columns,3),minmax(0,1fr));align-items:start}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-form[data-layout=columns]>.sf-field{display:flex;flex-direction:column;gap:var(--sf-space-1);min-width:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-form[data-layout=columns] .sf-field-label{margin:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field-label{font-size:var(--sf-font-sm);font-weight:500;line-height:var(--sf-leading-sm);color:var(--sf-muted);min-width:0;overflow-wrap:anywhere}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field-control{display:flex;align-items:center;gap:var(--sf-space-2);min-width:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field:has(textarea)>.sf-field-label{align-self:start;padding-top:var(--sf-space-2)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field-control>:is(input,select,textarea){flex:1 1 auto;min-width:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field-control>button{flex:0 0 auto}
/* Everything a field carries besides its label belongs in the control column. Without this the
   auto-flow would put the second element back in column 1 and leave a hole beside it. */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field>*:not(.sf-field-label){grid-column:2}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) :is(.sf-field-hint,.sf-field>.sf-detail){margin:0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-sm);color:var(--sf-text-faint)}
/* Section band. A band draws its boundary with a rule and never with a box; a band that also had
   a background would be a card, and cards inside cards are what made these pages read as tables.
   [data-surface=card] is the opt-in for the rare case that really is a card. */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-group{display:flex;flex-direction:column;gap:var(--sf-space-4);padding:var(--sf-space-4) 0;border-top:1px solid var(--sf-border-soft)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-group:first-child{border-top:0;padding-top:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-group>header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--sf-space-3);min-height:var(--sf-control-sm)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-group>header>:is(h2,h3){margin:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-group-body{display:flex;flex-direction:column;gap:var(--sf-space-4);min-width:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-group[data-surface=card]{padding:var(--sf-space-4);border-top:0;background:var(--sf-surface);border-radius:var(--sf-radius-surface)}
/* Disclosure (SF-138). Static prose longer than a field hint collapses to one line, so a screen
   of explanation reads as a screen of fields. <details> carries the semantics, keyboard access
   and aria-expanded without JS. The marker is a border triangle, not a text character (SF-129). */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-detail{border:0;padding:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-detail>summary{display:flex;align-items:baseline;gap:var(--sf-space-2);cursor:pointer;list-style:none;font-size:var(--sf-font-sm);line-height:var(--sf-leading-sm);color:var(--sf-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-detail>summary::-webkit-details-marker{display:none}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-detail>summary:focus-visible{outline:var(--sf-focus-width) solid var(--sf-focus-color);outline-offset:2px}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-detail>summary::before{content:'';flex:none;width:0;height:0;margin-top:.35em;width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform var(--sf-dur-quick)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-detail[open]>summary{white-space:normal;text-overflow:clip}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-detail[open]>summary::before{transform:rotate(45deg)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-detail>p{margin:var(--sf-space-2) 0 0;padding-left:calc(4px + var(--sf-space-2));font-size:var(--sf-font-sm);line-height:var(--sf-leading-sm);color:var(--sf-muted)}
/* File inputs were the one control the contract missed (SF-139), so the browser's own button sat
   beside the styled ones on the settings screen. It takes the secondary variant's geometry now. */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) input[type=file]:not(.sf-native-tools *){border:0;background:transparent;padding:0;height:auto;min-height:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) input[type=file]:not(.sf-native-tools *)::file-selector-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:max(var(--sf-control-size,var(--sf-control-md)),var(--sf-hit-min));padding:0 var(--sf-space-3);margin-inline-end:var(--sf-space-3);border:1px solid transparent;border-radius:var(--sf-radius-control);background:var(--sf-fill);color:var(--sf-text);font-family:var(--sf-family-sans);font-size:var(--sf-font-md);font-weight:500;cursor:pointer;transition:background var(--sf-dur-quick)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) input[type=file]:not(.sf-native-tools *)::file-selector-button:hover{background:var(--sf-hover)}
/* A checkbox with its own sentence. It spans the whole row rather than sitting in a field,
   because the sentence IS the label and there is no separate control column to align to. */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-check{display:flex;align-items:flex-start;gap:var(--sf-space-2);font-size:var(--sf-font-md);line-height:var(--sf-leading-body);cursor:pointer}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-check>input{flex:none;margin-top:.25em}
/* AI change card (SF-142): what changed and why, not two bare buttons. */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-change{display:flex;flex-direction:column;gap:var(--sf-space-3);padding:var(--sf-space-3) 0;border-top:1px solid var(--sf-border-soft)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-change:first-child{border-top:0;padding-top:0}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-change-diff{font-family:var(--sf-family-serif);font-size:var(--sf-font-prose);line-height:var(--sf-leading-prose);overflow-wrap:anywhere}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-change-diff>del{color:var(--sf-muted);text-decoration:line-through}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-change-diff>ins{background:var(--sf-accent-soft);color:var(--sf-accent-text);text-decoration:none}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-change-why{margin:0;font-size:var(--sf-font-sm);line-height:var(--sf-leading-sm);color:var(--sf-muted)}
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-change-actions{display:flex;flex-wrap:wrap;gap:var(--sf-space-2)}
/* AI provenance tick (SF-143). A 2px rule outside the glyph box, so a range can be marked
   without touching its text contrast; the rainbow mark keeps its own separate channel. */
body .sf-origin-ai{position:relative}
body .sf-origin-ai::after{content:'';position:absolute;left:-2px;top:.15em;bottom:.15em;width:2px;background:var(--sf-accent-border);border-radius:1px}
/* Stack the field grid on a narrow pane. @media, not @container: the only container-type in this
   client is .sf-paper-project, so an @container rule inside .sf-wizard or .sf-settings would never
   fire. Adding container-type to those roots would also make them the containing block for the
   fixed-position overlays they host, which this pass cannot verify. Known limit: a narrow pane in
   a wide viewport keeps the two-column grid. */
@media(max-width:640px){body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-form{grid-template-columns:minmax(0,1fr);row-gap:var(--sf-space-1)}body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field-label{margin-top:var(--sf-space-2)}body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-field>*:not(.sf-field-label){grid-column:1}
/* The column mode needs its own override: [data-layout=columns] outweighs a bare .sf-form, so the
   rule above would leave the three columns standing at 320px and overflow the pane (AT-41). */
body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-form[data-layout=columns]{grid-template-columns:minmax(0,1fr);align-items:stretch}}`
