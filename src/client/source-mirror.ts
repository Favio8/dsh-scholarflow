/**
 * The source pane's half of the mark, as its own module with no React in it (SPEC v1.6 §3).
 *
 * A `textarea` renders its own glyphs and cannot colour them, so the pane that wants gradient *text*
 * — the same visual language the preview already has — gets it from a mirror: a laid-out copy of the
 * pane's own text whose marked slice carries the gradient, sitting behind a textarea whose glyphs
 * step aside for as long as the mark exists. The copy has to be indistinguishable from the pane in
 * everything that decides where a character lands, which is the same problem — and the same measured
 * answer — the line numbers and the selection menu already solved in source-measure.ts.
 *
 * No React and no other client module here beyond the measurement primitives, so the render check can
 * bundle this file straight into a browser page and measure the real implementation.
 */

import { lineBoxes, sourceRangeRects } from './source-measure.ts'

/** A mark exists while its range still means something; a decided candidate leaves nothing behind. */
export type MarkRange = { start: number; end: number; state: string }
const visible = (state: string) => state !== 'accepted' && state !== 'discarded'

/** Every property that decides where a character lands in the copy, plus the box it lands in. */
const TEXT_PROPERTIES = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'wordSpacing', 'textIndent', 'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize'] as const
const BOX_PROPERTIES = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'] as const

/**
 * The mirror's metrics, read off the pane rather than assumed: it has to wrap and align exactly where
 * the pane does, and the only trustworthy source for that is the pane's own computed style. The width
 * is the pane's `clientWidth`, which already excludes the scrollbar and the border, so the copy's
 * content width comes out equal whatever the pane's box-sizing happens to be.
 */
export function mirrorMetrics(area: HTMLTextAreaElement) {
  const style = window.getComputedStyle(area)
  const metrics: Record<string, string> = { width: `${area.clientWidth}px`, boxSizing: 'border-box' }
  for (const property of [...TEXT_PROPERTIES, ...BOX_PROPERTIES]) metrics[property] = style[property]
  return metrics
}

/**
 * The pane's text split around the marked range, so the mirror can render it as three nodes and the
 * middle one can carry the gradient. Out-of-range bounds are clipped rather than trusted, and an
 * empty range splits nothing: the caller then paints no mark at all.
 */
export function splitPaneText(value: string, start: number, end: number) {
  const from = Math.max(0, Math.min(start, value.length))
  const to = Math.max(from, Math.min(end, value.length))
  if (to <= from) return undefined
  return { before: value.slice(0, from), marked: value.slice(from, to), after: value.slice(to) }
}

/**
 * Paint the mark into the pane's mark layer: one paper chip per visual line behind the range, and the
 * mirror of the pane's text with the marked slice wrapped in the shared `.sf-mark-inline` rule — so
 * the flow switch, the hidden-window pause and the selection tint are the preview's own, not a second
 * copy. Imperative on purpose: an input rewrites three text nodes instead of a React tree.
 *
 * The layer is left empty and unmarked when there is nothing to show — a hidden pane, an invalid
 * range, a failed measurement — and the pane then looks exactly as it did without a mark, which is
 * also what takes the textarea's glyphs back out of their transparent state.
 */
export function paintSourceMark(layer: HTMLElement, area: HTMLTextAreaElement, range?: MarkRange, host?: HTMLElement | null) {
  const clear = () => {
    layer.replaceChildren()
    delete layer.dataset.state
    delete layer.dataset.flow
    if (host) { delete host.dataset.marked; delete host.dataset.mirrored }
  }
  clear()
  if (!range || !visible(range.state) || area.clientWidth <= 0 || range.end <= range.start) return
  try {
    // Chip geometry is in the pane's border-box coordinates (the same convention the bands used), so
    // the layer's one transform still follows a scroll without re-measuring anything.
    const line = parseFloat(window.getComputedStyle(area).lineHeight)
    const paper = document.createElement('div')
    paper.className = 'sf-source-paper'
    for (const rect of lineBoxes(sourceRangeRects(area, range.start, range.end), line)) {
      const chip = document.createElement('i')
      Object.assign(chip.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
      paper.append(chip)
    }
    const mirror = document.createElement('div')
    mirror.className = 'sf-source-mirror'
    mirror.setAttribute('aria-hidden', 'true')
    Object.assign(mirror.style, mirrorMetrics(area))
    const parts = splitPaneText(area.value, range.start, range.end)
    if (parts) {
      mirror.append(document.createTextNode(parts.before))
      const marked = document.createElement('span')
      marked.className = 'sf-mark-inline'
      marked.dataset.sfMarked = 'true'
      marked.dataset.flow = range.state === 'generating' ? 'on' : 'off'
      marked.textContent = parts.marked
      // A pane whose text ends in a newline still shows one more row than a laid-out copy does,
      // because the caret can sit on it; a zero-width space gives that row a box, the same way the
      // line numbers give one to an empty line (gutter-rows.ts).
      const trailing = area.value.endsWith('\n') ? '​' : ''
      mirror.append(marked, document.createTextNode(parts.after + trailing))
    }
    layer.append(paper, mirror)
    layer.dataset.state = range.state
    // The flow switch is written from the same single truth the preview uses, and the animation is
    // off by default in CSS, so a state that forgets to flow is the only way to get this wrong.
    layer.dataset.flow = range.state === 'generating' ? 'on' : 'off'
    // The platform selection colour is opaque and would hide the mark, so while a range is marked
    // the pane switches to a tint the mark shows through (see RANGE_MARK_CSS). `data-mirrored` is the
    // separate signal that a mirror is actually up, which is what lets the pane's own glyphs step
    // aside; a mark painted any other way never sets it.
    if (host) { host.dataset.marked = ''; host.dataset.mirrored = '' }
  } catch { clear() }
}
