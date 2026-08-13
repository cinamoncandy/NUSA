# ADR-0015: RISK_VERIFIER Independent-Provider Disagreement Comparator

- Status: Proposed
- Date: 2026-08-13
- Scope: PAPER/Research zero-authority AI reasoning only

## Context

`docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md` scored "Independent provider/model diversity" at
3/4: WO-AI-007's `NVersionStrategyEvaluator` compares independent providers for STRATEGY_PROPOSER
only -- "coverage is not universal across all roles." RISK_VERIFIER is the highest-value role to
extend next: it is the gate a candidate must pass before proceeding at all, so a single
provider's risk verification going uncontested is exactly the kind of single-point-of-failure
"fake independence" gap N-version comparison exists to catch.

## Decision

Introduce `compareRiskVerifierOutputs()` (`apps/cloud/src/ai/riskVerifierDiversityComparator.ts`,
contract in `packages/contracts/src/aiRiskVerifierDiversity.ts`): a deterministic, pure
comparator over already-produced `RiskVerifierProviderOutput` values from independent providers.

- `decisionAgreement`: do all groups agree on `verified | denied | incomplete`.
- `hardDenyOverlapRatio` / `requiredEscalationOverlapRatio`: case/whitespace-normalized Jaccard
  overlap (`|intersection| / |union|`) of each group's `hardDenies`/`requiredEscalations` sets.
  `1` when every group's set is identical (including all-empty -- independently agreeing "nothing
  to flag" is itself agreement); `null` only when there's nothing to compare (fewer than 2
  groups).
- Trust disposition is asymmetric by severity, matching WO-AI-007's own `NO_UPLIFT | REDUCE |
  ABSTAIN` vocabulary: a `RESULT_DISAGREEMENT` (one provider says `verified`, another says
  `denied`) means the providers cannot even agree on the gate outcome itself, so it `ABSTAIN`s
  entirely. A same-result disagreement over which specific hard denies/escalations apply is real
  but less severe -- the gate outcome itself is agreed -- so it only `REDUCE`s trust.
- Fewer than 2 independent groups is `INCOMPLETE` with `ABSTAIN`, never silently scored as
  consensus. A duplicate `groupId` across outputs throws rather than being silently counted as
  two independent opinions -- the same group reporting twice is not independence.

## Consequences

- RISK_VERIFIER now has a governed, tested comparator ready to detect and characterize provider
  disagreement, closing one instance of the audited "not universal across all roles" gap.
- **This is the comparator only.** Unlike `NVersionStrategyEvaluator`, this change does NOT
  dispatch model calls, manage a provider pool, or schedule live comparisons from `runtime.ts`.
  Replicating that live-execution plumbing (budget policy, provider pool config, scheduling,
  comparison-result caching) correctly for a second role is a substantially larger undertaking
  than the comparator itself, and doing it hastily risks the exact kind of "declared but not
  actually reachable" capability this repository's own audits have repeatedly flagged as worse
  than not having the capability at all. Wiring `compareRiskVerifierOutputs()` into a live
  dual-provider RISK_VERIFIER pathway is left as explicit, separately-scoped future work.
- EVIDENCE_PRODUCER and ADVERSARIAL_CRITIC remain the two roles with no independent-provider
  comparator at all (comparator or live wiring); the next audit should re-score with this
  landed and re-evaluate which of those two is next.
