import { mirrorOf } from './source-measure.ts'

/**
 * Line numbers follow visual rows (SF-086): a wrapped paragraph keeps its number on its first row
 * and the rows it wraps into stay blank, the way every editor draws it.
 *
 * The heights come from a copy the browser lays out at the pane's own width, so they cannot drift
 * from the pane's own wrapping. The write and the read are separated on purpose: every block goes
 * into the document before the first height is read, so the browser lays the document out once
 * instead of once per line.
 *
 * This is derived view state. A hidden pane, an unchanged pane, or a measurement that cannot run
 * leaves the gutter exactly as it was: nothing here may block editing or touch project data.
 */
const measured = new WeakMap<HTMLTextAreaElement, [width: number, fontSize: string, text: string]>()

export function applyGutterRows(gutter: HTMLElement, area: HTMLTextAreaElement, text: string): void {
  const cells = gutter.children
  const previous = measured.get(area), fontSize = window.getComputedStyle(area).fontSize
  // The pane's width and font size decide where it breaks lines, so an unchanged pane is skipped.
  if (!cells.length || !area.clientWidth) return
  if (previous && previous[0] === area.clientWidth && previous[1] === fontSize && previous[2] === text) return
  const mirror = mirrorOf(area)
  const blocks = text.split(/\r\n|\r|\n/).map(line => {
    const block = document.createElement('div')
    // An empty logical line still occupies one row; a zero-width space gives it a line box.
    block.textContent = line === '' ? '\u200b' : line
    mirror.append(block)
    return block
  })
  document.body.append(mirror)
  try {
    const heights = blocks.map(block => block.offsetHeight)
    for (const [index, height] of heights.entries()) {
      const cell = cells[index] as HTMLElement | undefined
      if (cell) cell.style.height = `${height}px`
    }
    measured.set(area, [area.clientWidth, fontSize, text])
  } finally { mirror.remove() }
}
