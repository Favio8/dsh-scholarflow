# Cross-section review scope

Implemented 2026-10-05 for SF-013, SF-023, SF-024 and SPEC §19.2–19.4.

The existing bounded model-review stage already freezes the entire saved
manuscript, exact AST paragraph ranges, current outline, related located evidence,
actual cited Sources, approved memory and fixed review instructions. It now
explicitly assesses terminology, contribution items and summary/conclusion claims
against that actual body, alongside argument and style.

New plans freeze `assessmentScope: cross-section` and the versioned
`semanticScope: sf-cross-section-v1`. All five distinct check results are required.
Each positioned finding identifies its assessment, and cannot coexist with a
pass for that assessment or its argument/style aggregate. Independent assessment
identities can refer to the same paragraph without being merged. Missing or
unjudgeable items remain unknown. Prompt text is not treated as proof of factual
accuracy; output validation checks structure, source positions and supplied IDs.

Deterministic review leaves all semantic checks unknown. Authors can explicitly
review them with same-version, reasoned manual assessments. Completing only
argument and style cannot satisfy the cross-section checks or unlock reviewed
delivery. No review modifies the manuscript. Positioned fixes still use the
existing immutable Proposal, operator acceptance and explicit semantic recheck.

Old frozen two-check plans retain their exact original scope and prompt shape.
Parsing does not add new scope fields into archived bytes. Reusing a validated
old output never manufactures three new passes or another paid request. The
review dependency evaluator version changes, making old current reports stale
for fresh full review; existing archived artifacts remain unchanged. A client
preview displays the actual frozen assessment list, including old recovery scope.

All execution reuses the existing Session/model service, overall workflow quota,
review-round limit, format-repair limit, transient retry policy and recovery
journals. The new schema does not introduce a second Agent loop or a new provider.

Five added tests cover actual full chapter/context capture, false result summary
positions and unchanged body, missing/duplicated/downgraded scope, distinct issues
in one paragraph, old output recovery without replay, and incomplete semantic
assessments blocking reviewed export. Model fixtures are marked TEST_ONLY; real
provider verification is recorded separately in integration-verification.md.
