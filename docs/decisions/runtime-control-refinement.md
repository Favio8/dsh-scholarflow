# Runtime control and layout refinement

Date: 2026-10-11. Implements the user's renewed visual feedback within the approved
SF-127/128/136–139 scope of PRD/SPEC v1.13. The design brief and GitHub references are
in [the workspace design record](../../../docs/ui-design-language/04-runtime-control-refinement.md).

Toolbar navigation, zoom and ordinary actions previously inherited the shared control
contract's strong outline. Repeated root selectors gave that contract enough specificity
to overwrite the workbench's own quiet navigation. The shared defaults now use soft
fills and transparent button borders, with explicit primary, secondary, ghost and danger
roles. Component-wide fallback rules were removed. Inputs use a light outline on the
paper surface; hover and keyboard focus supply stronger feedback. The file picker uses
the same secondary treatment. The view switcher groups its three existing actions into
one control; zoom and return actions have no individual frames.

Settings headings, field labels and action widths now establish a clearer hierarchy.
Material rows replace the oversized card grid with a file icon, complete wrapping name,
actual parse status and open affordance. Existing read/close callbacks and disabled
conditions are unchanged. Status colour comes from `parseStatus`, not inferred success.

Screenshots exposed two layout defects that the former gates missed:

- Narrow fields kept `grid-column:2` after their grid switched to one column, creating an
  implicit second column and vertically squeezed labels. All non-label field children now
  move together into column one.
- The installed workspace and its nested wizard scroll seat each added an outer gutter.
  The workspace now owns that gutter; narrow gutters use the shared 12px spacing. At a
  320px viewport with the native right sidebar closed, wizard content width increases
  from 104px to 208px. The clear action no longer floats into the compact step label.

Removing the generic textarea fallback also made the source editor's colour ownership
explicit in its own CSS. The measured source font, line height, mirror and selection
rules remain intact. The citation disclosure has a short label; its full limitation text
remains available by keyboard and pointer.

Code references (relative to the repository root): shared controls and settings
`src/client/theme/tokens.ts:124–166`, nested scroll ownership at line 109 and narrow
field placement at line 276; toolbar/pane layout `src/client/paper-workspace.tsx:59–106`;
material markup/styles `src/client/paper-materials.tsx:12–31`;
settings heading `src/client/plugin.tsx:340`.

## Evidence

- Build and typecheck passed. All 610 existing unit, contract, integration and fault
  injection tests passed during the control change; later corrections were CSS and
  disclosure text and received focused browser/Host verification.
- The second full `render:surfaces` run captured 61 views without reported problems.
  Mirror alignment remained 0px; reduced-motion mark pixels remained unchanged. This
  run preceded the final disclosure wording and nested-wizard gutter correction.
- Final source counters: zero literal font sizes, seven font roles, 20 padding declaration
  kinds, one primary base definition and 42 `!important` occurrences. No threshold changed.
- Installed Host workbench checks passed eight light/dark × 320/420/720/1440px cases:
  no document overflow, no clipped header/caption controls and complete format labels.
- Installed Host material checks passed both themes with six actual registered TEST_ONLY
  materials, full names/statuses inside each row, keyboard opening of parsed content,
  closing, and no client errors.
- The full appearance audit's last run had zero contrast failures across its coverage and
  two real-Host narrow citation-summary clipping reports. These are retained in the
  original report. After shortening the disclosure and correcting the nested gutter,
  the focused installed-Host audit reused the original contrast/clipping measurement
  function at 320/720/1440px in both themes: zero failures, no overflow, content widths
  208/608/712px, and keyboard disclosure opening/closing passed. This focused result is
  recorded separately rather than overwriting the earlier failures.

Evidence: `.dsh-tmp/control-refinement/` contains the before captures, full render log,
focused Host journal, final real-wizard images and the isolated focused driver. The eight
workbench cases are in `.dsh-tmp/workbench-performance/1791702720736/`; the populated
material and original narrow-disclosure checks are in
`.dsh-tmp/workbench-performance/1791703014293/`. Temporary setup failures are not counted
as successful product checks. The tests use isolated Host profiles and TEST_ONLY files;
no model calls were made.

The desktop profile already links to this repository. `dist/client.js` was rebuilt for
that link; the user's running app was not restarted. No push was performed, preserving
the previously recorded declined push. Human acceptance of the new appearance remains
with the user; automated measurements do not establish aesthetic quality.
