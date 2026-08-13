# ADR-0017: ADVERSARIAL_CRITIC Independent-Provider Disagreement Comparator

- Status: Proposed
- Date: 2026-08-13
- Scope: PAPER/Research zero-authority AI reasoning only

## Context

Following ADR-0015 (RISK_VERIFIER) and ADR-0016 (EVIDENCE_PRODUCER), ADVERSARIAL_CRITIC is the
last of the four multi-agent roles (EVIDENCE_PRODUCER, STRATEGY_PROPOSER, ADVERSARIAL_CRITIC,
RISK_VERIFIER) without an independent-provider disagreement comparator. STRATEGY_PROPOSER already
has one from WO-AI-007/ADR-0010. ADR-0016 explicitly named this the next increment to close
"not universal across all roles" for good.

An adversarial critique that goes unchallenged by an independent second reviewer carries the same
single-point-of-failure risk as an unverified risk decision or an unverified evidence claim: a
critic's severity rating and issue counts materially shape whether a proposal proceeds, gets
revised, or gets rejected, so a lone provider's critique should not silently stand in for
consensus.

## Decision

Introduce `compareAdversarialCriticOutputs()` (`apps/cloud/src/ai/adversarialCriticDiversityComparator.ts`,
contract in `packages/contracts/src/aiAdversarialCriticDiversity.ts`): deterministic, pure
comparison over independent providers' ADVERSARIAL_CRITIC outputs for the SAME reviewed proposal.

**Free-text critique content is deliberately never compared**, for the same reason established in
ADR-0016: `AdversarialCriticProviderOutput` carries no `counterClaims`/`failedAssumptions`/
`missingTests`/`alternativeExplanations` text fields at all -- only structured, enumerable fields:
`severity` and each list's **count**. Exact-string or fuzzy matching of independently-worded
critiques across two providers would manufacture false disagreement out of paraphrasing, not real
divergence -- the same principle behind WO-AI-009's ablation fixtures ("irrelevant feature removal
does not manufacture attribution") and ADR-0016's evidence-claim exclusion.

Comparison requires all outputs to share one `reviewedProposalHash` -- if they don't, the providers
weren't reviewing the same proposal, so this **throws** (a structural precondition failure, same
severity as a duplicate `groupId`) rather than scoring a meaningless "disagreement." Given a shared
proposal: `severityAgreement` (exact match across the five-point `none`..`critical` scale) and four
independent count-agreement checks (`counterClaimCount`, `failedAssumptionCount`,
`missingTestCount`, `alternativeExplanationCount`), each exact-match with no invented tolerance --
consistent with ADR-0016's "no number is invented here" precedent.

Trust disposition follows RISK_VERIFIER's asymmetric severity, not EVIDENCE_PRODUCER's uniform
one: a `SEVERITY_DISAGREEMENT` means the providers can't agree on how dangerous the proposal even
is -- the same "can't agree on the gate-adjacent outcome itself" character as a RISK_VERIFIER
result mismatch -- so it `ABSTAIN`s rather than merely reducing trust. A same-severity disagreement
over exactly how many specific issues were found is real but less severe, so it only `REDUCE`s
trust. Fewer than 2 independent groups is `INCOMPLETE`/`ABSTAIN`, matching both prior comparators.

## Consequences

- ADVERSARIAL_CRITIC now has a governed, tested comparator (12 tests in
  `tests/ai-adversarial-critic-diversity-comparator.test.js`), closing the third and final
  instance of the audited "not universal across all roles" gap. All four multi-agent roles
  (EVIDENCE_PRODUCER, STRATEGY_PROPOSER, ADVERSARIAL_CRITIC, RISK_VERIFIER) now have an
  independent-provider comparator.
- Same explicit scope boundary as ADR-0015/ADR-0016: comparator only, no live dual-provider
  dispatch or `runtime.ts` scheduling. That wiring remains future work, tracked once across all
  four comparators rather than duplicated per-role.
- No role remains with zero comparator coverage after this change. The next capability audit
  should re-score the "Independent provider/model diversity" dimension accordingly, and decide
  whether live dual-provider wiring (still unimplemented for any of the four) is the better next
  increment over further per-role comparator refinement.
