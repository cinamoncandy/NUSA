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
execution, never changes `liveAuthority` or `productionMutationAllowed`, and is not itself wired
into the live orchestration pipeline's `AiReadOnlyProjection` by this change -- that projection
type is widely consumed and changing its shape has a large blast radius across existing tests.
This ADR lands the governed, independently-tested evaluator as the foundational primitive;
wiring it into `projectAiReadOnly()`'s output (so a faithfulness score becomes part of the
read-only projection every consumer already sees) is deferred as a follow-up, matching how prior
WO-AI capabilities landed in stages (WO-AI-009 alone took four follow-up commits: implement,
harden, simplify, close gaps).

## Consequences

- Explanations can now be scored for groundedness/completeness/consistency deterministically and
  replayably, closing a concrete instance of the audited 2/4 gap.
- The evaluator is intentionally simple (lexical, not semantic) -- it will not catch every real
  faithfulness violation (e.g. a fabricated *qualitative* claim with no attached number, or
  paraphrased evidence that doesn't literally restate a figure), and does not itself claim to.
  Its own tests document this as a design principle (small integers 0-9 are excluded from
  grounding checks as overwhelmingly ordinal, not quantitative, language), not an oversight.
- Follow-up work: wire this into `projection.ts`'s `AiReadOnlyProjection` and into
  `researchReviewAgent.ts`'s critic role so a low faithfulness score becomes visible
  disagreement/uncertainty evidence rather than a side channel nothing reads.
