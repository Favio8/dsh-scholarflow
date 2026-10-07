# Restore the draft viewport and overlay containing block (2026-10-07)

The reported regression affected wheel scrolling in the middle column in edit, preview and
split views. This repair implements the existing v1.2 interaction requirements (AT-59,
AT-67, AT-69); it adds no new product behavior.

## Cause and repair

The newly introduced `.sf-middle-column` was an ordinary block inside the bounded flex
draft. On the installed Desktop, a 692 px draft contained an 8,128 px middle column. The
inner textarea and preview grew with their content, leaving no overflow to scroll, while
the draft's `overflow:hidden` clipped the rest of the manuscript.

The middle column now participates in the flex height chain with zero minimum dimensions.
Its editor and preview own their scrolling again. The whole column is hidden when the
separate draft tools are open, so it does not take height away from that sibling view.

The overlay had another containing-block problem: its Motion wrapper had zero height, and
its transform made that wrapper the absolute overlay's positioning reference. The overlay's
percentage maximum height then collapsed it. The animation wrapper now fills the middle
viewport with absolute positioning. Its empty area passes pointer events through; the input
card retains pointer input. The editor's ancestors are not transformed.

## Verification

- `pnpm typecheck` and `pnpm build`: passed.
- `node --test tests/contracts/client-boot.test.js`: all 3 contracts passed.
- `node tests/e2e/draft-scroll.mjs`: all 19 checks passed on the installed DSH Host, using the
  Desktop profile's bundle set, an isolated profile/workspace and real Chromium wheel input.
  The 5,072-character fixture covers both wheel directions in all three views, overlay open,
  a 1,000 × 650 viewport with reduced motion, last-paragraph visibility, input hit testing,
  unchanged manuscript and absence of client exceptions. No model calls were made.
- The original failure was reproduced on the installed Electron Desktop; its repaired
  column height was also measured there. Hiding an Electron window delays compositor wheel
  handling, so the automated wheel acceptance uses the real Host in headless Chromium.
  This is not a manual acceptance in the user's live window.

The successful journal and screenshot are in
`.dsh-tmp/draft-scroll/1791342571891/`. The user's assignment and source documents were not
used or modified. The installed Desktop profile already links to this repository, so its
next client load uses the rebuilt plugin.
