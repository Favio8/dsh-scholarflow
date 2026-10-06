# Wizard: clearing the draft is its own action, and narrow containers scroll (2026-10-06)

Two more items from design 02 that were specified and missing.

## 清除草稿 (02 §3)

The draft was only ever cleared as a side effect of a successful creation. §3 requires
"关闭保留草稿，清除草稿是独立动作", so the header now carries a 清除草稿 button: it confirms
first, then drops the stored draft and resets the wizard to its initial state. Nothing is
created and no existing project is touched.

## Narrow containers (02 §5, 05 §5)

At 720px and below the material list and the chapter list no longer keep their own fixed
heights — the page scrolls instead of stacking small scroll areas — and buttons take the
44px touch minimum from the token table. Wide layouts are unchanged.

Verified by typecheck, build and the full suite (392 tests); the bundle carries the action.
Both behaviours are interaction, so AT-41 still needs the real Desktop.
