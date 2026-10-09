/**
 * One place for durations and easings (SPEC v1.2 §15.1). Scenes read these tokens instead of
 * carrying their own numbers, so a change stays consistent and `prefers-reduced-motion` is
 * handled once, at the token layer, rather than per component.
 */
export const MOTION_CSS = `:root{--sf-dur-instant:90ms;--sf-dur-quick:150ms;--sf-dur-base:200ms;--sf-dur-slow:320ms;
--sf-ease-out:cubic-bezier(.22,.61,.36,1);--sf-ease-in-out:cubic-bezier(.4,0,.2,1);--sf-sweep:2.8s}
@media(prefers-reduced-motion:reduce){:root{--sf-dur-instant:1ms;--sf-dur-quick:1ms;--sf-dur-base:1ms;--sf-dur-slow:1ms;--sf-sweep:0s}}
/* The rewrite mark's flow, paused while the window is hidden. The source pane's mirror reuses the
   preview's .sf-mark-inline class for its marked slice, so it is covered by the same entry rather
   than by a second one (SPEC v1.6 §4). */
.sf-app[data-sf-hidden=true] .sf-long-op-dot,.sf-app[data-sf-hidden=true] .sf-progress-working,
.sf-app[data-sf-hidden=true] .sf-rewrite-sweep::before,.sf-app[data-sf-hidden=true] .sf-rewrite-spinner,
.sf-app[data-sf-hidden=true] .sf-mark-inline{animation-play-state:paused}`

/** Scene durations from PRD §10.2, kept together so the table is reviewable in one place. */
export const SCENE = { wizardStep: 200, wizardShift: 10, viewSwitch: 190, press: 100, listShift: 190,
  menu: 150, overlay: 180, overlayShift: 6, panel: 180, candidate: 160, status: 150 } as const
