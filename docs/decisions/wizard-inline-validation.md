# Wizard: the step buttons explain what is missing (2026-10-06)

Requirement: design 02 §9 — "行内指出无效字段及原因，聚焦首个问题；不能只置灰按钮".

The primary button used to be disabled whenever a step was incomplete, which told the user
nothing about why. Both steps now keep the button reachable and validate on click:

- step 1: with no written requirement and no requirement source, it reports
  "请填写写作要求，或添加至少一个要求来源。" and focuses the requirements field;
- step 3: it reports the missing title, the first chapter without a title or below the
  minimum length, and the case where the automatic chapters cannot reach the minimum — then
  focuses that chapter's title field, or the paper title field when the title is what is
  missing.

Reported problems are listed inline above the footer with `role="alert"` and cleared as soon
as the user edits anything, so the list never goes stale. The button is only disabled while
a request is in flight.

Verified by typecheck, build and the full suite (392 tests); the bundle carries the list. The
focus behaviour itself is interaction, so AT-31/AT-41 still need the real Desktop.
