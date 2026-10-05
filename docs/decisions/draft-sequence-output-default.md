# Match the sequence and child output-token defaults

Date: 2026-10-05. Three paper-type example flows exposed that a valid sequence
model without `maxOutputTokens` froze the missing field, while generation froze
its existing 16,384 default. The strict accepted-child comparison then refused
to advance after the first accepted chapter, including after cold restoration.

New sequence previews freeze that existing default explicitly. Accepted-child
validation normalizes only the absent field in old immutable sequence input;
it still checks the exact provider, model, reasoning effort and effective output
limit. It does not rewrite old input or reset calls, accepted revision proofs,
scope fingerprints or other budgets. Explicit output limits remain unchanged.

Three TEST_ONLY example flows use actual bundled text and parsing, but synthetic
model responses and storage. They cover teacher requirements, a positioned
excerpt and scoped claim, manual outline confirmation, body then summary
candidates, explicit acceptance, preserved human notes, cold restoration,
original-budget accounting, local seven-stage progression and matching Markdown,
BibTeX and quality-report delivery. Unselected text stays out of model context
and delivery. Their publication identity and semantic checks remain unknown;
all refuse reviewed delivery. The research branch preserves absent-experiment
markers and B0 findings. These cases do not replace installed Host/model tests.

A separate regression constructs a coherent older optional-field fixture,
accepts one chapter, restores it into a fresh test store and advances to the
summary while preserving the exact immutable input and original used call.

Verification: typecheck and full suite 331/331 passed. Local package creation
includes all four teaching example files and excludes workspace/test artifacts.
Generated source maps contain no absolute build-source paths. No npm publication
or license selection was performed.
