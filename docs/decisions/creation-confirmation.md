# Creation confirmation and step-3 polish (2026-10-06)

Requirement: SF-038, design 02 §6/§8/§9. The final confirmation lives inside the third
step instead of becoming a fourth one, and it states everything the user is about to
authorise.

## What the confirmation shows

| Row | Content |
|---|---|
| 论文与结构 | final title, type, language, target length with the counting policy, chapter count, plan total, and the preset with 已修改 when the structure differs from it |
| 资料 | requirement sources and reference materials counted separately, with an expandable list of the actual read-authorised set; external sources are noted as handle-based |
| 输出 | the directories that will be created, and that a name clash is reported before submitting rather than overwritten |
| 外部处理 | the session's model, the network switch and what it would send, and that local saving is not a local model |
| 预算 | the model-call allowance and that it comes from plugin settings |
| 文风与能力 | that the project's default profile and enabled Skills apply, and where to review them |
| 能力缺口 | citation author-year, typography, image recognition and external sources — each stated as not supported or not verified, and recorded rather than claimed |

## Editing and undo

Editing any chapter now marks the structure as 已修改 relative to its preset and keeps a
short history, so 撤销结构编辑 restores the previous structure without a model call.
Typing a length still locks only that chapter to manual; reordering and retitling do not.

## Removed

The old summary line duplicated what the confirmation now says, so it is gone. The
decorative full-width plus was replaced with a plain one, and the wizard contains no
emoji (checked against the emoji ranges).

## Verification

Typecheck, build and the full suite (391 tests) pass; the confirmation area is present in
the built client bundle. The seven rows are verified by construction, not by a rendered
check: AT-40 needs a real Desktop session and remains outstanding.
