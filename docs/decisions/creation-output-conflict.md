# Recoverable creation output collisions

Date: 2026-10-10. Defect correction under PRD v1.0 §3 (initialization collisions), SPEC v1.0 §9.1/9.3 and AT-02. No change to the rule prohibiting replacement of existing files.

## Cause

The reported workspace has previous delivery artifacts under `manuscript/exports/`, but no initialized ScholarFlow metadata. The create-only initialization check correctly refuses that populated output directory. The wizard checked `error.message.includes('OUTPUT_PATH_CONFLICT')` to reveal a different output input. The real bridge supplies that code separately from the human-readable message, so the recovery field remained hidden. The underlying collision also had no diagnostic details.

## Correction

The output input is always visible in the final step. Collision handling reads the structured code and focuses the input. The core includes the relative collision directory, reason, immediate entries (up to five), field and operation. It can suggest an unused sibling, after checking actual filesystem metadata; suggestions create nothing and do not inspect file contents. Only an explicit user selection changes the draft output, and the next creation action prepares and verifies a new plan. Output-only changes preserve the adopted outline and do not regenerate it.

Populated outputs, files used as directories, reserved directories and existing project metadata have distinct diagnostics. An existing project has no misleading output suggestion, since changing the manuscript path cannot reinitialize its `.scholarflow/` records. Reserved roots are checked without case sensitivity on Windows. Commit-time collision checks remain in place; a newly occupied output or appeared file never receives replacement bytes. The obsolete message suggesting immediate adoption of an existing manuscript was removed from this creation error; importing existing text still requires its own explicit plan.

## Verification

The final domain suite passes 584/584 tests; build and typecheck pass.

Added integration cases preserve prior delivery/manuscript bytes, skip an occupied proposed sibling, prepare and initialize at the user's selected alternative, distinguish metadata and reserved roots, and reject files that appear after planning. The outline controller also verifies that changing output before adoption preserves the candidate and adopts it into the latest draft without repeating generation. Actual user files were inspected read-only and not changed.

Installed-host verification uses an isolated `TEST_ONLY` workspace with previous exports and controlled outline output. The real `creation.prepare` bridge is tested; `creation.start` stops at an explicit fixture boundary before model selection or paid generation. This verifies collision recovery and the prepared new output, not full manuscript drafting.

The installed-host run passes: structured output error details and recovery button visible, explicit selection of `manuscript-2`, a real new preparation plan, previous export bytes unchanged, one outline request and zero paid model calls. Four candidate and six adopted-structure light/dark layouts pass overflow and contrast checks. Evidence: `.dsh-tmp/output-conflict-host.log` and `.dsh-tmp/outline-host-report.json`.
