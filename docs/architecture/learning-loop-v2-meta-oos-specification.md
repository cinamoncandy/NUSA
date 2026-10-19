# Learning Loop v2 — Meta-Out-of-Sample Specification

**Status:** CONFIRMED

## 1. The gap

Out-of-sample evaluation exists **within** one period: train/validation/holdout windows
(`apps/cloud/src/researchExperimentComposition.ts:70,83`; `researchExperimentRunner.ts:74-84,88,154`),
a single-use durable holdout ledger (`packages/storage/src/researchHoldoutLedger.ts:3,45,57-62`), and
candidate gates that fail closed on contamination or reuse (`apps/cloud/src/researchCandidateGate.ts:88-94,141`).

There is **no split over cycles**. A search for a meta-level (cross-cycle) train/validation/test
partition returned NOT FOUND. The nearest existing structure is a cumulative count threshold — the
20-realized-period bar at `apps/cloud/src/researchMetaLearningRuntime.ts:51` — which is a minimum
sample size, not a partition.

**Why this matters.** Without a meta-level split, guidance derived from cycles 1..N can only be
evaluated on evidence from cycles 1..N. Guidance that overfits its own history is then
indistinguishable from guidance that generalizes, and the loop cannot tell the difference. Any
"steering improved things" claim would be measured on the data that produced the steering.

## 2. Partition

Cycles, not samples within a cycle, are the partitioned unit. Membership is assigned at cycle close
and is immutable thereafter.

| Partition | Role | May it change the applied surface? |
| --- | --- | --- |
| `META_TRAIN` | Derive candidate guidance. | no |
| `META_VALIDATION` | Select among candidate guidances; reject overfit ones. | no |
| `META_HOLDOUT` | Sole authority for promotion to `APPLIED`. | **yes** |

### 2.1 Rules

- **P1 — Assignment is by cycle order, not by outcome.** A cycle's partition depends only on its
  position in the cycle sequence, never on whether its result was favourable. This prevents an
  outcome-conditioned split, which would leak the answer into the partition.
- **P2 — Holdout is single-use.** A meta-holdout cycle may be consumed by exactly one guidance
  evaluation, enforced through the existing durable ledger (`researchHoldoutLedger.ts:45`) and its
  overlap-contamination check (`:57-62`). Reuse fails closed.
- **P3 — Only meta-holdout promotes.** `META_TRAIN` and `META_VALIDATION` may narrow a proposal down
  but can never move a decision to `APPLIED`. This is the whole point of the split.
- **P4 — Partition membership is immutable.** Once assigned at cycle close it is never reassigned,
  and a superseded guidance never retroactively claims a different partition.
- **P5 — Minimum sizes are frozen constants.** Partition sizes and the promotion bar are owner-set
  constants, never derived from observed performance and never adjustable by the loop.

## 3. Relationship to the existing 20-period bar

`paperLedgerForwardEntry` requires ≥ 20 realized periods with mean net > 0 **and** mean excess > 0
before realized PAPER periods are eligible as a holdout input (`researchMetaLearningRuntime.ts:51`).
That bar is **kept unchanged**. It is a sample-sufficiency precondition and remains independent of
the meta partition: P5 applies to the new constants, and no existing bar is relaxed.

Similarly `nextHoldoutBar = 0.05 / (configurations + 1)` (`packages/contracts/src/researchMetaLearning.ts:18,120`)
is report-only and stays report-only.

## 4. Exhaustion

A guidance that survives meta-validation but fails meta-holdout is recorded as `REJECTED` with the
partition evidence attached, and counts toward the exhaustion tally. Repeated failures accumulate the
same way `META_EXHAUSTED_CONFIGS = 50` does today (`researchMetaLearning.ts:46,93`): when the
budget is exhausted the system reports exhaustion rather than continuing to accept guidance.

## 5. Authority

The meta-OOS evaluation **measures**; it does not act. It can move a decision between `BOUNDED`,
`META_EVALUATED`, `APPLIED`, and `REJECTED` per
[Learning State Machine](./learning-loop-v2-state-machine.md), and it can name an allowlisted
surface. It cannot change a threshold, a holdout definition, a budget cap, a risk setting, or any
authority — the same restriction already documented at
`packages/contracts/src/researchMetaLearning.ts:6-8,147-152`.

## 6. What is explicitly out of scope

- Partitioning **within** a period — already exists and is kept (K11).
- Any claim about live trading. `PAPER_ONLY`, `liveAuthority=NONE`, and
  `productionMutationAllowed=false` are unaffected.
- Any change to the realized-period, holdout, or qualification thresholds named above.
