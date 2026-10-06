# Preset picker: narrow layout and blank creation (2026-10-06)

Requirement: design 02 §7 (narrow containers show one column at a time) and §6.1.5 (create
a preset from scratch without first creating a paper). Both were specified and missing.

## Narrow containers

The modal now tracks a `(max-width: 720px)` match and drives the body with a `data-view`
attribute: `list`, `detail`, `wide` or `draft`. In `list` the preview is hidden, in `detail`
the list is hidden, and the detail view carries a 返回列表 button. The footer keeps the apply
button reachable and is allowed to wrap. Selecting a row only switches to the detail view on
a narrow container; on a wide one the two columns stay side by side as before.

## Blank creation

「新建我的预设」opens an editor inside the modal: a name field, one chapter to start with
(at least one is enforced), add and remove chapters, per-chapter title, focus and length.
Saving calls the same `presets.save` the wizard uses, with the paper type taken from the
context, so the entry joins the list like any other and only applies when used. Nothing here
requires a paper to exist first — the settings entry can reach it with no project open.

## Verification

Typecheck, build and the full suite (392 tests) pass; the bundle carries the draft editor and
the narrow-screen switching. Both behaviours are layout and interaction, so AT-41 (narrow and
keyboard) still needs the real Desktop.
