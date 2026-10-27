# Learning Loop v2 — Architecture Decision Record

**Status:** CONFIRMED (design only — no N→N+1 implementation may proceed until this set is accepted)
**Supersedes:** the previous work order for the closed learning loop
**Scope:** `apps/cloud/src/closedLearning*`, `packages/storage` learning ledgers, `researchMetaLearning*`
**Authority:** this document grants none. Every statement below is subordinate to the absolute
safety invariants in [Safety Invariants](#safety-invariants).

---

## 1. Problem

The closed learning loop today can only produce value from a **deployable candidate**. A research
experiment that fails, or a period that yields no deployable strategy, produces evidence that
nothing consumes: there is no component whose job is to answer *"what should iteration N+1 do
differently, given what lanes A and B actually observed?"*.

The concrete consequence on protected main: `REJECTED 276 / INSUFFICIENT 8 / DEPLOYABLE 0`, with 31
realized PAPER periods, 202 canonical fills, and **0 genuine closed-learning cycles**. 284 candidate
decisions were recorded; nothing learned from the denominator.

Three structural defects produced this:

1. **Bootstrap deadlock.** Cycle value was coupled to a deployable candidate, so an empty candidate
   supply meant an empty learning loop, forever, without ever being reported as a fault.
2. **No decision component.** Both evidence lanes exist and are well-hardened, but nothing converts
   them into a bounded statement about the next iteration.
3. **No meta-level evaluation.** Out-of-sample evaluation exists *within* one period, but there is no
   split *over* cycles, so nothing can distinguish "this guidance generalizes" from "this guidance
   fit the periods it was derived from".

## 2. What already exists and is sound

The redesign **does not replace** the evidence infrastructure; it adds the missing decision layer on
top of it. The following were verified against protected main and are kept as-is (full inventory and
classification in [Impact Analysis](./learning-loop-v2-impact-analysis.md)):

| Property | Where | Verdict |
| --- | --- | --- |
| Lane A evidence (research failure/trials), hash-chained, append-only | `evolution_learning_ledger_events`, `packages/storage/src/evolutionLearningLedger.ts:231-260` | KEEP |
| Lane A full decision denominator | `research_factory_decision_history`, `packages/storage/src/researchFactoryDecisionHistoryRepository.ts:18-42` | KEEP |
| Lane B realized PAPER evidence, checksum-bound, append-only while retained | `research_paper_forward_periods`, `packages/storage/src/persistedPaperPeriodStore.ts:201-224` | KEEP (retention change in §6) |
| Exactly-once cycle identity | `closedLearningCycleId()` = `sha256(canonical(evidence identity))`, `apps/cloud/src/closedLearningLoopCoordinator.ts:149-152` | KEEP |
| Point-in-time guards | `LOOKAHEAD_ADVISORY_SNAPSHOT` `persistedPaperPeriodStore.ts:91`; cost `observedAt >= periodStartAt` `:97`; chronology regression `evolutionLearningLedger.ts:211`; as-of binding `paperChallengerBindingLedger.ts:157-158`; benchmark within window `paperMarketBenchmark.ts:66-70` | KEEP |
| Zero-authority enforcement | `closedLearningLoopCoordinator.ts:136`; `paperChallengerDeploymentRuntime.ts:77-85`; `ZERO_AUTHORITY` artifact check `qualifiedPaperChallengerArtifactStore.ts:33` | KEEP |
| Fail-closed on tamper | strict replay throws `closedLearningEvolutionLedgerRepository.ts:166` | KEEP |

**No runtime-reachable threshold mutation exists today.** A search for any path by which AI or the
loop could change a qualification, OOS, cost, or sample-size threshold returned NOT FOUND: every bar
is a frozen constant (`META_EXHAUSTED_CONFIGS = 50` `researchMetaLearning.ts:46`; the 20-period bar
`researchMetaLearningRuntime.ts:51`; `CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1`
`closedLearningProductionConfig.ts:4-9`). The redesign must not create one.

## 3. Decision

### D1 — Two separated evidence lanes, converging into exactly one decision

Lane **A** (research failure/trial) and Lane **B** (realized PAPER performance) remain physically
separated: different tables, different writers, different integrity chains. They converge only at a
single component, the **Learning Decision**, which is the sole consumer permitted to read both.

Neither lane has authority over the other. Lane A cannot suppress or promote a Lane B outcome, and
Lane B cannot rewrite, delete, or reclassify a Lane A trial. Neither lane can execute anything.

### D2 — Learning is not gated on deployability (removes the bootstrap deadlock)

A learning cycle is produced whenever a bounded evidence window closes with **any** qualifying
evidence — including a window in which every candidate was REJECTED or INSUFFICIENT. "No deployable
candidate" is a legitimate, first-class learning outcome, not a reason to skip the cycle.

Concretely, the decision input is drawn from the recorded denominator, not from the qualified
numerator. The existing `research_factory_decision_history` already stores the full denominator for
this purpose.

### D3 — The Learning Decision is a receipt, not a mutation

The decision is an immutable, provenance-carrying receipt. It states *what guidance iteration N+1 is
being given and why*. It does not itself change any parameter. Applying it is a separate, allowlisted,
bounded step (D4).

This is the same split the system already uses for governance: `paperChallengerDeploymentRuntime.ts`
requires a human or deterministic PAPER policy actor to approve, and explicitly refuses AI
self-approval (`:77-85`). The Learning Decision follows that precedent and never crosses it.

### D4 — Only an allowlist of mutable surfaces exists

The decision may address **only** the surfaces enumerated in
[Mutable/Immutable Surface Specification](./learning-loop-v2-mutable-immutable-surface.md). Anything
not on that list is unreachable from the decision by construction, and the immutable surface is
fail-closed.

The existing `metaLearningSteering()` is the prototype and the ceiling of this pattern: it mutates one
value (`longBarTickEvery`, range 1–4) and documents that it changes no pass rule, threshold, holdout,
budget cap, risk setting, or authority (`packages/contracts/src/researchMetaLearning.ts:147-152`).
v2 generalizes this *shape*, not its scope.

### D5 — Every update is bounded

Each applied change is bounded against its previous value (a trust region), and the bound is a frozen
constant, not a learned or derived quantity. A decision that would exceed the bound is recorded as
REJECTED with the bound stated — rejection is itself learning evidence and is never silent.

### D6 — Meta-out-of-sample evaluation over cycles

Guidance is not accepted because it improved the periods it was derived from. Cycles are partitioned
into meta-train / meta-validation / meta-holdout, and only meta-holdout can promote guidance to
"applied". This is the largest genuine gap today and is specified in
[Meta-OOS Specification](./learning-loop-v2-meta-oos-specification.md).

### D7 — Diversity and exploration are enforced, not hoped for

The decision surface carries an explicit exploration budget so the loop cannot collapse onto a single
configuration by repeatedly choosing the locally-best option. Exhaustion is reported as exhaustion.

## 4. What this decision does NOT do

- It does not grant the loop, AI, or either evidence lane any authority. `liveAuthority=NONE`,
  `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY` are unchanged.
- It does not create a second scheduler, learning engine, evidence store, or control plane. The
  Learning Decision is a function over existing ledgers, reached from the existing single tick.
- It does not relax any qualification, OOS, cost, or sample-size threshold. The decision cannot
  address thresholds at all.
- It does not permit synthetic candidates, fills, cost, or PnL; historical rewrite; direct DB edits;
  migration-history rewrite; failed-trial deletion; or denominator manipulation.

## Safety Invariants

The following are absolute and are not editable by any component described here, including this
design:

`PAPER_ONLY` · `liveAuthority=NONE` · `productionMutationAllowed=false` · `aiAuthority=ZERO_AUTHORITY`

Banned without exception: threshold relaxation (qualification / OOS / cost / sample); synthetic
candidate, fills, cost, or PnL; historical rewrite; direct DB edit; migration history rewrite;
failed-trial deletion; denominator manipulation; duplicate scheduler, learning engine, evidence
store, or control plane; blind restart; unlimited retry; self-review; self-approval; AI direct merge.

## Related

- [Learning State Machine](./learning-loop-v2-state-machine.md)
- [Evidence Identity Specification](./learning-loop-v2-evidence-identity.md)
- [Mutable/Immutable Surface Specification](./learning-loop-v2-mutable-immutable-surface.md)
- [Meta-OOS Specification](./learning-loop-v2-meta-oos-specification.md)
- [Replay/Restart Semantics](./learning-loop-v2-replay-restart.md)
- [Migration/Compatibility Plan](./learning-loop-v2-migration-compatibility.md)
- [Validation Matrix](./learning-loop-v2-validation-matrix.md)
- [Impact Analysis (KEEP/MODIFY/DEPRECATE/REMOVE)](./learning-loop-v2-impact-analysis.md)
