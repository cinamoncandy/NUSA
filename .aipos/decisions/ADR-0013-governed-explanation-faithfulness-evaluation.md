# ADR-0013: Governed Explanation Faithfulness & Completeness Evaluation

- Status: Proposed
- Date: 2026-08-13
- Scope: PAPER/Research zero-authority AI reasoning only

## Context

`docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md` scored "Explanation quality / faithfulness" at
2/4 after WO-AI-009 landed: AI explanations across the system (desktop's aiSignalExplainer,
aiRiskCommentary, aiChallengerDisagreementExplainer, and cloud's researchHypothesisAgent /
researchReviewAgent) already produce rationale, assumptions, uncertainty, and adversarial
counter-claims, but no independent evaluator checks whether a given explanation is actually
**grounded** in the evidence it was given, or **complete** in the sense of discussing
uncertainty and counter-evidence rather than a one-sided narrative. A model can produce a
fluent, well-structured explanation that quietly states a number nowhere in its evidence, or
that argues confidently in the direction opposite the confidence figure attached to it, and
nothing in the system today would catch that.

The audit's design principle applies here as much as to attribution: "Attribution must not
pretend observational decomposition is causal proof." An LLM judging another LLM's explanation
for faithfulness would be exactly that pattern -- unverifiable, unreplayable, and itself capable
of hallucinating the judgment it's supposed to be checking for.

## Decision

Introduce `evaluateExplanationFaithfulness()` (`apps/cloud/src/ai/explanationFaithfulnessEvaluator.ts`,
contract in `packages/contracts/src/aiExplanationFaithfulness.ts`) as a **deterministic, lexical**
evaluator, not a model call:

1. **Groundedness** -- every concrete numeric claim in the explanation text (prices, percentages,
   sizes) must match a fact the explainer was actually given, within a 0.5% relative tolerance
   for prose rounding. A number matching nothing in evidence is `UNGROUNDED_NUMERIC_CLAIM`, named
   explicitly rather than reported as a bare boolean.
2. **Completeness** -- the explanation must discuss uncertainty (`MISSING_UNCERTAINTY_DISCUSSION`
   if absent) and counter-evidence (`MISSING_COUNTEREVIDENCE_DISCUSSION` if absent), via an
   explicit bilingual (English/Korean) keyword list rather than free-form judgment.
3. **Consistency** -- a BUY/SELL decision whose explanation is lexically dominated by the opposite
   sentiment is `DIRECTION_INCONSISTENT_WITH_DECISION`; certainty language (“definitely”, “확실”)
   paired with a decision confidence below 0.4 is `CONFIDENCE_LANGUAGE_OVERCLAIMS` -- the
   explanation is claiming more certainty than the decision itself asserts.

A result carries an explicit `FAITHFUL | PARTIALLY_FAITHFUL | UNFAITHFUL` strength (completeness
gaps alone downgrade to `PARTIALLY_FAITHFUL`; any grounding or consistency violation is
`UNFAITHFUL`), the exact reason codes, the exact ungrounded numbers found, and a
request/result SHA-256 pair for replay identity -- same evaluation of the same request always
produces a byte-identical result, proven by test.

This evaluator is **read-only, zero-authority**: it never mutates a decision, never blocks
execution, and never changes `liveAuthority` or `productionMutationAllowed`.

**Follow-up (same day):** wired into `projectAiReadOnly()` via `applyExplanationFaithfulness()`
in `projection.ts`. The `AiReadOnlyProjection` contract type is extended through the same
declaration-merging pattern `aiInferenceResources.ts` and `aiProviderDiversity.ts` already use --
every added field (`explanationFaithfulnessStrength`, `explanationFaithfulnessReasonCodes`,
`explanationFaithfulnessUngroundedNumbers`) is optional, so no existing `AiReadOnlyProjection`
object literal anywhere in the codebase needed to change; this avoided the blast-radius concern
originally raised here. The wiring scores the STRATEGY_PROPOSER's `rationaleClaims`/`uncertainty`
against the EVIDENCE_PRODUCER's own **fact-typed** observations only (not assumption/derived/
unknown-typed claims, which must not be able to ground a number) as the numeric-fact source, and
passes `action: "HOLD"` since this research-candidate layer's `decision` field
(`candidate | no_action | insufficient_evidence`) has no BUY/SELL trade direction to check
consistency against -- only groundedness and completeness are meaningful at this layer, and that
is what the wiring exercises. An orchestration result with no rationale text at all (no
`rationaleClaims`, empty `uncertainty`) leaves the projection's faithfulness fields `undefined`
rather than fabricating a verdict on nothing.

## Consequences

- Explanations are now scored for groundedness/completeness deterministically and replayably as
  part of the standard read-only AI projection every consumer already reads, closing a concrete
  instance of the audited 2/4 gap.
- The evaluator is intentionally simple (lexical, not semantic) -- it will not catch every real
  faithfulness violation (e.g. a fabricated *qualitative* claim with no attached number, or
  paraphrased evidence that doesn't literally restate a figure), and does not itself claim to.
  Its own tests document this as a design principle (small integers 0-9 are excluded from
  grounding checks as overwhelmingly ordinal, not quantitative, language), not an oversight.
- Remaining follow-up: the direction/certainty-language consistency checks
  (`DIRECTION_INCONSISTENT_WITH_DECISION`, `CONFIDENCE_LANGUAGE_OVERCLAIMS`) are exercised by the
  evaluator's own unit tests but not by this wiring, since the research-candidate layer has no
  BUY/SELL direction to check against. A live-trade-facing explainer (e.g. desktop's
  aiSignalExplainer, which does have a real decision direction) is a better target for exercising
  those two codes end-to-end and remains future work.
