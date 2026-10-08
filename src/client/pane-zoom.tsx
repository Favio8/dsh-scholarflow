import React, { useLayoutEffect, useRef, useState } from 'react'

const clamp = (value: number) => Math.max(.5, Math.min(2, Math.round(value * 100) / 100))

/**
 * How a surface keeps its reading position across a zoom change. The default in `usePaneZoom` scales
 * `scrollTop` by the ratio, which is exact only while the scroll extent scales with the ratio — true
 * for the preview's CSS `zoom`, not for the source pane once it wraps (SF-086).
 */
export type ZoomAnchor = {
  /** Snapshot what must stay put, before the new size is laid out. `x`/`y` are relative to the surface box. */
  capture(point: { x: number; y: number }): unknown
  /** Put it back, after the new size is laid out. */
  restore(token: unknown): void
}

export function usePaneZoom(key: string, surface: React.RefObject<HTMLElement | null>, strategy?: ZoomAnchor) {
  const [zoom, setZoom] = useState(() => {
    try { const saved = Number(localStorage.getItem(key)); return Number.isFinite(saved) && saved >= .5 && saved <= 2 ? saved : 1 }
    catch { return 1 }
  })
  const current = useRef(zoom), remainder = useRef(0), frame = useRef(0)
  const scheduled = useRef<number | undefined>(undefined)
  const anchor = useRef<{ top: number; left: number; x: number; y: number; ratio: number; token?: unknown } | undefined>(undefined)
  const change = (value: number, x?: number, y?: number) => {
    const node = surface.current, next = clamp(value)
    if (!node || next === current.current) return
    const box = node.getBoundingClientRect(), ax = x ?? box.width / 2, ay = y ?? box.height / 2
    anchor.current = { top: node.scrollTop, left: node.scrollLeft, x: ax, y: ay, ratio: next / current.current,
      token: strategy?.capture({ x: ax, y: ay }) }
    current.current = next; setZoom(next)
  }
  useLayoutEffect(() => {
    const node = surface.current, held = anchor.current
    anchor.current = undefined
    if (node && held) {
      // A measured anchor is authoritative; the proportional fallback stays for surfaces whose
      // scroll extent really does scale with the ratio.
      if (held.token !== undefined) strategy?.restore(held.token)
      else { node.scrollTop = (held.top + held.y) * held.ratio - held.y; node.scrollLeft = (held.left + held.x) * held.ratio - held.x }
    }
    try { localStorage.setItem(key, String(zoom)) } catch { /* Optional display preferences never block writing. */ }
  }, [zoom, key])
  useLayoutEffect(() => {
    const node = surface.current
    if (!node) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault(); event.stopPropagation()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1)
      if (current.current === 2 && delta < 0 || current.current === .5 && delta > 0) { remainder.current = 0; return }
      remainder.current += delta
      const steps = Math.trunc(remainder.current / 100)
      if (!steps) return
      remainder.current -= steps * 100
      const box = node.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top
      scheduled.current = clamp((scheduled.current ?? current.current) - steps * .05)
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => { const next = scheduled.current!; scheduled.current = undefined; change(next, x, y) })
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => { node.removeEventListener('wheel', wheel); cancelAnimationFrame(frame.current) }
  }, [surface, key])
  return { zoom, change }
}
export function ZoomControls({ label, zoom, change }: { label: string; zoom: number; change: (value: number) => void }) {
  return <span className="sf-pane-zoom" aria-label={`${label}阅读比例`}>
    <button aria-label={`${label}缩小`} onClick={() => change(zoom - .05)}>−</button>
    <button aria-label={`${label}恢复100%`} title="恢复 100%" onClick={() => change(1)}>{Math.round(zoom * 100)}%</button>
    <button aria-label={`${label}放大`} onClick={() => change(zoom + .05)}>＋</button>
  </span>
}
