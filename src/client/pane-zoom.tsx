import React, { useLayoutEffect, useRef, useState } from 'react'

const clamp = (value: number) => Math.max(.5, Math.min(2, Math.round(value * 100) / 100))
export function usePaneZoom(key: string, surface: React.RefObject<HTMLElement | null>) {
  const [zoom, setZoom] = useState(() => {
    try { const saved = Number(localStorage.getItem(key)); return Number.isFinite(saved) && saved >= .5 && saved <= 2 ? saved : 1 }
    catch { return 1 }
  })
  const current = useRef(zoom), remainder = useRef(0), frame = useRef(0)
  const scheduled = useRef<number | undefined>(undefined)
  const anchor = useRef<{ top: number; left: number; x: number; y: number; ratio: number } | undefined>(undefined)
  const change = (value: number, x?: number, y?: number) => {
    const node = surface.current, next = clamp(value)
    if (!node || next === current.current) return
    const box = node.getBoundingClientRect(), ax = x ?? box.width / 2, ay = y ?? box.height / 2
    anchor.current = { top: node.scrollTop, left: node.scrollLeft, x: ax, y: ay, ratio: next / current.current }
    current.current = next; setZoom(next)
  }
  useLayoutEffect(() => {
    const node = surface.current, held = anchor.current
    if (node && held) { node.scrollTop = (held.top + held.y) * held.ratio - held.y; node.scrollLeft = (held.left + held.x) * held.ratio - held.x }
    anchor.current = undefined
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
