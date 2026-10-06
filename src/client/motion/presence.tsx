import React from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { SCENE } from './tokens.ts'

/**
 * Enter/exit coordination (SPEC v1.2 §15.2). Only the cases where an element has to outlive
 * its own state change go through here — an overlay, a candidate, a panel, a step change.
 * Hover, press, focus and the generation sweep stay plain CSS, because a library buys nothing
 * there and every animated node costs measurement.
 *
 * `MotionConfig reducedMotion="user"` makes this subtree follow the OS setting; the CSS tokens
 * shorten the transitions Motion does not own, so both paths honour it.
 */
export function SfMotion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}

const ease = [0.22, 0.61, 0.36, 1] as const
export type SfPresenceProps = { open: boolean; children: React.ReactNode; className?: string; offset?: number
  role?: React.AriaRole; label?: string }

/** Vertical enter/exit: the bottom overlay must not push the text above it while it moves. */
export function SfPresence({ open, children, className, offset = SCENE.overlayShift, role, label }: SfPresenceProps) {
  return <AnimatePresence>
    {open && <motion.div className={className} role={role} aria-label={label}
      initial={{ opacity: 0, y: offset }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: offset }}
      transition={{ duration: SCENE.overlay / 1000, ease }}>
      {children}
    </motion.div>}
  </AnimatePresence>
}

/**
 * Step transition whose direction follows the user's own navigation, so going back does not
 * look like going forward (PRD §10.2). `mode="wait"` keeps two steps from being operable at
 * once, and the outgoing step loses its interaction as soon as the key changes.
 */
export function SfStep({ stepKey, direction, children }: { stepKey: string | number; direction: 1 | -1; children: React.ReactNode }) {
  return <AnimatePresence mode="wait" initial={false}>
    <motion.div key={stepKey} initial={{ opacity: 0, x: direction * SCENE.wizardShift }} animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -direction * SCENE.wizardShift }} style={{ minHeight: 0 }}
      transition={{ duration: SCENE.wizardStep / 1000, ease }}>
      {children}
    </motion.div>
  </AnimatePresence>
}

/** A list row that arrived or moved. Used for outline rows and issue groups, never for prose. */
export function SfRow({ children, id }: { children: React.ReactNode; id: string }) {
  return <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
    transition={{ duration: SCENE.listShift / 1000, ease }} data-sf-row={id}>{children}</motion.div>
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/**
 * Runs `work` only while `active`, stopping when it turns false, when the document is hidden,
 * and on unmount — so a finished or unmounted candidate cannot keep animating or keep a timer
 * alive (SPEC v1.2 §15.3). A hidden page pauses the visuals without cancelling the task.
 */
export function useWhileVisible(active: boolean, work: (signal: AbortSignal) => void, deps: unknown[] = []) {
  React.useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const run = () => { if (!document.hidden) work(controller.signal) }
    run()
    document.addEventListener('visibilitychange', run)
    return () => { document.removeEventListener('visibilitychange', run); controller.abort('inactive') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps])
}
