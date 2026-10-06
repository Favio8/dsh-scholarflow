# Preset browsing, applying and saving (2026-10-06)

Requirement: SF-041/SF-042/SF-043, design 02 §6–§7. The third step stops using a
hard-coded chapter list and works from the preset library instead.

## Browsing and applying

- A fresh wizard opens on the type's default built-in preset (lowest `order`). An
  existing draft keeps what the user had, and a library that cannot be read leaves the
  offline structure in place without claiming anything.
- 「更换预设」opens a modal: type tabs (the paper's own type first, others browsable),
  search, a list grouped into 我的预设 / 内置, and a preview with the when-to-use notes,
  the suggested share bar, each chapter's focus, supplemental parts, method notes and
  the structural sources. Shares are always labelled as a suggested starting point.
- **Browsing never touches the paper.** Only 「使用此预设」applies, and it does so
  atomically: a preset from another paper type switches the type and the structure in one
  confirmation, which states both effects; cancelling keeps both untouched. Applying over
  edited chapters asks once as well.

## Chapters and lengths

- Applying a preset makes every chapter automatic and carries the preset's share as its
  weight, so a later target change recomputes exactly those chapters.
- Typing a length locks that chapter to manual; the row shows 自动 or 手工. 「重新分配」
  runs the deterministic algorithm from `core/presets/allocation.ts` and reports the
  plan total against the target, the shortfall or overage, and refuses to overwrite
  anything when the automatic chapters cannot reach the minimum.
- The abstract is counted only when the user ticks 摘要计入.

## Saving

- 「保存为我的预设」stores the current structure as a new user preset; the host derives
  shares from the chapter lengths, so the paper's absolute numbers and title stay out of
  the global library.
- 「更新此预设」appears only for a user-owned preset and carries its `expectedVersion`, so
  a concurrent change is reported instead of overwritten.
- The modal also manages entries: rename, delete (with a warning that existing papers are
  unaffected), copy any preset into an independent user entry, and save the current
  structure — all through the operator-only `presets.*` methods.

## Verification

`core/presets/apply.ts` holds the preset-to-paper mapping as a pure module so it is
tested directly: five tests cover shares becoming automatic lengths, language selection
without translation, normalisation of skewed shares, the minimum-length floor and the
recorded selection carrying no structure. Typecheck, build and the full suite (391 tests)
pass; the client bundle contains the dialog and no longer contains the old
「使用类型预设」button. AT-34/AT-35/AT-36 still need a real Desktop session.
