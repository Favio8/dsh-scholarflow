import React, { useLayoutEffect, useRef } from 'react'
import { lineBoxes, sourceRangeRects } from './source-measure.ts'

/** A mark exists while its range still means something; a decided candidate leaves nothing behind. */
export type MarkRange = { start: number; end: number; state: string }
const visible = (state: string) => state !== 'accepted' && state !== 'discarded'

/**
 * The highlight behind the selected text in the Markdown pane (SF-087).
 *
 * A `textarea` renders its own glyphs, so this pane cannot colour the text the way the preview can.
 * What it can do is paint *behind* it: one band per visual line of the target range, taken from the
 * same measured copy the line numbers and the selection menu already use. The text stays legible on
 * top of the band, and scrolling only moves the layer, never re-measures it.
 *
 * Derived view state only: a hidden pane, an invalid range or a failed measurement renders no bands
 * and leaves the pane exactly as it was.
 */
export function SourceRangeMark({ area, host, range, text, zoom }: {
  area: React.RefObject<HTMLTextAreaElement | null>; host: React.RefObject<HTMLElement | null>
  range?: MarkRange; text: string; zoom: number
}) {
  const bands = useRef<HTMLDivElement>(null)
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
    const node = bands.current, input = area.current
    if (!node) return
    node.replaceChildren()
    delete node.dataset.state
    if (!range || !input || !visible(range.state) || input.clientWidth <= 0 || range.end <= range.start) return
    try {
      // Band geometry is in the pane's content coordinates, so scrolling only moves the layer.
      const line = parseFloat(window.getComputedStyle(input).lineHeight)
      for (const rect of lineBoxes(sourceRangeRects(input, range.start, range.end), line)) {
        const band = document.createElement('div')
        band.className = 'sf-range-band'
        Object.assign(band.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
        node.append(band)
      }
      node.dataset.state = range.state
      place(input, node)
    } catch { node.replaceChildren(); delete node.dataset.state }
  }
  // The observer and the scroll listener outlive a render, so they must reach the current closure
  // rather than the one they were created with.
  const latest = useRef(paint)
  latest.current = paint
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => latest.current())
    return () => cancelAnimationFrame(frame)
  }, [text, zoom, range?.start, range?.end, range?.state])
  // The pane's width decides where it wraps, and the bands follow the wrapping rather than the text:
  // a resize while a candidate is open has to re-measure even though nothing else changed.
  useLayoutEffect(() => {
    const container = host.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => latest.current())
    observer.observe(container)
    return () => observer.disconnect()
  }, [host])
  useLayoutEffect(() => {
    const input = area.current
    if (!input) return
    const follow = () => { const node = bands.current; if (node) place(input, node) }
    input.addEventListener('scroll', follow, { passive: true })
    return () => input.removeEventListener('scroll', follow)
  }, [area])
  return <div className="sf-source-marks" aria-hidden="true"><div ref={bands} /></div>
}

/**
 * The marking language, in one place: the band the source pane paints behind its text, and the
 * gradient the preview pane applies to the text itself. Colour and motion come from the token layer,
 * so reduced motion and the hidden-window pause are handled once (motion/tokens.ts).
 */
export const RANGE_MARK_CSS = `
:root{--sf-mark-band-opacity:.3}
.sf-source-marks{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.sf-source-marks>div{position:absolute;inset:0;will-change:transform}
.sf-range-band{position:absolute;border-radius:3px;opacity:var(--sf-mark-band-opacity);
  background-image:linear-gradient(90deg,#f3626b,#eab308,#22c55e,#3b82f6,#a25bf7,#f3626b);background-size:300% 100%;
  animation:sf-range-flow var(--sf-sweep,2.8s) var(--sf-ease-in-out,cubic-bezier(.4,0,.2,1)) infinite}
@keyframes sf-range-flow{from{background-position:0 0}to{background-position:300% 0}}
/* Only a running generation flows: a plain selection or a candidate waiting for review holds still. */
.sf-source-marks>div[data-state]:not([data-state=generating]) .sf-range-band{animation:none;background-position:50% 0}
.sf-mark-inline{background-image:linear-gradient(90deg,#f3626b,#eab308,#22c55e,#3b82f6,#a25bf7,#f3626b);background-size:300% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  -webkit-box-decoration-break:clone;box-decoration-break:clone;
  animation:sf-range-flow var(--sf-sweep,2.8s) var(--sf-ease-in-out,cubic-bezier(.4,0,.2,1)) infinite}
.sf-mark-inline[data-flow=off]{animation:none;background-position:50% 0}
`
