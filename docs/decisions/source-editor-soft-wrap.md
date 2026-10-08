# Source pane soft wrapping

Date: 2026-10-08. Requirements: SF-086 / AT-86 in `dsh-scholarflow-ai/docs/ScholarFlow_PRD_v1.4.md`
and `ScholarFlow_Design_SPEC_v1.4.md`. Targets installed Windows DSH Desktop 0.2.0-rc.2.

## What changed

The Markdown source pane is a `textarea` with a separate line-number column. It was pinned to
`wrap="off"` plus `white-space: pre`, so a paragraph was one long row and the reader had to scroll
sideways to read it. The pane now soft-wraps.

Three places assumed one logical line occupies one visual row, and wrapping breaks all three:

| Assumption | Where | Now |
|---|---|---|
| One gutter cell per logical line | `draft.tsx` line-number column | The column's cells are measured against the pane's own layout and each is set to its paragraph's wrapped height, so a number sits on its paragraph's first row and the rows it wraps into stay blank |
| A line index maps to a vertical offset | The 目录 jump used `line index × 24 × zoom − 40` | `revealSourceOffset` measures the target offset's rectangle and scrolls by the difference |
| The scroll extent scales with the zoom ratio | `usePaneZoom` scaled `scrollTop` by the ratio | The source pane keeps the offset under the anchor instead; the preview keeps the proportional default, which is exact for its CSS `zoom` |

The line height `24` had been written twice, in the CSS variable and in the jump arithmetic. It now
exists once, in `--sf-editor-line`.

## The measurement contract

Coordinates were already measured rather than computed: `sourceRangeRect` builds a hidden copy of
the pane and reads the browser's own layout back. Two things had to change for that to stay true
once the pane wraps:

- The copy inherited a hard-coded non-wrapping `white-space`. It now copies `white-space`,
  `overflow-wrap` and `word-break` from the pane. While the pane did not wrap, a wrong copy width
  could not move a character; once it wraps, the copy's width **decides where the line breaks**.
- The copy's width was the pane's border-box width. `clientWidth` excludes the scrollbar and the
  border, so the copy is now given the pane's **content** width and a fixed `content-box` model.
  This is deliberately independent of the pane's own `box-sizing`: the first attempt inherited it
  and was wrong by the padding whenever the two disagreed, which the render gate caught at once
  (the column came out 96 px and 600 px shorter than the pane at the two viewport sizes).

`source-measure.ts` holds that contract for both the selection geometry and the line-number column,
so the two cannot drift apart. It imports nothing, which also lets the render check bundle it
straight into a page.

## Cost and failure behaviour

The column is measured once per text change, batched into an animation frame, and skipped when the
pane's width, font size and text are unchanged; a `ResizeObserver` covers pane resizes, which change
the wrapping without changing the text. Writing all the heights and only then reading them keeps it
to a single layout. A hidden pane, or a measurement that cannot run, leaves the column as it was
rather than blocking editing.

The zoom anchor searches for the offset under the anchor by bisection, which is about 14 measurements
of the pane's layout, and only when the user zooms. That is deliberately not on the keystroke path,
but it is the one place where a large document could feel slow, so the desktop performance run below
is what decides whether it needs to change.

## Evidence

Reproducible without a host (`pnpm render:surfaces`, real Chromium, the shipped module bundled into
the page rather than re-implemented): a long paragraph occupies 40 rows at 1060 px and 137 rows at
380 px, horizontal overflow is 0 px, and the line-number column measures 1248/1248 px and 3576/3576 px
against the pane's own content height. The gate fails when the column drifts, is not contiguous, is
not a whole number of rows, or when the long paragraph does not wrap at all.

Not verified here, and **the earlier evidence for these is void** because it was taken with the pane
not wrapping: AT-71, AT-72 and AT-73, and the typing performance baseline (v1.3 recorded p95 24.1 ms
and a 57.3 ms maximum). They need `tests/e2e/draft-scroll.mjs` and
`tests/e2e/workbench-performance.mjs` re-run on the installed host. Static rendering is not a
substitute for that run, and no pass is claimed until it happens.
