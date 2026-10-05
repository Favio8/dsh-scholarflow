# Saved selection context in the Host input

Implemented 2026-10-05 for SF-015, PRD §10.1 and SPEC §23.4.

The Agent panel shows a removable card for the current Session with the relative
manuscript path, actual AST heading ancestry, character count, exact UTF-16 range,
revision, source text, citations and current project claim IDs. Tab changes retain
it; project or saved document changes invalidate it. This is a prepared snapshot,
not a permission, a Proposal or an assertion that the cited evidence supports it.

The readonly Host endpoint resolves the actual executing Session and Workspace,
then checks project identity, saved revision/hash, exact source/rendered positions,
block and citation mapping. It refuses oversized context and foreign claims;
adjacent context is reconstructed from the actual saved manuscript, disregarding
caller-supplied strings. It does not read unselected raw materials or write facts.

The pinned 0.2.0-rc.2 installed SDK exposes the scoped input actions through
`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:18126–18141`. Its public
`captureInsertion`/`insertText` at lines 13462–13475 capture and compare `draftRev`
and refuse insertion while adjudicating, submitting or disposed. The editor's
`insertAsyncText` at lines 13308–13315 replaces the supplied range as an independent
undo operation. ScholarFlow collapses the captured range to its end, preserving
existing user text and reference chips. These references describe the installed,
read-only SDK snapshot, not an assumed API from another version.

An explicit click revalidates the saved snapshot asynchronously, then inserts
visible JSON into the native composer using that original version guard. An
intervening human edit makes insertion fail and retains both the new input and
prepared card. Removing the prepared card does not touch native input. Successful
insertion clears the prepared card; the inserted text can be edited, removed or
undone in the Host input before the user sends it through the normal conversation.
The integration never invokes submit, changes the selected model, replaces the
whole draft or creates another chat loop. The native composer contains visible
text; this implementation does not claim a custom native attachment-chip API.

Core tests cover readonly BOM/CRLF/repeated Unicode positions, actual heading/path
metadata, forged context rejection, changed document rejection, foreign claims
and bounded bytes. The installed-Host test covers retention/removal, saved-version
invalidation and native input insertion. The deliberate delayed readonly-RPC
browser test also passes: editing the actual Host composer while revalidation is
pending refuses the old insertion, retains the new text and permits an explicit
retry. It makes no model call or send and leaves body/ledger bytes unchanged.
