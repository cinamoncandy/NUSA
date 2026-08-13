# NUSA AI Capability Audit — 2026-08-13

## Scope

Follow-up audit after WO-AI-010 (governed explanation faithfulness/completeness evaluation,
ADR-0013). Does not satisfy or modify WO-0051, does not authorize LIVE, and does not add
execution, credential, promotion, risk-increase, model-weight mutation, or production-mutation
authority.

## Evidence reviewed

- `docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md`
- `.aipos/decisions/ADR-0013-governed-explanation-faithfulness-evaluation.md`
- `apps/cloud/src/ai/explanationFaithfulnessEvaluator.ts`, `packages/contracts/src/aiExplanationFaithfulness.ts`
- `apps/cloud/src/ai/projection.ts`'s `applyExplanationFaithfulness`
- `apps/desktop/src/aiSignalExplainer.ts`'s wired `faithfulness` field
- `tests/ai-explanation-faithfulness-evaluator.test.js`, `tests/ai-explanation-faithfulness-projection.test.js`, `tests/ai-signal-explainer-faithfulness.test.js` (37 tests total across the three files)
- repository search confirming no rate-card/cost-quality module, no wider N-version role coverage, and no provider-pool cancellation/cache lifecycle module exist yet

## Score changes since 2026-08-10

| Dimension | Prior | New | Evidence |
| --- | ---: | ---: | --- |
| Explanation quality / faithfulness | 2 | 3 | Deterministic, replay-safe groundedness/completeness/consistency evaluator now live in both the research-candidate projection (`projection.ts`) and a real trade-direction explainer (`aiSignalExplainer.ts`), covering all 6 reason codes end to end with adversarial fixtures. Not yet 4: coverage is two integration points, not every explanation surface (`aiRiskCommentary.ts`, `aiRegimeExplainer.ts`, `aiChallengerDisagreementExplainer.ts` remain unwired), and the evaluator is lexical, not semantic -- it will not catch a fabricated *qualitative* claim with no attached number. |

All other dimensions from the 2026-08-10 scorecard are unchanged by this audit; re-verifying them was out of scope for a single-capability follow-up.

## Selected next dimension

**Wider explanation-faithfulness coverage** (the remaining unwired explainers:
`aiRiskCommentary.ts`, `aiRegimeExplainer.ts`, `aiChallengerDisagreementExplainer.ts`,
`aiChallengerObserver.ts`'s disagreement summaries) is the lowest-effort, highest-continuity next
increment: it is the same evaluator, the same wiring pattern proven twice in WO-AI-010, and each
remaining explainer already has the numeric evidence and (where applicable) a decision/severity
field the evaluator needs. It closes the "2 of N integration points" gap noted above without
introducing new governed-capability design risk.

**Cost-quality optimization** (2/4, unchanged) and **wider N-version provider coverage** (3/4,
unchanged) remain the next candidates after that, per the 2026-08-10 audit's deferred list, and
should be re-scored with their own fresh evidence review before being selected -- this audit does
not do that work.

## Evidence truth

WO-AI-010's passing deterministic/adversarial fixtures prove the evaluator's own correctness on
those controlled cases. They do not prove that faithfulness scoring improves real trading outcome
quality, and no claim to that effect is made here.
