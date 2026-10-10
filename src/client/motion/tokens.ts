/**
 * One place for durations and easings (SPEC v1.2 §15.1). Scenes read these tokens instead of
 * carrying their own numbers, so a change stays consistent and `prefers-reduced-motion` is
 * handled once, at the token layer, rather than per component.
 */
export const MOTION_CSS = `:root{--sf-dur-instant:90ms;--sf-dur-quick:150ms;--sf-dur-base:200ms;--sf-dur-slow:320ms;
--sf-ease-out:cubic-bezier(.22,.61,.36,1);--sf-ease-paper:cubic-bezier(.22,.61,.36,1);--sf-ease-in-out:cubic-bezier(.4,0,.2,1);--sf-dur-exit:140ms;--sf-state-spin:1.2s;--sf-sweep:2.8s}
@media(prefers-reduced-motion:reduce){:root{--sf-dur-instant:1ms;--sf-dur-quick:1ms;--sf-dur-base:1ms;--sf-dur-slow:1ms;--sf-sweep:0s}}
/* The rewrite mark's flow, paused while the window is hidden. The source pane's mirror reuses the
   preview's .sf-mark-inline class for its marked slice, so it is covered by the same entry rather
   than by a second one (SPEC v1.6 §4). */
.sf-app[data-sf-hidden=true] .sf-long-op-dot,.sf-app[data-sf-hidden=true] .sf-progress-working,
.sf-app[data-sf-hidden=true] .sf-rewrite-sweep::before,.sf-app[data-sf-hidden=true] .sf-rewrite-spinner,
.sf-app[data-sf-hidden=true] .sf-mark-inline,.sf-app[data-sf-hidden=true] .sf-state-icon[data-animated]{animation-play-state:paused}`

/** Scene durations from PRD §10.2, kept together so the table is reviewable in one place. */
export const SCENE = { enter: 200, exit: 140, wizardStep: 200, wizardShift: 6, viewSwitch: 200, press: 100, listShift: 200,
  menu: 200, overlay: 200, overlayShift: 6, panel: 200, candidate: 200, status: 200 } as const

export function paperEase(): [number, number, number, number] {
  const value = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
    ? window.getComputedStyle(document.documentElement).getPropertyValue('--sf-ease-paper') : ''
  const values = value.match(/-?\d*\.?\d+/g)?.map(Number)
  return values?.length === 4 ? values as [number, number, number, number] : [.22, .61, .36, 1]
}
