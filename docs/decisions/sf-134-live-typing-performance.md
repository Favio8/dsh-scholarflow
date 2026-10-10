# SF-134: live typing performance

Date: 2026-10-11. Implements the visual-language PRD performance guard without relaxing
its limit or replacing the textarea/mirror editor.

`src/client/gutter-rows.ts:18–48` caches the heights of unchanged logical lines. The key covers
the pane width and every copied layout property, including font family. Only current
document lines are retained, and unchanged cell heights are not rewritten. Real browser
checks edit a line, change the family, change font/line size and restore the original
styles: all nine wide/narrow/dark checks matched the textarea's content height exactly.

`src/client/draft.tsx:204–210` formerly parsed the live manuscript for preview, then parsed it a
second time inside word statistics. It now shares the already current AST with
`wordStatsFromProjection()` in `src/core/editing/markdown.ts:189–220`. Counting retains one policy;
the original `wordStats(source, options)` API delegates to the same pure helper. Leaf
lookups use an index rather than repeated full-array searches. Source selection still
uses the current synchronous AST, not a delayed or approximate projection.

All 610 existing tests passed, including body-role exclusions, citations, Markdown source
positions and protected selection validation. The installed-Host browser run with 14,400
Chinese characters and 744 recorded inputs measured p95 at 22.4 ms. The separate native
Desktop run measured 23.5 ms with the same character/input counts, within the unchanged
26.51 ms limit. Both runs passed input retention, continuous scroll, cross-paragraph
selection, native panel open/close and five-second drag, overlay stacking and 200% zoom
with reduced motion. Journals: `1791659195664` (browser) and `1791659638985` (Desktop)
under `.dsh-tmp/workbench-performance/`.

The final client artifact is 4,216,301 bytes versus the archived pre-UI 4,199,699 bytes:
growth 0.395%, below the approved 2% budget. A later Desktop interaction-only run
(`1791660716687`) checks the format-label correction and captures both themes; it does
not provide another typing measurement. Desktop cleanup saves only the isolated TEST_ONLY
manuscript before closing, avoiding the dirty-document dialog/shutdown race. Production
dirty-document protection is unchanged. User visual acceptance in a real DSH session is
still pending; captures and automated Desktop checks do not substitute for it.

The installed-Host browser layout-only run `1791665518416` additionally verifies the
initialized split workbench at 320, 420, 720 and 1440px in both themes. All three format
labels fit, header/caption controls remain within their containers and document overflow
is zero. This run follows the final format-width and narrow-caption CSS corrections; it
does not repeat or replace the typing measurement.

No manuscript, permissions, workflow state or export formatting policy changed. Raw
journals and captures are kept locally under `.dsh-tmp/visual-language-baseline/`.
