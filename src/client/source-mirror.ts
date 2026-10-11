/** Source rewrite targets use measured background chips. Native textarea glyphs and selection
 * remain untouched, including during composition (SF-163). */
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

/** Paint one background chip per actual visual line; scrolling moves the shared layer. */
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
    layer.append(paper)
    layer.dataset.state = range.state
    if (host) host.dataset.marked = ''

  } catch { clear() }
}
