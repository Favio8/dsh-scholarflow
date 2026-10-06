/**
 * One place for durations and easings (SPEC v1.2 §15.1). Scenes read these tokens instead of
 * carrying their own numbers, so a change stays consistent and `prefers-reduced-motion` is
 * handled once, at the token layer, rather than per component.
 */
export const MOTION_CSS = `:root{--sf-dur-instant:90ms;--sf-dur-quick:150ms;--sf-dur-base:200ms;--sf-dur-slow:320ms;
--sf-ease-out:cubic-bezier(.22,.61,.36,1);--sf-ease-in-out:cubic-bezier(.4,0,.2,1);--sf-sweep:2.8s}
@media(prefers-reduced-motion:reduce){:root{--sf-dur-instant:1ms;--sf-dur-quick:1ms;--sf-dur-base:1ms;--sf-dur-slow:1ms;--sf-sweep:0s}}`

/** Scene durations from PRD §10.2, kept together so the table is reviewable in one place. */
export const SCENE = { wizardStep: 200, wizardShift: 10, viewSwitch: 190, press: 100, listShift: 190,
  menu: 150, overlay: 210, overlayShift: 10, panel: 210, candidate: 200, status: 150 } as const
