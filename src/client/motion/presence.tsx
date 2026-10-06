import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import React, { useEffect, useRef, useState } from 'react'

/**
 * Exit coordination without a state machine in every call site (SPEC v1.2 §15.2).
 *
 * A component that disappears when `open` turns false cannot animate out, so the element has
 * to outlive the state change by exactly one transition. `usePresence` keeps it mounted for
 * that long and reports which phase to render. Interruption is inherent: a reopen during the
 * leave cancels the teardown instead of queueing behind it, and the CSS transition retargets
 * from whatever the computed value currently is.
 *
 * This is deliberately the whole mechanism: no timeline, no queue, no animation scheduler.
 */
export type PresencePhase = 'entering' | 'shown' | 'leaving' | 'gone'

export function usePresence(open: boolean, durationMs: number) {
  const [phase, setPhase] = useState<PresencePhase>(open ? 'entering' : 'gone')
  const timer = useRef<number | undefined>(undefined)
  const first = useRef(true)

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (open) {
      // On the very first render the element is already at its resting state; replaying the
      // entrance would make a restored panel flash on every page refresh (PRD §10.1).
      setPhase(first.current ? 'shown' : 'entering')
      if (!first.current) timer.current = window.setTimeout(() => setPhase('shown'), 0)
      first.current = false
      return
    }
    setPhase(previous => previous === 'gone' ? 'gone' : 'leaving')
    timer.current = window.setTimeout(() => setPhase('gone'), durationMs)
    return () => window.clearTimeout(timer.current)
  }, [open, durationMs])

  return { mounted: phase !== 'gone', phase, hiding: phase === 'leaving' }
}

/**
 * Applies the entrance transform only while the entrance is playing, so the resting element
 * carries no transform. That matters for the editor: a transform on an ancestor changes the
 * coordinate base selection rectangles are measured against (SPEC v1.2 §15.2).
 */
export function presenceStyle(phase: PresencePhase, offset = 10): React.CSSProperties {
  if (phase === 'entering') return { transform: `translateY(${offset}px)`, opacity: 0 }
  if (phase === 'leaving') return { transform: `translateY(${Math.round(offset * 0.8)}px)`, opacity: 0 }
  return { transform: 'none', opacity: 1 }
}

/** True while the OS asks for less motion; the CSS tokens already shorten durations. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/**
 * Runs `work` only while `active` is true, and stops on deactivate/unmount. Loop effects are
 * scoped to a component so a finished or unmounted candidate cannot keep animating
 * (SPEC v1.2 §15.3).
 */
export function useWhileVisible(active: boolean, work: (signal: AbortSignal) => void, deps: unknown[] = []) {
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    work(controller.signal)
    const onHidden = () => { if (document.hidden) controller.abort('hidden') }
    document.addEventListener('visibilitychange', onHidden)
    return () => { document.removeEventListener('visibilitychange', onHidden); controller.abort('deps') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps])
}


/** Probe used by the W2 gate: proves the library evaluates inside the host loader. */
export function MotionProbe({ open }: { open: boolean }) {
  return <MotionConfig reducedMotion="user">
    <AnimatePresence>{open && <motion.div key="probe" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>probe</motion.div>}</AnimatePresence>
  </MotionConfig>
}
