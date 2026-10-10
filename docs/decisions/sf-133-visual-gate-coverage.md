# SF-133: visual gate coverage

Date: 2026-10-11. Implementation authority: the user-approved decisions and sequence in
`../docs/ui-design-language/02-design-language-prd.md` in the parent design workspace.

The appearance gate now shares the render surface registry: all eight original surfaces,
split, empty/loading/application-error/boundary states, dock, chat, settings and caption.
Both themes explicitly activate `body[data-ds-dark-theme]` before measurement. Host settings
are changed only inside the isolated test profile. The empty `themeFollowsSystem` and
`tokens.bgBase` fields were removed; computed ScholarFlow tokens and the actual body
attribute replace them.

Additional surfaces mount the shipped React components with labelled TEST_ONLY data.
The original surfaces retain their existing markup fixtures and shipped CSS/measurement
modules. Reports label these as client rendering evidence, separately from the installed
Host wizard. Rendering fixtures are not a substitute for manual acceptance in DSH.
Caption anchoring is adapted only in the test seat; native mounting is unchanged.

Source counters record CSS declaration text, font token kinds, inline font-size literals,
primary rule definitions and `!important` occurrences. Browser counters record computed
font/radius/control-height kinds and select appearance. Counters initially observe the
baseline debt; later implementation steps enforce the approved visual requirements.

Coverage completion and visual acceptance are separate report fields. On the first full
baseline, coverage and actual light/dark activation succeeded, while the expanded audit
reported existing visual failures. Those failures retain a nonzero exit status. No contrast,
mirror, wrap or performance threshold has been relaxed to make the baseline pass.

Build and typecheck passed; all 610 existing tests passed. The baseline render produced
49 captures with zero mirror alignment/height drift and no horizontal source overflow,
but the dark selected-mark colour-spread assertion failed. The first long-document run
measured typing p95 at 51.1 ms and then encountered a stale overlay selector. That selector
was replaced with the real source selection plus the current instruction input. The
performance script now explicitly checks the approved p95 limit and records client bytes.
Neither the old baseline nor this pending remeasurement proves SF-134 acceptance.

Uniform paper exposed a false positive in the former 95% dominant-background blank check.
The blank check now requires visible client text, actual non-background pixels and multiple
paint colours for every seat. The dominant share remains reported as an observation. It
does not change any PRD contrast, alignment or mark-spread threshold. Appearance sampling
waits for finite entrance transitions, so an intermediate fade is not mistaken for a final
foreground colour.

The selected-mark sampler also records chromatic glyph spread independently of whole-strip
averages: uniform paper is excluded and brightness is normalised before comparing hues.
A monochrome selection cannot pass this probe, while sparse coloured glyphs no longer fail
only because most pixels in their strips are paper. Both raw and glyph measurements remain
in the report. The colour-spread threshold is unchanged.

Raw render, appearance and performance journals are archived locally beneath
`.dsh-tmp/visual-language-baseline/`; generated captures and bundles are not committed.
The PRD/SPEC baseline documents remain owned by the user. U-15 (Host UI primitives)
remains open; this change does not waive it.
