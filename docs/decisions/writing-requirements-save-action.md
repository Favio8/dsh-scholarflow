# Writing-requirements save action

Date: 2026-10-11. User requested a quieter save button. The action now uses the shared
secondary variant with approved ink-blue tint/border/text roles, a 16px save SVG and no
shadow. Saved feedback sits alongside the action with a decorative check SVG; narrow
panes can wrap the feedback. The adjacent cover fieldset loses its native frame, keeping
the form within the approved content-layer limit. Existing font, radius and hit-size
tokens remain in use; no palette or timing limit changes.

`src/client/writing-requirements.tsx` retains its save callback, request arguments,
disabled conditions, conflict handling and refresh behavior. The live status node remains
present and now announces the complete message atomically. SVGs use the shared 1.6 stroke.

The visual fixture mounts the shipped component with explicit TEST_ONLY data and generates
saved-action previews through its existing callback with a fixture API. This is component
rendering evidence, not proof of persistence in a user's project. Render coverage is now
21 surfaces/61 captures. Build, typecheck, 610 existing tests and appearance audit passed;
font roles remain seven, padding kinds 19, primary base definitions one and important
occurrences 42. Client artifact: 4,218,406 bytes, 0.445% above the archived baseline.

The current native Desktop workbench run (`1791685233751`) passed the unchanged 26.51ms
limit with p95 19.4ms, 14,400 Chinese characters and 744 inputs, plus input preservation,
scroll, selection, panel drag and 200% overlay geometry. The preceding headless browser
run (`1791684903903`) failed the same limit with p95 36.2ms. That failure remains archived;
its difference from Desktop is unresolved, and no claim that all performance runs passed
is made. No performance threshold was relaxed or editor implementation changed.

Evidence is archived under `.dsh-tmp/visual-language-baseline/2026-10-11-save-action/`,
including both performance journals and three action previews. Parent PRD/SPEC baselines
are unchanged. Push remains declined; full real-session visual acceptance remains pending.
