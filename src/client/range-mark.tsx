import React, { useLayoutEffect, useRef } from 'react'
import { paintSourceMark, type MarkRange } from './source-mirror.ts'

/** A mark exists while its range still means something; a decided candidate leaves nothing behind. */
export type { MarkRange }

/**
 * The highlight on the selected text in the Markdown pane (SF-087, and v1.6's SF-090).
 *
 * A `textarea` renders its own glyphs, so this pane cannot colour them the way the preview can. What
 * it can do is put a mirror behind them: a laid-out copy of the pane's own text, measured off the
 * pane so it wraps exactly where the pane wraps, whose marked slice carries the same gradient the
 * preview puts on its glyphs. The pane's own glyphs step aside for as long as a mark exists — and
 * never while an input method is composing, because the composition preview is painted in the
 * pane's text colour and the characters being spelled have to stay visible.
 *
 * Derived view state only: a hidden pane, an invalid range or a failed measurement paints nothing
 * and leaves the pane exactly as it was, which is also what takes the glyphs back out of their
 * transparent state.
 */
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

/**
 * The marking language, in one place: both panes colour the glyphs themselves with the same
 * gradient, the same period and the same flow switch. Colour and motion come from the token layer,
 * so reduced motion and the hidden-window pause are handled once (motion/tokens.ts).
 */
export const RANGE_MARK_CSS = `
.sf-source-marks{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.sf-source-marks>div{position:absolute;inset:0;will-change:transform}
/* The source pane's mirror (SPEC v1.6 §3): the pane's own text laid out again behind the textarea,
   with the marked slice carrying the same rule the preview puts on its glyphs — same gradient, same
   period, same flow switch. Every metric comes from the pane (mirrorMetrics), so the copy wraps
   where the pane wraps; the chips behind it give the gradient its paper in either theme. */
.sf-source-mirror{position:absolute;left:0;top:0;color:var(--sf-text);white-space:pre-wrap;overflow:hidden;pointer-events:none;z-index:1}
.sf-source-paper{position:absolute;inset:0}
.sf-source-paper>i{position:absolute;background:var(--sf-mark-paper);border-radius:var(--sf-mark-radius);z-index:0}
/* The pane's own glyphs step aside only while a mirror is up, and never during an input-method
   composition: the composition preview is painted in the textarea's own text colour, so transparent
   text would hide the very characters being spelled. The caret keeps its own colour for the same
   reason the transparent text colour cannot supply one. */
.sf-source-editor[data-mirrored]:not([data-composing]) textarea.sf-source-input{color:transparent;caret-color:var(--sf-text)}
/* While composing, the mirror steps out of the way entirely: the pane's value does not contain the
   composing text yet, so the mirror could not show it even if it tried. */
.sf-source-editor[data-composing] .sf-source-mirror{visibility:hidden}
/* One gradient for both panes. It tiles at a fixed pixel period whose first and last stops match, so
   a line shorter than the period still shows a full sweep of hues and a longer one shows whole
   cycles. */
.sf-mark-inline{background-image:var(--sf-mark-gradient);background-size:var(--sf-mark-period) 100%;background-repeat:repeat-x;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  -webkit-box-decoration-break:slice;box-decoration-break:slice}
/* Only a running generation flows, and the switch is off by default: the painter writes data-flow
   from the single truth (state === 'generating'), so a state added later cannot forget to stop.
   Longhand rather than the animation shorthand on purpose: the shorthand resets play-state, and
   the hidden-window pause in motion/tokens.ts is less specific than this rule, so a shorthand here
   would quietly unpause a hidden window. */
.sf-mark-inline[data-flow=on]{animation-name:sf-range-flow;animation-duration:var(--sf-sweep,2.8s);
  animation-timing-function:var(--sf-ease-in-out,cubic-bezier(.4,0,.2,1));animation-iteration-count:infinite}
/* One period per loop: the keyframes move the gradient by exactly that period. The displacement is a
   real length — moving a percentage of a box that already equals the image width (100% 100%)
   displaces nothing at all, which is how the flow used to never happen. */
@keyframes sf-range-flow{from{background-position:0 0}to{background-position:calc(-1 * var(--sf-mark-period)) 0}}
/* slice, not clone: clone repaints the whole gradient per wrapped fragment, so every line restarted
   at the first stop and a marked paragraph read as a row of colour blocks. slice lets one span's
   background run continuously across its line breaks. */
/* The platform paints an opaque block over a selection, which hides the colour on the glyphs. So
   over the mark the selection becomes a light tint that colour shows through, and the text keeps its
   own colour instead of the platform's contrast colour. In the preview only the marked text is
   treated this way: a selection elsewhere keeps the platform default, because then there is no mark
   to see instead. The tint is deliberately faint — it sits above the glyphs, so every point of it
   dilutes the hues the mark exists to show. */
.sf-source-editor[data-marked] textarea.sf-source-input::selection,
.sf-mark-inline::selection{background:var(--sf-selection-tint);color:inherit}
`
