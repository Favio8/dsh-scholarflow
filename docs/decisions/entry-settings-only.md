# Entry duties: settings only (2026-10-06)

Requirement: SF-036/SF-037, SPEC v1.1 §10. The top entry stops entering the mode and
stops opening the workbench; the only way into ScholarFlow is the new-conversation mode
picker, and an existing ScholarFlow conversation restores its own surface.

## What the entry did

`CaptionEntry` (Windows caption bar) and the sidebar panellist row both ran one routine:
open the workbench when the session was already ScholarFlow, select the preset on a blank
session, or create a new ScholarFlow session otherwise. The third branch meant clicking a
settings-looking entry could create a conversation, which is exactly what the requirement
removes.

## What it does now

- The caption button toggles a settings panel. It renders **the same `Settings`
  component** the global settings section uses, against the same `scholarflow` namespace
  and the same revision-checked write path, so the two surfaces cannot drift into two
  configurations. Only the surface differs, because DSH keeps the panel's open state
  private to its shell (see `g0-entry-presets-verification.md`, V1).
- The non-Windows branch registers the same surface behind a sidebar row under a new key,
  `scholarflow-settings`. The old `scholarflow` panel key is not reused, so a layout that
  persisted it cannot resolve to something unintended.
- `main` no longer registers a workbench cell at all. One state reset remains: if a
  persisted `activePanelId` is still `scholarflow`, it is cleared once on load, because
  that panel no longer exists.
- `navigation.open()` without a session is now a no-op instead of selecting the removed
  panel.

## What still enters the mode

Nothing but the mode picker. `connectPresetEntry` keeps opening the workbench when the
preset is chosen in a new conversation, and opening an existing ScholarFlow conversation
still restores the surface through the same path. In-workbench actions that start a new
session for the same project are unchanged: they are conversation-level actions, not
entry points into the mode.

## Verification

`tests/contracts/client-boot.test.js` now asserts the registered cells per platform: no
workbench cell, one settings entry per platform, and the settings section. Typecheck and
the full suite (386 tests) pass. Real-machine confirmation of AT-29/AT-30 is still
outstanding and is listed in the G0 record.
