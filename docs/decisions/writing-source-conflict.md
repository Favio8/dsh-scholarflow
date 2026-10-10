# Actionable source conflicts during evidence acquisition

Date: 2026-10-10. This corrects the existing source duplicate preview/confirmation and resumable task contract; it does not relax identity or provenance checks.

## Observed cause

Read-only inspection of the reported project found the evidence cursor at its selected PDF, two existing source records bound to different Markdown reading notes, and repeated answered failures followed by another identical pending failure. Bibliography extraction had renamed those notes to the paper title because the notes mentioned that title. The PDF filename then matched the note records under the existing normalized-title heuristic. The source registration guard correctly demanded a duplicate decision, but the task error handler reduced it to a generic “continue” question. Answering only retried the same registration; it never supplied a duplicate review.

## Correction

Only materials explicitly classified as papers receive extracted publication metadata. Notes retain their own file identity. Existing source records, citation keys and evidence remain unchanged; no historical automatic merge or relabelling occurs.

Evidence acquisition now prepares a concrete duplicate preview before a model call. It shows the selected file and the matched record filenames and titles, with material/content/config/ledger hashes. The user supplies a reason to keep separate texts; the controller validates the observed preview and completes the existing audited `registerSource` keep-separate operation before marking the question answered or relaunching. It resumes at the saved evidence cursor. The registration does not claim publication identity verification or upgrade evidence support.

Legacy pending generic failures receive the same preview in a read-only inspection projection. Polling does not rewrite task history or confirm files. Blind legacy “continue” requests fail without marking the question answered or launching again. Changed previews and externally edited materials cannot confirm stale inputs. Duplicate confirmation fields and stored previews are optional for older task compatibility.

The editor labels this panel “资料来源确认”, separates file comparisons from the reason input, prevents a second submission while confirmation is pending and ignores stale poll results for questions already answered in that mounted editor. This prevents a successful response being undone by an earlier poll.

## Verification and limits

589/589 domain tests, build and typecheck pass. Integration cases exercise the full evidence pause/resolve/resume flow, original source/citation preservation, stale ledger and changed bytes, notes metadata isolation, and real controller handling of a legacy pending failure. The controller test isolates only the host seam and paid launch boundary.

The current user task was replayed read-only from disk: the new preview identifies two existing matched records, without copying private text into fixtures or writing user files. Browser fixtures are explicitly `TEST_ONLY`. Standalone runs verified file comparisons and four responsive/theme layouts but initially failed because of an incomplete fixture response and a test looking for the old button label during its busy state. These are not recorded as full browser acceptance; their fixture/assertions were corrected and verification moved to the installed host.

Installed-host checks first exposed an ambiguous text locator (the same filename also appears in the research panel) and a transient layout measurement immediately after changing viewport. Verification moved to collecting stable rendered geometry before judging overflow. Four stable geometry samples have no overflow (1134/1134 pixels at 1440, 316/316 at 390, in both themes). The actual inspect bridge upgrades a legacy question without writing; a controlled explicit confirmation carries the decision and observed hash, disables the button until acknowledged and remains closed after a stale real poll. No paid model calls. Evidence: `.dsh-tmp/writing-source-conflict-host/1791633868021/report.json` and its four screenshots. The acknowledgement is explicitly a fixture boundary; source persistence/resumption is verified in the real controller/domain integration tests, not represented as a real paid drafting acceptance.

Markdown remains the existing manuscript truth. Word and LaTeX read the shared parsed document/scan plan and use separate typography, cover and bibliography data. No export pipeline change is part of this fix.
