# Learning Loop v2 — Implementation Impact Analysis

**Status:** CONFIRMED
**Purpose:** Per the v2 work order, genuine N→N+1 implementation must not begin until the redesign
is settled. This is the required impact analysis over the existing closed learning implementation,
classified **KEEP / MODIFY / DEPRECATE / REMOVE**, plus the new surfaces the redesign introduces.

Every row was verified against protected main `79342c93`; file and line references are from that
tree. Items marked **NOT FOUND** were searched for explicitly and their absence is itself a finding.

---

## 1. KEEP — sound as implemented, no change required

| # | Surface | Location | Why it is kept |
| --- | --- | --- | --- |
| K1 | Evolution learning ledger (hash-chained, append-only) | `evolution_learning_ledger_events`, `packages/storage/src/evolutionLearningLedger.ts:231-260` | Strict replay throws on tamper; capacity exhaustion fails closed (`:209`); identity conflict fails closed (`:206`). This is Lane A's integrity backbone. |
| K2 | Full decision denominator | `research_factory_decision_history`, `packages/storage/src/researchFactoryDecisionHistoryRepository.ts:18-42` | Already records REJECTED / INSUFFICIENT / QUALIFIED_FOR_LEAGUE. This is exactly what D2 (learning independent of deployability) consumes. Nothing needs to be added to make failures learnable — they are already durable. |
| K3 | Cycle identity is content-derived | `closedLearningCycleId()` `apps/cloud/src/closedLearningLoopCoordinator.ts:149-152` | `sha256(canonical(evidence identity))` gives exactly-once semantics for free: re-deriving the same evidence yields the same cycle id, and a conflicting append throws (`:188-189,197-198`). |
| K4 | Point-in-time guards | `persistedPaperPeriodStore.ts:91,97,218-219`; `evolutionLearningLedger.ts:211,249-250`; `paperChallengerBindingLedger.ts:157-158`; `paperMarketBenchmark.ts:66-70`; `paperPerformanceGovernanceFeedback.ts:44,55-57` | A coherent, already-enforced cutoff rule: advisory must predate the period, cost must be observed at/after period start, chronology may never regress, bindings resolve as-of, benchmark must lie inside the window, and stale/future feedback is rejected. v2 adopts this as its PIT rule rather than writing a new one. |
| K5 | Zero-authority enforcement at every boundary | `closedLearningLoopCoordinator.ts:136`; `closedLearningEvolutionLedgerRepository.ts:97-99`; `paperChallengerDeploymentRuntime.ts:164,170`; `qualifiedPaperChallengerArtifactStore.ts:33`; `candidatePromotionRuntime.ts:67` | Authority is checked at each write and each deploy, not once at the top. The Learning Decision must be added to this same set, not given a new mechanism. |
| K6 | Governance actor restriction | `paperChallengerDeploymentRuntime.ts:77-85` | Only a human or a deterministic PAPER policy may approve; AI/AXIOM cannot approve their own candidate. This is the precedent D3 follows. |
| K7 | Durable cycle count is **derived**, not stored | `closedLearningEvolutionLedgerRepository.ts:135-150`, surfaced at `closedLearningLoopStatus.ts:139-153` | Deriving the count from an immutable ledger is strictly better than a mutable counter table. In-process counters (`closedLearningLoopStatus.ts:251-260`) stay display-only. **A new counter table is explicitly NOT added.** |
| K8 | Rollover state machine | `closedLearningRolloverScheduler.ts:8-21,304-441` | Twelve explicit statuses, all waiting states bounded and named, restart-resume restricted to the same KST trading day (`:179-188`), `MAX_CYCLE_RESUME_ATTEMPTS = 5` (`:115`). |
| K9 | Strategy governance lifecycle | `packages/contracts/src/strategyGovernance.ts:1`; `strategyGovernanceLedger.ts:17-27,34` | Transition table with integrity enforcement; CHAMPION/CHALLENGER transitions blocked pending an owner boundary (`candidatePromotionRuntime.ts:97`). |
| K10 | Single-use durable holdout ledger | `packages/storage/src/researchHoldoutLedger.ts:3,45,57-62` | Claims are durable and overlap contamination is checked. This is the correct substrate for meta-OOS. |
| K11 | Within-period OOS structure | `researchExperimentComposition.ts:70,83`; `researchExperimentRunner.ts:74-84,88,154`; `researchCandidateGate.ts:88-94,141` | Train/validation/holdout windows exist, holdout is only evaluated after validation favors the challenger, and reuse/contamination fail closed. Kept intact; meta-OOS is **added above** it, not substituted for it. |
| K12 | Bounded steering shape | `metaLearningSteering()` `packages/contracts/src/researchMetaLearning.ts:146-164` | Mutates exactly one value in range 1–4, documents that it changes no threshold/holdout/budget/risk/authority, and resets to 1 on error (`closedLearningProductionRuntime.ts:443`). This is the template for D4/D5. |
| K13 | Single-writer lease and single composition root | `cloud_paper_writer_leases` `packages/storage/src/index.ts:427-433`; ownership `closedLearningProductionRuntime.ts:79-97,140-147` | One scheduler, one engine, one evidence store per process; a second writer cannot start. |
| K14 | Failure receipts are append-only and deduplicated | `closedLearningEvolutionLedgerRepository.ts:153-164` (dedupe by identity at `:156-158`) | Failed cycles are recorded, never rewritten, never deleted. |

---

## 2. MODIFY — correct intent, insufficient for v2

### M1 — Realized-period retention can delete evidence a decision depends on *(highest priority)*

