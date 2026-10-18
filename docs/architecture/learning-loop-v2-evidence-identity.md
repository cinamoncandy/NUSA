# Learning Loop v2 — Evidence Identity Specification

**Status:** CONFIRMED

A learning cycle is only legitimate if the evidence it consumed can be named exactly, resolved
later, and shown to have existed before the decision. This specification defines the **Learning
Input Set** and its fingerprint, and the point-in-time cutoff that governs it.

---

## 1. The Learning Input Set

The input set is the ordered, exact enumeration of the records a decision consumed. It is **not** a
query result that may drift; it is a resolved list of record references.

```
LearningInputSet = {
  cycleId,                 // sha256(canonical(inputSetIdentity))
  cutoffAt,                // PIT boundary — see §3
  laneA: [ reference... ], // research failure / trial evidence
  laneB: [ reference... ], // realized PAPER performance evidence
  digests: { laneA, laneB, combined },
  minimumInputBar          // frozen constant, never derived
}
```

### 1.1 Reference forms

| Lane | Reference | Resolved from |
| --- | --- | --- |
| A | `research-decision:<recordId>` | `research_factory_decision_history` |
| A | `cycle-failure:<recordId>` | `evolution_learning_ledger_events` (stage `IDENTITY|CYCLE|FINALIZE`) |
| B | `paper-period:<recordId>` | `research_paper_forward_periods` |
| B | `paper-fill:<fillId>` | `cloud_paper_fill_ledger` |

The `paper-period:<recordId>` form is already the canonical lineage reference used today by
`apps/cloud/src/closedLearningLineageReplayInputSource.ts:89-127`; v2 does not invent a second
reference scheme.

### 1.2 Fingerprint

`cycleId = sha256(canonical(inputSetIdentity))`, where `inputSetIdentity` is the canonical
serialization of `{cutoffAt, ordered laneA references, ordered laneB references}`.

Properties, each inherited from the existing implementation:

- **Deterministic.** Same evidence in, same id out — the existing
  `closedLearningCycleId()` (`apps/cloud/src/closedLearningLoopCoordinator.ts:149-152`) already has
  this property.
- **Conflict-detecting.** A second decision claiming the same cycle id with different content throws
  rather than overwriting (`:188-189,197-198`).
- **Lane-separated.** Lane A and Lane B digests are computed independently and combined, so neither
  lane's digest can be forged by supplying the other's records.

---

## 2. Provenance requirement

Every `LearningDecision` receipt must carry the full `LearningInputSet` — not merely the cycle id —
so a later reader can re-resolve each reference and re-derive the fingerprint independently.

This is the property that makes retention reference-aware (see Impact Analysis **M1**): a receipt
whose `paper-period:<recordId>` no longer resolves is a receipt whose basis is gone. Pruning must
therefore refuse to delete a referenced record.

---

## 3. Point-in-time cutoff

`cutoffAt` is the canonical boundary time of the closed window. A record is admissible to the input
set **only if its durable observation time is strictly before `cutoffAt`**. A record observed exactly
at the boundary is excluded, as is any later record.

v2 adopts the cutoff guards that already exist and are enforced, rather than writing new ones:

| Guard | Location | Rule |
| --- | --- | --- |
| Advisory must predate the period | `packages/storage/src/persistedPaperPeriodStore.ts:91` (`LOOKAHEAD_ADVISORY_SNAPSHOT`) | an advisory observed after period start is rejected |
| Cost must be observed in-window | `persistedPaperPeriodStore.ts:97` | `costEvidence.observedAt >= periodStartAt` |
| Chronology may never regress | `persistedPaperPeriodStore.ts:218-219`; `evolutionLearningLedger.ts:211,249-250` | out-of-order appends and replays are rejected |
| Bindings resolve as-of | `apps/cloud/src/paperChallengerBindingLedger.ts:157-158` | events with `occurredAt > decisionAt` are invisible |
| Benchmark must lie inside the window | `apps/cloud/src/paperMarketBenchmark.ts:66-70`; re-checked at `closedLearningEvidenceIdentitySource.ts:98-100` | out-of-window observations yield no benchmark |
| Stale or future feedback rejected | `apps/cloud/src/paperPerformanceGovernanceFeedback.ts:44,55-57` | observation range must match exactly |

**No new cutoff mechanism is introduced.** The learning decision is subject to the same rules as
everything else.

---

## 4. Integrity of the input set

- Lane A references resolve only through hash-chained ledgers whose strict replay throws on any
  malformed or tampered record (`closedLearningEvolutionLedgerRepository.ts:166`).
- Lane B references resolve only through checksum-bound, append-only period records
  (`persistedPaperPeriodStore.ts:201-224`; `RECORD_ID_CONFLICT` on reuse `:213-216`).
- An unresolvable reference is a **fail-closed** condition: the cycle does not produce a decision.

---

## 5. What the identity is not

- It is not a mutable pointer, a snapshot copy, or a re-derived aggregate. It names records.
- It is not authority. Resolving an input set grants no ability to change anything.
- It cannot be satisfied by synthetic records: fabricated candidates, fills, cost, or PnL are banned
  outright, and each lane's integrity chain would reject them regardless.
