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
    if (host.current) delete host.current.dataset.marked
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
      // The flow switch is written from the same single truth the preview uses, and the animation is
      // off by default in CSS, so a state that forgets to flow is the only way to get this wrong.
      node.dataset.flow = range.state === 'generating' ? 'on' : 'off'
      // The platform selection colour is opaque and would hide the bands, so while a range is marked
      // the pane switches to a tint the mark shows through (see RANGE_MARK_CSS).
      if (host.current) host.current.dataset.marked = ''
      place(input, node)
    } catch { node.replaceChildren(); delete node.dataset.state; if (host.current) delete host.current.dataset.marked }
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
/* A band sits behind text, so it is a wash rather than a fill and its chroma is bounded by how light
   it must stay. The two themes bound it from opposite sides: on a light page dark text needs the band
   to stay light, on a dark page light text needs it to stay dark. So each theme gets the most colour
   it can carry — measured, not guessed: the light theme's band still leaves the text 7:1 and the dark
   theme's worst stop computes to 5:1. The per-theme opacity lives in src/client/theme/tokens.ts and
   keys off body[data-ds-dark-theme], so a dark workbench under a light system gets the dark value.
   The gradient itself is one token for both themes: v1.6 moves both panes onto gradient glyphs on
   paper, and the band model below is what that replaces. */
.sf-source-marks{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.sf-source-marks>div{position:absolute;inset:0;will-change:transform}
.sf-range-band{position:absolute;border-radius:var(--sf-mark-band-radius);opacity:var(--sf-mark-band-opacity);
  background-image:var(--sf-mark-gradient);background-size:var(--sf-mark-period) 100%;background-repeat:repeat-x}
/* Only a running generation flows, and the switch is off by default: the component writes data-flow
   from the single truth (state === 'generating'), so a state added later cannot forget to stop.
   Longhand rather than the animation shorthand on purpose: the shorthand resets play-state, and
   the hidden-window pause in motion/tokens.ts is less specific than this rule, so a shorthand here
   would quietly unpause a hidden window. */
.sf-source-marks>div[data-flow=on] .sf-range-band{animation-name:sf-range-flow;animation-duration:var(--sf-sweep,2.8s);
  animation-timing-function:var(--sf-ease-in-out,cubic-bezier(.4,0,.2,1));animation-iteration-count:infinite}
/* One period per loop: the gradient tiles at a fixed pixel period whose first and last stops match,
   and the keyframes move it by exactly that period. The displacement is a real length — moving a
   percentage of a box that already equals the image width (100% 100%) displaces nothing at all,
   which is how the flow used to never happen. */
@keyframes sf-range-flow{from{background-position:0 0}to{background-position:calc(-1 * var(--sf-mark-period)) 0}}
.sf-mark-inline{background-image:var(--sf-mark-gradient);background-size:var(--sf-mark-period) 100%;background-repeat:repeat-x;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  -webkit-box-decoration-break:slice;box-decoration-break:slice}
/* slice, not clone: clone repaints the whole gradient per wrapped fragment, so every line restarted
   at the first stop and a marked paragraph read as a row of colour blocks. slice lets one span's
   background run continuously across its line breaks. */
.sf-mark-inline[data-flow=on]{animation-name:sf-range-flow;animation-duration:var(--sf-sweep,2.8s);
  animation-timing-function:var(--sf-ease-in-out,cubic-bezier(.4,0,.2,1));animation-iteration-count:infinite}
/* The platform paints an opaque block over a selection, which hides the band behind the text in the
   source pane and the colour on the glyphs in the preview. So over the mark the selection becomes a
   light tint those show through, and the text keeps its own colour instead of the platform's contrast
   colour. In the preview only the marked text is treated this way: a selection elsewhere keeps the
   platform default, because then there is no mark to see instead. The tint is deliberately faint —
   it sits above the band, so every point of it dilutes the hues the mark exists to show. */
.sf-source-editor[data-marked] textarea.sf-source-input::selection,
.sf-mark-inline::selection{background:var(--sf-selection-tint);color:inherit}
`
