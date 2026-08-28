# UI/UX audit: truthful Risk Gateway state

Status: design-first P1 evidence slice
Scope: `apps/desktop/renderer/control-room.js`
Authority: `liveAuthority=NONE`, `productionMutationAllowed=false`, AI authority `ZERO_AUTHORITY`

## NOW

The Control Room derives the pipeline Risk Gateway stage from `diagnostics.lastSignal.riskDecision`, but the summary grid independently renders Risk Gateway as a hard-coded red `HALT` with the note `RISK_GATE_NOT_CONFIGURED`.

This creates two competing status engines on one screen. When a real observed signal carries another risk decision, the pipeline can truthfully show that decision while the summary tile still claims `HALT` / not configured.

## WHY

This is a trust and hierarchy defect, not a cosmetic defect. The summary tile is above the detailed pipeline and is likely to be read first. A hard-coded state can therefore override the user's interpretation of evidence-backed state below it.

The defect also violates the canonical-state constraint: one user-visible concept is being derived twice, once from evidence and once from a constant.

## RESULT TARGET

Use one canonical Risk Gateway presentation derived from the same observed diagnostics used by `derivePipeline()`.

Acceptance criteria:

1. The summary tile and pipeline cannot disagree about the latest observed Risk Gateway decision.
2. No signal / no observed decision renders an explicit unknown or not-called state, never a fabricated PASS/HALT.
3. `RISK_GATE_NOT_CONFIGURED` is shown only when configuration evidence actually establishes that condition.
4. Existing Shadow safety semantics remain unchanged: no live-order capability is introduced or implied.
5. Status remains redundant in accessible form: text/glyph semantics do not depend on color alone.
6. Targeted renderer tests cover at least: no diagnostics, no signal, observed PASS, observed REJECT/HALT, and missing/unknown decision.

## RISK

Do not infer configuration state from absence of a signal. Absence is insufficient evidence. Do not change trading, risk, execution, IPC, scheduler, queue, or authority logic in this slice.

A UI-only patch must fail closed when a decision is absent or unrecognized. It must not turn an unknown state into a reassuring state.

## LEARNING / BASELINE

Baseline defect class: duplicate status derivation.

Measurable post-change check:

- contradictory Risk Gateway states possible from one diagnostics snapshot: baseline `YES`, target `NO`;
- hard-coded financial/risk status in summary tile: baseline `YES`, target `NO`;
- additional taps required to discover the contradiction: baseline user must compare tile vs pipeline, target `0` contradiction-resolution taps;
- physical-device acceptance: `INSUFFICIENT` until actually measured;
- financial outcome improvement: `INSUFFICIENT`, not claimed by this UI slice.

Post-merge classification must be evidence-based: `VERIFIED_IMPROVEMENT` only if targeted tests prove state consistency and the rendered hierarchy no longer permits the contradictory snapshot. Otherwise classify `NEUTRAL`, `REGRESSION`, or `INSUFFICIENT`.

## Recommended implementation slice

Change only the smallest renderer/test surface needed to make the summary tile consume the canonical derived Risk Gateway state. Reuse `STAGE_TONE` / `derivePipeline()` rather than adding another mapper. If configuration evidence is not present in the diagnostics contract, remove the unsupported `RISK_GATE_NOT_CONFIGURED` claim from the tile instead of inventing a new source.
