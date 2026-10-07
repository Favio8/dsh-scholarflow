# Writing experience and quality closeout

Date: 2026-10-07. Implements the approved parent PRD/SPEC v1.2, SF-048–071 and AT-45–69. This record supplements the earlier implementation; frozen v1.0 documents and native DSH defaults are unchanged.

## Problems and resulting behavior

- The editor must retain a bounded flex viewport. The scrolling repair in `d2806f1` remains in place. Local overlays now also have an isolated stacking context in `src/client/middle-overlay.tsx`, so a fullscreen native sidebar covers them and native resize grips remain usable.
- Real selection requests carry an AbortSignal through the client SDK's fourth RPC argument, the HTTP request and the Host stage call. A per-request identity and explicit state prevent late results from reviving stopped or replaced candidates. Unmounting after actual navigation aborts local generation. Closing a native sidebar does not recreate the session.
- Local candidates are attached to their source range or rendered paragraph. `src/client/rewrite-range.ts` tracks edits before/after the target; accepting and undoing change only that target. Dirty-buffer adoption waits for the Host manuscript update before persisting, avoiding false human edits after consecutive generated writes.
- Adjacent prose paragraphs are a valid local target. `validateProseRange` retains the native single-block contract, validates each paragraph and its citation boundaries, and rejects intervening code, headings, tables and other non-prose nodes.
- Electron does not implement `window.prompt`. Preset names, renaming and pasted requirement text use `src/client/text-prompt.tsx` with an HTML modal dialog in the browser top layer. This also solves nesting beneath the preset picker, without raising arbitrary application-wide z-index values.
- First-step sources and later reference materials stay separate. Newly discovered files remain unselected. Requirement folders contribute their actual file members, not an extra folder pseudo-file. Outline generation receives actual extracted requirements, can stop, and exposes a candidate before adoption.
- PDF acquisition retains every readable block with its original range and hash. For the test paper this is 297 blocks, including late tables and references. Optional surrounding-source context is explicitly separate from a claim's supporting evidence; adding context does not silently broaden an evidence relation. Bibliographic fields must match text actually seen on the first page.
- Confirmed approximate length has a deterministic counting policy and both bounds. Finished-draft repairs use measured section lengths. A small global shortage/overflow changes one suitable section; larger deviations are distributed proportionally. Template shares no longer cause all nine sections to be rewritten for a small difference. User content still follows the proposal and explicit acceptance path.
- Actual model-assisted, located review findings return to the same protected revision path. Review prompts use the confirmed task genre; a reading analysis is not an original experiment report. Repeated identical failures pause for a decision. A subsequent full review moves resolved findings from its own scope into handled history; unknown checks and unrelated material failures remain open.
- Calls and elapsed time are telemetry. Legacy cumulative call, query, duration and review-round fields remain readable but do not stop dispatch. Real context limits, cancellation, consent and repeated-failure handling remain active.

## Compatibility evidence

The pinned installed Host is DSH 0.2.0-rc.2. Its public client RPC takes a signal as the fourth argument. The installed HTTP bridge aborts the Request when the response socket closes before completion and passes `request.signal` to the remote handler. Tests demonstrate an aborted request and a discarded late candidate, rather than merely hiding its spinner.

The native right-sidebar expand button renders only while collapsed. While expanded, the actual collapse control is in the sidebar chrome. Tests address those controls by their verified labels, `打开右侧边栏` and `收起右侧边栏`; choosing the last toolbar button accidentally exercised hidden export menus.

## Validation

- `pnpm typecheck`, `pnpm build` and the full 475-test unit/contract/integration/fault suite pass.
- Installed Electron UI: 54/54 checks, including a real preset save and rename, step direction, immediate state, reduced motion, stopping and sidebar changes.
- Installed Electron long manuscript: 14,400 Han characters, 56.414 seconds of input, all 744 input samples preserved, input-to-paint p95 24.1 ms, maximum 57.3 ms; two long tasks (55/58 ms), zero frame gaps over 100 ms. Thirty wheel samples were monotonic and never blanked the editor.
- Actual five-second native sidebar drag changes middle-column width from 431 to 590 px without blanking the editor. Cross-paragraph selection, fullscreen stacking and 200% zoom remain operable.
- Local rewrite HTTP fixtures explicitly use simulated candidate content. They validate unsaved text, precise accept/undo, stale targets, reload without replay, actual cancellation and actual cross-workspace navigation. They do not establish real model writing quality.
- Real assignment and model evidence is recorded separately in [the parent acceptance record](../../../docs/writing-experience-quality/07-closeout-2026-10-07.md); original materials and both example results remain read-only. Content, pagination, software checks and publication status are separate conclusions.

The full acceptance matrix and exact artifact paths are in that parent record. Build output, test profiles, credentials and manuscripts are excluded from Git.


Native window lifecycle is measured with a real request and actual BrowserWindow events, after disabling Playwright's focus emulation. Electron can keep document.hidden false while its window is hidden, so the plugin pauses its own animations on visibility or window blur and resumes on focus. A DOM marker avoids rerendering the Host Slot or disturbing a running editor request. Seven targeted desktop checks pass; stopping records an aborted request and unchanged text. The full assignment closes at 1574 Han characters with five semantic checks passing and four pages in both Word 16.0 and LibreOffice. The report still retains genuine unknowns and exports as a working draft.

Per-request lifetime now comes from the caller and provider, without an additional plugin thirty-minute timer. A virtual-clock integration test crosses 31 minutes without artificial cancellation; actual network/provider failures and explicit cancellation still propagate. Final client bundle: 4,082,784 bytes versus 4,062,157 at d2806f1, a 20,627-byte increase (0.51%).
