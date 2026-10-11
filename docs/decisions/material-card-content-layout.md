# Material-card content layout regression

Date: 2026-10-11. User reported filename/status overlap in the populated Materials panel.
Authority remains the approved visual-language PRD, especially SF-126/127/128; no baseline
palette, typography, editor, data or workflow contract is changed.

The shared toolbar-button rule forced material cards to 34px and centered their children.
The previous visual coverage mounted only empty materials, so it missed this populated
branch. Repeated theme injection also means an equal-specificity component rule can be
overridden later by another Slot. `src/client/paper-materials.tsx:27–30` now gives the
content-card selector strictly higher specificity within its own panel, without `!important`.

Cards retain native button actions, focus rings and disabled behavior. Their height follows
content, filenames wrap fully and align left, and status sits below the filename. Cards in
each grid row stretch together; status aligns at the bottom. The panel uses approved
surface/hairline roles, surface radius, panel padding/gap and interface typography. The
grid can shrink below its usual column minimum in a narrow pane. Reference rows also wrap
long text, and the reference heading remains separated from the grid.

Two shipped-component seats now cover six materials, an unbroken long PDF filename,
ready/pending/partial/failed status, three TEST_ONLY source records and global busy state.
Browser probes compare rendered text fragments with card content bounds, check status
separation and heading clearance, and exercise keyboard opening/closing. The source-count
limits remain unchanged: seven font roles, 19 padding kinds, one primary base rule and
42 `!important` occurrences. Appearance coverage is now 20 surfaces, including both new
seats at 1100/320px in both themes; rendering produced 58 captures with zero problems.

The separate native Desktop `--materials-only` run registers six real TEST_ONLY Markdown
files in an isolated workspace and parses two locally. Both themes keep all text inside
their cards, with zero overflow and 32px heading clearance. Keyboard opening, paging and
closing show the exact parsed content returned by the real API. No model is called and no
user project is read or modified. Successful journal: `1791683627314`.

Build/typecheck and all 610 existing tests passed. Client size is 4,216,938 bytes (0.410%
above the archived pre-UI baseline). This targeted material run does not claim a new typing
p95 measurement. Raw journals and captures are archived in
`.dsh-tmp/visual-language-baseline/2026-10-11-material-cards/`. Push remains declined;
the user's final real-session visual acceptance is still pending.
