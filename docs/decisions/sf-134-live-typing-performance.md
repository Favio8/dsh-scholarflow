# SF-134: live typing performance

Date: 2026-10-11. Implements the visual-language PRD performance guard without relaxing
its limit or replacing the textarea/mirror editor.

`src/client/gutter-rows.ts` caches the heights of unchanged logical lines. The key covers
the pane width and every copied layout property, including font family. Only current
document lines are retained, and unchanged cell heights are not rewritten. Real browser
checks edit a line, change the family, change font/line size and restore the original
styles: all nine wide/narrow/dark checks matched the textarea's content height exactly.

`src/client/draft.tsx` formerly parsed the live manuscript for preview, then parsed it a
second time inside word statistics. It now shares the already current AST with
`wordStatsFromProjection()` in `src/core/editing/markdown.ts`. Counting retains one policy;
the original `wordStats(source, options)` API delegates to the same pure helper. Leaf
lookups use an index rather than repeated full-array searches. Source selection still
uses the current synchronous AST, not a delayed or approximate projection.

All 610 existing tests passed, including body-role exclusions, citations, Markdown source
positions and protected selection validation. The installed-Host run with 14,400 Chinese
characters and 744 recorded inputs measured p95 at 22.4 ms, within the approved limit.
All input, continuous scroll, cross-paragraph selection, native panel open/close and drag,
overlay stacking and 200% zoom/reduced-motion geometry also passed. The client artifact
was 4,215,553 bytes versus the archived pre-UI 4,199,699 bytes, below the approved growth
budget. Native Desktop and manual visual acceptance are recorded separately.

No manuscript, permissions, workflow state or export formatting policy changed. Raw
journals and captures are kept locally under `.dsh-tmp/visual-language-baseline/`.
