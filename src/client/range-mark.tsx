import React, { useLayoutEffect, useRef } from 'react'
import { paintSourceMark, type MarkRange } from './source-mirror.ts'

/** A mark exists while its range still means something; a decided candidate leaves nothing behind. */
export type { MarkRange }

/** The source pane keeps its native text and draws only the submitted rewrite target. */
export function SourceRangeMark({ area, host, range, text, zoom }: {
  area: React.RefObject<HTMLTextAreaElement | null>; host: React.RefObject<HTMLElement | null>
  range?: MarkRange; text: string; zoom: number
}) {
  const stack = useRef<HTMLDivElement>(null)
  // The rects are relative to the textarea, while the layer covers the whole editor row, so the
  // gutter's width sits between the two origins. Measured rather than assumed, and reused by the
  // scroll handler so following a scroll costs one transform and no measurement.
  const origin = useRef({ x: 0, y: 0 })
  const place = (input: HTMLTextAreaElement, node: HTMLElement) => {
    const box = node.parentElement?.getBoundingClientRect(), area = input.getBoundingClientRect()
    if (box) origin.current = { x: area.left - box.left, y: area.top - box.top }
    node.style.transform = `translate(${origin.current.x}px, ${origin.current.y - input.scrollTop}px)`
  }
  const paint = () => {
    const node = stack.current, input = area.current
    if (!node || !input) return
    paintSourceMark(node, input, range, host.current)
    place(input, node)
  }
  // The observer and the scroll listener outlive a render, so they must reach the current closure
  // rather than the one they were created with.
  const latest = useRef(paint)
  latest.current = paint
  // The scroll listener is attached by the first paint rather than beside it: the pane's ref can still
  // be empty when this component's own effects run, and a listener attached to nothing follows
  // nothing — which is how the layer used to stay behind while the line numbers kept up.
  const detach = useRef<(() => void) | null>(null)
  const followScroll = (input: HTMLTextAreaElement) => {
    if (detach.current) return
    const follow = () => { const node = stack.current; if (node) place(input, node) }
    input.addEventListener('scroll', follow, { passive: true })
    detach.current = () => input.removeEventListener('scroll', follow)
  }
  useLayoutEffect(() => () => detach.current?.(), [])
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => { if (area.current) followScroll(area.current); latest.current() })
    return () => cancelAnimationFrame(frame)
  }, [text, zoom, range?.start, range?.end, range?.state])
  // The pane's width decides where it wraps, and the copy follows the wrapping rather than the text:
  // a resize while a candidate is open has to re-measure even though nothing else changed.
  useLayoutEffect(() => {
    const container = host.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => latest.current())
    observer.observe(container)
    return () => observer.disconnect()
  }, [host])
  return <div className="sf-source-marks" aria-hidden="true"><div ref={stack} /></div>
}

/** Ordinary selection and rewrite target have separate visual states (SF-163). */
export const RANGE_MARK_CSS = `
.sf-source-marks{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.sf-source-marks>div{position:absolute;inset:0;will-change:transform}
.sf-source-paper{position:absolute;inset:0}
.sf-source-paper>i{position:absolute;background:var(--sf-accent-soft);border-radius:var(--sf-mark-radius)}
.sf-paper-page .sf-prose{user-select:text;-webkit-user-select:text}
.sf-prose::selection,.sf-prose *::selection,.sf-source-input::selection{background:var(--sf-selection-bg);color:var(--sf-selection-text)}
::highlight(sf-rewrite){background-color:var(--sf-accent-soft)}
`
