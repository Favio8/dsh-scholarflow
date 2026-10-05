# Persistable Host stage audit records

Date: 2026-10-05. Scope: PRD SF-024/027 and AT-23; SPEC session reuse,
durable input, recovery and original-budget accounting.

The installed DSH 0.2.0-rc.2 Session accepts unknown event names while live,
but its persistence reader refuses them unless their envelope is marked
`ignorable`. Its public `Session.append()` implementation copies only surface
metadata from its optional argument; it cannot publish that marker. Our previous
`scholarflow/stage-model-request` and `scholarflow/stage-model-result` records
therefore made a paid Session unreadable after actual Host restart. Existing
smokes had restored a second Session which had not made these calls, so they
did not establish recovery of the actual model-owning Session.

The adapter now appends the supported `user/message` envelope with
`surfaceOp: append` and an extensible `scholarflow-stage-audit` producer source.
The source identifies the run and request/result phase; the text explicitly
labels its payload as audit data, without instruction authority or manuscript
acceptance. Request bytes remain reconstructable from the owning Host Session.
Appending does not send, queue or wake an AgentLoop. The finite stage request
still uses its exact frozen messages and the Host credential service; it never
derives another chat loop from these audit entries. Both request and result
durability must be confirmed before dispatch or candidate publication.

This adds audit entries to the normal Session surface instead of an opaque
plugin-only event stream. It is a verified compatibility choice for this pinned
runtime, not a claim that arbitrary downstream event names can be persisted.
No Host code, Session archive, prior project input or paid counter is rewritten.
Previously refused logs remain intact; a failed legacy Session must not be
silently normalized or treated as a missing project.

The new installed-paper-types test restarts the actual model-owning Host
between an accepted discussion chapter and its summary. It checks the original
checkpoint bytes, saved body and restored sequence before requesting the next
chapter. Each original goal permits at most eight model calls. An explicit
`--resume=.dsh-tmp/paper-types/<timestamp>` continues the same test goal and
preserves failed attempts; it does not recreate completed chapters, replay
unknown calls or reset limits. Its metadata-only evidence is ignored by Git.

The first native run exposed the event-format failure. The corrected run then
exposed two real review outputs containing structural findings while declaring
the overall argument check passed. Both were refused without changing the
report. The single format repair now includes the domain's fixed contradiction
explanation and explicitly connects all non-style finding categories to that
overall check. It does not forward raw provider output, SyntaxError excerpts or
Zod values, weaken validation, drop real findings or add repair attempts.

Validation at this checkpoint: typecheck and 334/334 unit, contract,
integration and fault-injection tests pass. All three teaching tasks pass the
actual installed Host/provider flow: course paper 5/8 calls, literature review
5/8, research paper 4/8. They include actual model-owning Session restart,
discussion and summary candidate acceptances, five model checks, same-version
three-file working delivery, unchanged raw files and credentials, and refusal
of reviewed delivery. The research task retains its missing-experiment B0.

The course goal retains its two contradictory failed-review calls. The
literature goal retains both calls from its first failed review, whose final
call reached its frozen output limit; that limit was not treated as a
formatting error or automatically continued. The explicit
second attempts use the same original goal, with no quota renewal. A final
read-only verification of the saved native plans confirms that the summary
input is exactly the accepted discussion version, every frozen model input
excludes the unselected-material sentinel, and the original limit remains
eight. Evidence: `.dsh-tmp/paper-types-latest.json`; all material is TEST_ONLY.
These short teaching cases do not establish full-length academic readiness,
all automatic stages, other providers or complete V1 acceptance.

Legacy project recovery supplement: the genuine first, refused native fixture
also passes a separate no-model probe. The UI creates a new ScholarFlow Session
in the same persisted Workspace, reads the original accepted chapter and
sequence, and previews then dismisses the next summary. Every project file,
the old Session archive and original one-call checkpoint are byte-identical
from before Host startup through the end of the probe; credentials are unchanged.
The refusal remains explicit in the old Session, whose log is never repaired or
overwritten. Evidence: `.dsh-tmp/legacy-session-recovery.json`.

The pinned SDK can wrap its read refusal, so testing only the public exception
class was insufficient in this real fixture. The gateway now classifies the
actual failing Session-inspection seam as `SESSION_READ_FAILED`, with a safe
same-workspace recovery hint. It does not infer corruption from private SDK
text or copy raw-log paths into the response. Cancellation and existing domain
errors retain their original identity; refused reads cannot authorize project IO.
Typecheck, build and the full suite now pass 335/335 after this gateway change.
