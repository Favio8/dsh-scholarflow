# Editable outline versions

Date: 2026-10-05. PRD SF-012 / §9.3; SPEC §5.4 / §7.8 / §10.

The Outline tab edits title, question, thesis, purpose, parent sections, claims,
target length and missing evidence. Add, edit, peer reorder and subtree removal
stay local until an explicit save. Full draft/confirm previews include the tree,
scope, length and gaps. Draft save is separate from the writing confirmation
gate. The prior fast add-and-confirm action remains an explicit operator action.
Concurrent outline changes preserve local editing and block stale saves.

Each save increments the ledger-owned outline version and atomically archives
the complete previous/new structures with the readable `planning/outline.md`
projection and its hash manifest. Automatic confirmation invalidation can leave
the readable projection stale; its recorded hash distinguishes that from an
external edit. A changed projection blocks overwrite. Duplicate IDs, cycles,
orphan parents, excessive depth and unknown/duplicate claims fail validation.

Structure changes expire pending full/section proposals and structure/logic
review. Existing manuscripts, proposal snapshots and prior outline versions
remain intact. Selection proposals retain their separate document/range guards.

Validation: typecheck and 161 full-suite tests passed. Domain tests cover versions,
history, draft/confirm gates, tree/order changes, stale proposals, untouched body,
concurrent edits and external projection protection. Installed DSH smoke passed
native edit, target length/gap, add/reorder, cancelled save preview, draft save,
delete and full confirmation; three history entries and unchanged manuscript
bytes were verified. The real-model section test before this change remains
historical provider evidence, not a claim that all V1 acceptance is complete.
