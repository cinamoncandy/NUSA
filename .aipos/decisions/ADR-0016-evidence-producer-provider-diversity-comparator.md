# ADR-0016: EVIDENCE_PRODUCER Independent-Provider Disagreement Comparator

- Status: Proposed
- Date: 2026-08-13
- Scope: PAPER/Research zero-authority AI reasoning only

## Context

Following ADR-0015 (RISK_VERIFIER), EVIDENCE_PRODUCER is the next role extended toward the
"not universal across all roles" gap in `docs/NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md`'s 3/4
"Independent provider/model diversity" score. Evidence claims feed every downstream role
(STRATEGY_PROPOSER, ADVERSARIAL_CRITIC, RISK_VERIFIER), so an evidence-producer error or
one-sided reading propagates further than an error in any single downstream role.

## Decision

Introduce `compareEvidenceProducerOutputs()` (`apps/cloud/src/ai/evidenceProducerDiversityComparator.ts`,
contract in `packages/contracts/src/aiEvidenceProducerDiversity.ts`): deterministic, pure
comparison over independent providers' EVIDENCE_PRODUCER outputs for the SAME evidence bundle.

**Free-text claim content is deliberately never compared.** `EvidenceProducerProviderOutput`
carries no `claim` text field at all -- only structured, enumerable fields: `factClaimCount`,
`missingEvidence` (string IDs), `citedEvidenceReferences` (string IDs, union across
observations). Exact-string or fuzzy matching of independently-worded claim text across two
providers would manufacture false disagreement out of paraphrasing, not real divergence -- the
same principle behind WO-AI-009's ablation fixtures ("irrelevant feature removal does not
manufacture attribution"). A test (`tests/ai-evidence-producer-diversity-comparator.test.js`)
pins this down explicitly: the contract's shape itself makes claim-text comparison impossible,
not just unused.

Comparison requires all outputs to share one `evidenceBundleHash` -- if they don't, the providers
weren't shown identical evidence, so this **throws** (a structural precondition failure, same
severity as a duplicate `groupId`) rather than scoring a meaningless "disagreement." Given a
shared bundle: `factClaimCountAgreement` (exact match, no invented tolerance -- see the
execution-cost-parity ADR's "no number is invented here" precedent for why an arbitrary
delta-tolerance threshold is avoided rather than guessed), and Jaccard overlap of
`missingEvidence`/`citedEvidenceReferences`.

Trust disposition differs from RISK_VERIFIER's asymmetric severity: **every** disagreement here
only `REDUCE`s trust, never `ABSTAIN`s (except the `INCOMPLETE`/<2-groups case). Evidence-producer
disagreement never blocks anything by itself -- downstream roles still apply their own gates to
whatever evidence was cited, so there's no "gate outcome itself is contested" case the way a
RISK_VERIFIER result mismatch is.

## Consequences

- EVIDENCE_PRODUCER now has a governed, tested comparator, closing a second instance of the
  audited "not universal across all roles" gap.
- Same explicit scope boundary as ADR-0015: comparator only, no live dual-provider dispatch or
  `runtime.ts` scheduling. That wiring remains future work, tracked once alongside the
  RISK_VERIFIER wiring rather than duplicated per-role.
- ADVERSARIAL_CRITIC remains the one role with no independent-provider comparator (comparator or
  live wiring) after this change. The next audit should re-score with WO-AI-012/013 landed and
  decide whether ADVERSARIAL_CRITIC coverage or live wiring for the existing comparators is the
  better next increment.
