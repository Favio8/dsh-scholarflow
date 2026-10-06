# Wizard layout and model output budget (2026-10-06)

Requirement: the user reviewed the creation wizard with two real Desktop screenshots and
three explicit instructions — fix the layout and typography, stop defending on cost by
"removing this limit", and complete the requirement-file selection so it is convenient.
This supersedes the UI-08 wizard interaction details, not its data contract.

## Chapter rows were collapsed, not empty

`.sf-wizard input:not([type=checkbox])` (specificity 0,2,1) carries `width:100%` and
outranked `.sf-structure-section .sf-section-length` (0,2,0). The chapter-length input
therefore took the whole row, the `flex:1` text column was squeezed to its min-content
width, and the preset titles — 引言 / 主题分析 / 讨论 / 结论 from `presetSections` —
rendered as a roughly 30px sliver that read as an empty list. The preset had always been
applied; the row layout hid it.

Row sizing now uses flex bases, and every field override repeats the `.sf-wizard` scope
with at least two further classes, so no rule can silently lose to the base field style
again. The length cell is a fixed 74px with its unit beside it, the title/purpose column
takes the remaining width, and field labels share one deterministic 16px rhythm instead
of depending on host defaults. The assignment row aligns its button to the picker's
baseline through `align-items:flex-end`.

## The plugin no longer caps model output

`callStageModel` defaulted to 4096 output tokens, and `creation.suggest` asked for the
title, a requirements summary and a full section list in one call. A reasoning model
spends part of that budget on reasoning, so the JSON was cut off and the wizard surfaced
`MODEL_OUTPUT_LIMIT_REACHED` — while its message told the user to preview a run that has
no preview step.

`selectedModel` now reports the provider's own cap (`defaultMaxTokens` from
`ctx.llm.resolveModelInfo`), and the stage calls pass that instead of a number this plugin
invented. When the host reports none, `maxTokens` is omitted from the request entirely and
the provider applies its configured default. The 32768 bound remains only because the
frozen run schema (`shared/runs.ts`) persists and compares `maxOutputTokens`, and because
context-window planning reserves it; it is a contract ceiling, not a writing limit.
Descriptor construction (draft sequence, generation, model review, automatic review) now
carries the model's capability as well, so the preview text and the wire budget agree.
The truncation message no longer promises a preview.

## The requirement file is chosen from a searchable workspace picker

`creation.materials` walks the workspace recursively and skips dot-directories,
`node_modules`, `vendor`, `dist`, `build`, the manuscript output directory and sensitive
names. The wizard previously offered the result as a flat `<select>`, which hid the folder
structure and offered no way to refresh after a file was added.

The field is now a picker with search, per-row folder path and size, a visible selected
state, a rescan action and a clear action. Selecting a file also marks it in the material
list with a 作业要求文件 tag and locks that checkbox, because the host requires the
assignment path to be inside the selected materials. `scan` returns `truncated` when the
500-file walk stops early, and the field hint states that any workspace folder works, that
files stay untouched and what the cap means.

Files outside the workspace remain unselectable. The project is bound to one workspace
root, so crossing that boundary needs a PRD/SPEC change and host sandbox authorization
rather than a UI fix.

## Delivery

Per the standing user instruction, this round adds and runs no tests, no type checking and
no UI automation; only the build was run. Compilation is packaging, not functional
validation, and earlier verification records describe earlier revisions.
