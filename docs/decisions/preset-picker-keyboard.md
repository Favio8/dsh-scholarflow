# Preset picker: Escape dismisses it and focus returns (2026-10-06)

Requirement: design 02 §7 ("Escape 返回上层，关闭回触发按钮") and 05 §5's keyboard row
("焦点不逸出弹窗，Escape 回上层，关闭回触发按钮").

The wizard now runs the project's existing `useConfirmationFocus` hook over its own root, so
the preset modal — a `role="dialog"` inside that root — takes focus when it opens and focus
returns to the control that opened it when it closes. The hook finds the Escape target by
matching a button's text against 取消/关闭/返回, and the modal's close control was a bare `×`,
so Escape did nothing: the button now carries a visually hidden 关闭 before the visible `×`,
which satisfies both the hook and the visual convention.

The list keeps its filter and scroll position when switching between list and detail, because
the narrow layout hides a column with CSS rather than unmounting it.

Verified by typecheck, build and the full suite (392 tests); the bundle carries the change.
Keyboard behaviour itself is a visual check, so AT-41 still needs the real Desktop.
