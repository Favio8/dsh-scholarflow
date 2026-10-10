# Visual language states, motion and split seam

Date: 2026-10-11. Authority: [approved visual-language decisions](../../../docs/ui-design-language/02-design-language-prd.md), sections 10–13.

`src/client/sf-state.tsx` supplies the same icon/title/description/primary-action structure
for empty, loading and application error states. Empty materials open the existing
maintenance section; application errors expose their existing diagnostics; project errors
repeat a read rather than replaying a paid operation. These are UI actions, not new workflow
states. Chinese copy stays inline under the approved scope.

The rendering boundary retains its pre-existing ordinary-conversation escape in addition
to retry. This is the explicit safety/accessibility exception to the single-action visual
pattern under section 13; the existing escape cannot be removed for visual consistency.
The gate records the shared state's primary action separately from that escape.

`src/client/workbench-chrome.tsx` defines SVG operation icons with two sizes and one stroke
width. Text arrows/crosses are removed from client UI source, without modifying manuscript
data. `src/client/motion/tokens.ts` and `presence.tsx` implement the approved paper ease,
bounded vertical entrance and shorter exit; list motion uses position rather than scale.
Loading icons share reduced-motion and hidden-window pause rules with the existing mark.

The split uses one warm neutral family. Its source pane is themed, while the manuscript
page uses the approved near-white exception in the dark shell. Source edges and manuscript
edges read their own approved theme/page token roles; the page uses shadow 1 downwards and
the source pane stays flat. Page colour literals and the secondary background of printed
code/table content are replaced by page-scoped tokens.

Section 4 AT-132 says the paper background does not change on a theme switch, while section
10 Q5 explicitly specifies two near-white page values. The implementation follows section
10's sole approved values: the page does not invert into dark paper, but retains that small
specified near-white difference. This textual discrepancy is recorded for user-owned
baseline incorporation; no palette value was silently changed.

Host alias inventory is emitted by `scripts/visual-source-metrics.mjs`. Host shell/native
tools remain separate from the owned project content. U-15 remains open. The parent
ScholarFlow PRD/SPEC baseline files are unchanged.
