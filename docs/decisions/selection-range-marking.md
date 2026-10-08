# Marking the rewrite range

Date: 2026-10-08. Requirements: SF-087 / AT-87 in `dsh-scholarflow-ai/docs/ScholarFlow_PRD_v1.5.md`
and `ScholarFlow_Design_SPEC_v1.5.md`. Targets installed Windows DSH Desktop 0.2.0-rc.2.

## The problem

Selecting a paragraph, choosing 润色 and submitting left the passage looking untouched: the candidate
appeared elsewhere and nothing in the paragraph said which text was being rewritten. The user asked
for the selection to be visibly marked, with the flowing rainbow gradient they associate with Gemini.

## Two surfaces, two renderings

The same visual language needs two implementations because the panes are not equally capable:

- The **preview** pane is rendered DOM, so it can colour the glyphs themselves:
  `background-clip: text` with `color: transparent`, animated by `background-position`.
- The **source** pane is a `textarea`. It renders its own glyphs and exposes no way to colour a part
  of them, so the mark is painted *behind* the text: one band per visual line, the highlighter-pen
  reading of the same gradient. The text stays legible on top.

Marking is display only. `textarea.value`, source offsets, `trackRange` and the accept-then-write
contract are untouched.

## Preview: splitting text leaves

The projection already carries a character-level map: `Leaf.units` spans both the rendered text and
the source, contiguously. So a source range is intersected with a leaf and the intersection is turned
into rendered offsets — no second Markdown parse, and no guessing:

- the slice runs from the first unit ending after the range start to the last unit starting before
  its end;
- boundaries snap to **whole units**, because a decoded escape or entity is not the same length in
  the two spaces and interpolating inside one would land on the wrong character;
- a leaf that is not `mappable`, or a range that does not overlap it, marks nothing — better no mark
  than a wrong one;
- only `text` nodes go through this path, so formulas, inline code, raw HTML, images and tables stay
  exactly as they were. `tests/contracts/range-mark.test.ts` bundles the real `MarkdownView`, renders
  it in Node and asserts both: the three text leaves around a formula and a code span are marked, and
  every marked span contains text only.

## Source: bands behind the text

The rects come from the copy `source-measure.ts` already builds for the selection menu and the line
numbers — same width, same font, same wrapping — so a wrapped range yields one rect per visual line.
`sourceRangeRects` returns them in the pane's **content coordinates**, so scrolling moves the layer
with a transform instead of re-measuring, and the wrapping added in v1.4 means there is never a
horizontal offset to carry.

Two defects surfaced while building this, both caught by the checks rather than by inspection:

1. **A 48 px origin error.** The rects are relative to the `textarea`, but the layer covers the whole
   editor row — the line-number column sits between the two origins, so every band was painted one
   gutter to the left. The layer now measures the difference between the two boxes and translates by
   it, and the scroll handler reuses that offset.
2. **Stripes instead of a highlight.** `getClientRects()` reports the glyph box, which is shorter
   than the line box (15 px against 24 px here), so consecutive rows were separated by a 9 px gap.
   `lineBoxes` snaps each rect to the line box it sits in — the inline box is centred, so half the
   difference is the half-leading above it. `lineBoxes` lives in `source-measure.ts` so the component
   and the check cannot drift apart.

## State and motion

`generating` flows; `ready`, `stopped` and `failed` keep the colour but stop moving; an accepted or
discarded candidate leaves nothing behind. Duration and easing come from the token layer, so reduced
motion already stops it, and the animations joined the hidden-window pause list. Continuous motion
only moves `background-position`.

## Candidate placement

The preview now shows the candidate after its paragraph whenever the preview is visible, instead of
only when the selection was made there. With a source-side selection the user previously saw the
candidate in the source pane's reserved row and nothing in the preview — the pane that *can* show
"paragraph, then generated text" was suppressed. Both places render the same candidate and the same
state, so accept, discard and re-edit remain one set of actions.

Still not possible, and deliberately not attempted: inserting the generated text *between* source
lines. A `textarea` cannot gain lines without its value changing, and changing the value means writing
to the manuscript before acceptance.

## Evidence

Reproducible without a host:

- `pnpm render:surfaces` (real Chromium, the shipped modules bundled into the page) marks the long
  paragraph and asserts one band per wrapped row — 40 bands for the 40 rows at 1060 px and 137 for
  137 rows at 420 px, each band exactly one line tall, contiguous, inside the pane's content box,
  flowing while generating and stopped once ready. It fails if the count collapses, drifts from the
  rows, gaps, overflows or keeps flowing.
- `tests/contracts/range-mark.test.ts` renders the real `MarkdownView` in Node for the preview side.
- Domain suite 458/458 (453 plus the five new ones), build and typecheck pass. `client.js` 4,105,827
  bytes, +6,485.

Not verified, and still owed from the previous version: AT-87's zoom, narrow-column, scroll and
view-switching cases, the readability of the band in both themes, and the AT-71/AT-72/AT-73 and typing
baseline re-runs that v1.4 left void. Those need the installed host and a human eye; no pass is
claimed here.
