# Learning Loop v2 — Replay / Restart Semantics

**Status:** CONFIRMED

Restart safety is a property the system already has in large part; v2 states it as a contract and
closes the two gaps that matter for a decision layer.

---

## 1. Replay is idempotent by construction

A cycle id is content-derived (`sha256(canonical(evidence identity))`,
`apps/cloud/src/closedLearningLoopCoordinator.ts:149-152`), so re-running a closed cycle produces the
same id. The existing coordinator distinguishes and records the outcome:

| Cycle result | Meaning |
| --- | --- |
| `EXECUTED` | the cycle ran and produced a decision |
| `REPLAYED` | the same evidence was re-submitted; the recorded result is returned, nothing new is written |
| `RESUMED` | a qualified-but-undeployed cycle continued (`:187-194`) |
| `WAITING_GOVERNANCE_APPROVAL` | the cycle completed; application awaits the governance actor |

Defined at `closedLearningLoopCoordinator.ts:74`, replay safety at `:196-204`.

**v2 invariant R1:** replaying a closed cycle must never write a second decision, never change the
applied surface twice, and never consume a second meta-holdout claim. This falls out of P2 (holdout
is single-use, `researchHoldoutLedger.ts:45`) plus the existing identity-conflict throw
(`:188-189,197-198`).

## 2. Bounded resume, never blind restart

- `MAX_CYCLE_RESUME_ATTEMPTS = 5` (`closedLearningRolloverScheduler.ts:115`).
- Restart-resume is restricted to the same KST trading day and the exact close boundary
  (`:179-188`, using `tradingDayKey`, `packages/contracts/src/risk-safety-integration.ts:132`).
- Waiting states are explicit and named (`WAITING_FOR_CANONICAL_BOUNDARY`,
  `WAITING_FOR_KST_DAY_ROLLOVER`, `WAITING_FOR_EVALUATION_WINDOW`, `WAITING_FOR_REALIZED_FILL`,
  `:340-363`), so a restart resumes a *named* state rather than guessing.
- Pending-period retirement deletes pending rows only, never realized ones
  (`persistedPaperPeriodStore.ts:331-338`).

**v2 invariant R2:** unlimited retry and blind restart are banned. A decision that failed to apply is
retried within the same bounded resume budget as everything else, or it is `REJECTED`.

## 3. Fail-closed on error

The scheduler's failure path records a runtime failure, sets `process.exitCode = 1`, and triggers
shutdown (`apps/cloud/src/closedLearningProductionRuntime.ts:481-489`). Meta-learning steering resets
to `1` on any error (`:443`). Strict replay withdraws the projection entirely rather than returning a
partial result (`closedLearningEvolutionLedgerRepository.ts:166`).

**v2 invariant R3:** a decision surface that cannot be resolved, replayed, or verified is not applied.
Partial success is never recorded as success.

## 4. The gap this closes

### G1 — Provenance must survive retention

A decision's provenance is a set of record references. If a referenced realized period is pruned
(`persistedPaperPeriodStore.ts:248-251`, called at `paperRealizedPeriodProducer.ts:297,460`), the
receipt survives but its basis does not, and replay can no longer verify it.

**Rule:** replay resolves every reference in the input set. An unresolvable reference is a fail-closed
condition — the decision is reported as unverifiable, never silently re-derived from whatever remains.
Retention is made reference-aware for the same reason (see
[Mutable/Immutable Surface §4](./learning-loop-v2-mutable-immutable-surface.md#4-retention--the-one-place-realized-evidence-is-deleted)).

### G2 — Cycle completion must be observable

Durable cycle count is derived from the immutable ledger (`closedLearningEvolutionLedgerRepository.ts:135-150`)
rather than stored — kept as-is, because deriving beats a mutable counter. But **in-process** counters
(`closedLearningLoopStatus.ts:251-260`) reset on restart.

**Rule:** "a window closed without producing a decision or an `INSUFFICIENT` record" must be
detectable after a restart, from durable data alone. Otherwise a crash between window close and
decision write would leave a permanently silent gap — the restart-equivalent of the bootstrap
deadlock this redesign exists to remove.

## 5. What restart may not do

It may not restart a scheduler into a duplicate instance (single lease, `cloud_paper_writer_leases`,
`packages/storage/src/index.ts:427-433`), may not re-derive a decision with different content for the
same cycle id (identity conflict throws), and may not clear or rewrite any immutable ledger.
