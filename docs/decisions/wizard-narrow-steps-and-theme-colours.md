# Wizard: narrow step bar, and colours that follow the host theme (2026-10-06)

Two more items from the design that were specified and missing.

## Narrow step bar (02 §2, 05 §5)

"步骤栏：宽屏一行；窄屏显示「第 2 步 / 共 3 步 · 资料范围」，保留已完成步骤导航" and the
responsive matrix's "步骤栏缩为当前步". At 720px and below the three-step bar is replaced by a
single line naming the current step, and the chapter rows are allowed to wrap with the text
column taking the full width so nothing is squeezed into a horizontal scroll.

## Colours follow the theme (02 §2)

The token table requires colours to follow the host's light and dark themes and forbids
hardcoded greys. Every secondary grey in the wizard now reads
`var(--dsw-alias-label-secondary, <previous value>)`, so the host theme drives it and the
previous look remains as the fallback when the variable is absent. No bare grey literals
remain in the file.

Verified by typecheck, build and the full suite (392 tests). Contrast under a dark theme is a
visual check, so AT-41 still needs the real Desktop.
