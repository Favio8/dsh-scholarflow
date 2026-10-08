/**
 * Measuring a `textarea`'s own layout.
 *
 * A textarea exposes no per-character geometry, so the pane builds a hidden copy that the browser
 * lays out and reads the rectangles back. The copy has to be indistinguishable from the pane in
 * everything that decides where a character lands — including the wrapping properties: while the
 * pane did not wrap, a wrong copy width could not move a character, but once it wraps, the copy's
 * width decides where the line breaks.
 *
 * No React and no other client module here, so the render check can bundle this file straight into
 * a browser page and measure the real implementation.
 */

/** Every property that decides where a character lands, taken from the pane's computed style. */
export const MEASURE_PROPERTIES = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'tab-size', 'padding', 'border', 'white-space', 'overflow-wrap', 'word-break']

/**
 * A hidden, laid-out copy of the pane at the pane's own content width, positioned so that a
 * rectangle read from it is already a viewport rectangle for the pane's current scroll. The caller
 * appends what it wants to measure and removes the copy when it is done.
 */
export function mirrorOf(area: HTMLTextAreaElement) {
  const style = window.getComputedStyle(area), bounds = area.getBoundingClientRect()
  const mirror = document.createElement('div')
  for (const property of MEASURE_PROPERTIES) mirror.style.setProperty(property, style.getPropertyValue(property))
  // The copy's box model is fixed rather than inherited: it has to reproduce the pane's *content*
  // width whatever the pane's own `box-sizing` happens to be, or the copy breaks lines somewhere
  // else. `clientWidth` excludes the scrollbar and the border, so subtracting the padding gives that
  // width exactly, and `content-box` makes it the width the layout actually uses.
  const padLeft = parseFloat(style.paddingLeft) || 0, padRight = parseFloat(style.paddingRight) || 0
  const border = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)
  const fallback = bounds.width - border - padLeft - padRight
  Object.assign(mirror.style, { boxSizing: 'content-box', position: 'fixed', visibility: 'hidden', pointerEvents: 'none',
    left: `${bounds.left - area.scrollLeft}px`, top: `${bounds.top - area.scrollTop}px`,
    width: `${area.clientWidth ? area.clientWidth - padLeft - padRight : fallback}px` })
  return mirror
}
