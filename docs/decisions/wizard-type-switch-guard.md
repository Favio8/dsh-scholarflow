# Wizard: switching the paper type no longer discards an edited structure (2026-10-06)

Requirement: design 02 §3 — "修改类型/语言若影响已编辑结构，展示变化后确认，取消恢复".

Changing the type used to replace the chapters immediately, so a user who had edited the
structure lost it without warning and without a way back. The switch now:

- asks once when the structure has been edited (a preset marked 已修改, or any edit in the
  undo history), naming the type it is switching to and how many chapters will be replaced;
- cancels cleanly on refusal, leaving type and structure untouched;
- pushes the previous chapters onto the same undo history the chapter editor uses, so
  「撤销结构编辑」restores them;
- drops the preset reference, because a preset of the previous type no longer describes this
  paper. The wizard then shows 尚未选择 instead of a stale name.

Control heights in the wizard were also aligned to the 40px desktop minimum from the token
table (they were 38px). Touch targets keep their separate 44px rule.

Verified by typecheck, build and the full suite (392 tests). The confirmation itself is
interaction, so AT-31/AT-41 still need the real Desktop.