```ts
// packages/storage/src/persistedPaperPeriodStore.ts:248-251
public prune(maximumPeriods: number): void {
  if (!Number.isSafeInteger(maximumPeriods) || maximumPeriods < 1 || maximumPeriods > 1_000) throw new PersistedPaperPeriodStoreError("INVALID_RETENTION", "PAPER period retention must be between 1 and 1000");
  this.db.transaction(() => this.db.connection.prepare(`DELETE FROM ${TABLE} WHERE record_id NOT IN (SELECT record_id FROM ${TABLE} ORDER BY period_index DESC, record_id DESC LIMIT ?)`).run(maximumPeriods));
}
```

Called unconditionally at producer construction with a default of 100
(`apps/cloud/src/paperRealizedPeriodProducer.ts:297`, again at `:460`).

**The defect.** Lineage replay selects evidence by exact `paper-period:<recordId>` reference
(`apps/cloud/src/closedLearningLineageReplayInputSource.ts:89-127`) and the evidence identity embeds
the referenced record ids (`closedLearningEvidenceIdentitySource.ts:175-199`). Pruning is keyed only
on recency, so it will happily delete a period that a **recorded, applied** decision cites. After
that, the decision's provenance no longer resolves: the receipt survives, its basis does not.

Today this is latent — there is no decision component to break. Once D3 exists it becomes a live
integrity defect, and it is the one place in the system where realized Lane B evidence is physically
deleted.

**Required change.** Retention must become reference-aware: a period may be pruned only if no
surviving receipt references it, and the retention bound must remain an owner-set constant, never a
learned value. Deleting a referenced period must fail closed rather than silently succeed.

*This is a MODIFY, not a REMOVE — retention itself is legitimate for a 45 GB host; only its
unawareness of references is wrong.*

### M2 — Loop status must project the new decision state

`apps/cloud/src/closedLearningLoopStatus.ts` already projects durable failures and cycles onto
`/health` (`:139-153,189-198`) with a per-surface allowlist. The Learning Decision, its meta-OOS
partition, and its applied/rejected outcome must be added to that projection, display-only, through
the same allowlist — never as a decision input.

### M3 — Steering becomes a consumed allowlisted surface, not a free-standing one

`metaLearningSteering()` stays non-authoritative and stays in range, but its output becomes one
addressable surface *within* a Learning Decision rather than an independent side-effect of the
meta-learning tick. Its existing fail-safe (reset to `1` on any error, `closedLearningProductionRuntime.ts:443`)
is preserved verbatim.

---

## 3. DEPRECATE — present, unreachable, and a liability if left

### D1 — `abstentionOutcomeLearning.ts` is unwired advisory code

`apps/cloud/src/abstentionOutcomeLearning.ts:9-13` emits
`REVIEW_ABBSTENTION_THRESHOLD | REINFORCE_ABSTENTION_POLICY | COLLECT_MORE_EVIDENCE | NO_CHANGE`,
carries `lifecycleMutationAllowed: false` (`:51`), and **has no caller anywhere in `apps/` or
`packages/`** (verified by exhaustive search).

It is harmless today, but it is precisely the shape the v2 work order bans: a component that
*recommends threshold review*. Leaving an unwired threshold-advisory module in the tree invites a
future caller that wires it without the D3/D4/D5 discipline. It is deprecated and must be removed
before the Learning Decision lands, so there is never a second, weaker advisory path alongside it.

---

## 4. REMOVE

**Nothing.** No learning evidence, no decision history, no trial record, no cycle record, and no
migration may be removed. The v2 work order bans failed-trial deletion and migration-history rewrite
outright, so the correct REMOVE list is empty by construction. (Historical rewrite is likewise
absent from the codebase today — a search returned NOT FOUND — and must remain absent.)

---

## 5. ADD — the surfaces the redesign introduces

| # | New surface | Consumes | Produces | Authority |
| --- | --- | --- | --- | --- |
| A1 | **Learning Decision receipt** | Lane A + Lane B, via the Learning Input Set | Immutable receipt with provenance, outcome `APPLIED \| REJECTED \| INSUFFICIENT` | none |
| A2 | **Learning Input Set + fingerprint** | Exact record ids + PIT cutoff + both-lane digests | Deterministic fingerprint used as the cycle's input identity | none |
| A3 | **Meta-OOS partition** | Sequence of completed cycles | meta-train / meta-validation / meta-holdout membership, enforced by the durable holdout ledger (K10) | none |
| A4 | **Bounded update aperture** | The A1 decision | Per-surface clamped change, with the bound stated in the receipt | none |
| A5 | **Supersession registry** | Prior receipts for the same surface | Ordered, append-only supersession chain; never rewrites the superseded record | none |
| A6 | **Diversity/exploration budget** | History of applied surfaces | An enforced exploration allotment; exhaustion is reported as exhaustion | none |
| A7 | **Reference-aware retention guard** | M1 | Guard consulted by `prune()`; refusal is fail-closed | none |

**Explicitly NOT added:** a second scheduler, a second learning engine, a second evidence store, a
second control plane, a persistent cycle-counter table (see K7), and any threshold-mutation surface.

---

## 6. Search results that shaped this analysis

Explicitly searched and **NOT FOUND** — each absence is relied upon by the plan above:

- a `LearningDecision` type — the central missing piece
- any trust-region / learning-rate / clamp parameter adaptation beyond the 1–4 tick cadence
- any meta-level (cross-cycle) train/validation/test split
- any runtime-reachable path by which AI or the loop changes a qualification, OOS, cost, or
  sample-size threshold
- any code that deletes failed trials or rewrites cycle/decision history
- any persistent "cycles evaluated" counter table

---

## 7. Sequencing constraint

M1 and D1 are prerequisites: neither the retention guard (A7) nor the deprecated advisory module
(M-D1) may be left in place when A1 lands, or the new decision layer would sit on a substrate that
can silently drop its provenance. Everything else in §5 depends only on the KEEP set, which requires
no change.
