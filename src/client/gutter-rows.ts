import { mirrorOf, MEASURE_PROPERTIES } from './source-measure.ts'

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
type Measurement = { signature: string; text: string; heights: Map<string, number> }
const measured = new WeakMap<HTMLTextAreaElement, Measurement>()

export function applyGutterRows(gutter: HTMLElement, area: HTMLTextAreaElement, text: string): void {
  const cells = gutter.children
  const previous = measured.get(area), style = window.getComputedStyle(area)
  // Every layout property is part of the cache key, including the font family (SF-134).
  const signature = [area.clientWidth, ...MEASURE_PROPERTIES.map(property => style.getPropertyValue(property))].join('|')
  if (!cells.length || !area.clientWidth) return
  if (previous?.signature === signature && previous.text === text) return
  const lines = text.split(/\r\n|\r|\n/)
  const reusable = previous?.signature === signature ? previous.heights : new Map<string, number>()
  const missing = [...new Set(lines)].filter(line => !reusable.has(line))
  const mirror = missing.length ? mirrorOf(area) : undefined
  const blocks = missing.map(line => {
    const block = document.createElement('div')
    // An empty logical line still occupies one row; a zero-width space gives it a line box.
    block.textContent = line === '' ? '\u200b' : line
    mirror!.append(block)
    return block
  })
  if (mirror) document.body.append(mirror)
  try {
    const newlyMeasured = new Map(missing.map((line, index) => [line, blocks[index]!.offsetHeight]))
    // Keep only this document's current unique lines; typing cannot grow the cache forever.
    const heights = new Map(lines.map(line => [line, reusable.get(line) ?? newlyMeasured.get(line)!]))
    for (const [index, line] of lines.entries()) {
      const cell = cells[index] as HTMLElement | undefined
      const value = `${heights.get(line)}px`
      if (cell && cell.style.height !== value) cell.style.height = value
    }
    measured.set(area, { signature, text, heights })
  } finally { mirror?.remove() }
}
