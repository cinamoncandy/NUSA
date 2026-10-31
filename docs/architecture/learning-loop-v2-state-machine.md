# Learning Loop v2 — Learning State Machine

**Status:** CONFIRMED

This specifies the states a **learning cycle** and a **Learning Decision** may occupy, and the
transitions between them. It is additive to the existing state machines, which are kept intact:

- Rollover states (`NO_OPEN_PERIOD` … `BLOCKED`) — `apps/cloud/src/closedLearningRolloverScheduler.ts:8-21`
- Closed-learning decision outcome (`REJECTED | INSUFFICIENT | QUALIFIED_FOR_LEAGUE`) — `apps/cloud/src/closedLearningLoopCoordinator.ts:3`
- PAPER period lifecycle (`COMPLETED | REJECTED | HALTED`) — `packages/contracts/src/persistedPaperPeriod.ts:3`
- Strategy governance lifecycle — `packages/contracts/src/strategyGovernance.ts:1`

The learning state machine sits **above** those and never mutates them.

---

## 1. Cycle states

```
                  ┌──────────────────────────────────────────────┐
                  │                                              │
                  ▼                                              │
   WINDOW_OPEN ──► WINDOW_CLOSED ──► INPUT_SET_BUILT ──► DECIDED─┤
        ▲               │                  │                │    │
        │               │                  │                │    │
        │        (no qualifying           │                │    │
        │         evidence: still         │                │    │
        │         WINDOW_OPEN —           │                │    │
        │         D2: never skipped)      │                │    │
        │                                 ▼                │    │
        │                        INSUFFICIENT ◄────────────┘    │
        │                        (recorded, still                │
        │                         a completed cycle)             │
        │                                                        │
        └────────────────────────────────────────────────────────┘
```

| State | Entered when | Exit |
| --- | --- | --- |
| `WINDOW_OPEN` | A period is open, or a bounded evidence window has not yet closed. | Canonical boundary crossed **and** a real FILLED observation exists (`closedLearningRolloverScheduler.ts:340-363`). |
| `WINDOW_CLOSED` | The window closed and its evidence is durable. | The Learning Input Set is built. |
| `INPUT_SET_BUILT` | The input set and its fingerprint resolved deterministically under the PIT cutoff. | A decision is produced. |
| `DECIDED` | A `LearningDecision` receipt was written to the immutable ledger. | Terminal for this cycle. |
| `INSUFFICIENT` | Evidence did not meet the minimum input bar. **Still a completed cycle** — it is recorded, counted, and is learning evidence. | Terminal for this cycle. |

### 1.1 Invariants

- **C1 (D2 — no bootstrap deadlock).** `WINDOW_CLOSED → INSUFFICIENT` and `WINDOW_CLOSED → DECIDED` are
  both normal completions. A window in which every candidate was REJECTED or INSUFFICIENT still
  produces `DECIDED`; there is **no** state that means "nothing to learn from".
- **C2 (exactly-once).** A cycle id is `sha256(canonical(evidence identity))`. Re-entering
  `WINDOW_CLOSED` with identical evidence yields the same id and replays rather than duplicating
  (`closedLearningLoopCoordinator.ts:196-204`).
- **C3 (no skipping).** There is no transition that closes a window without producing either a
  decision or an `INSUFFICIENT` record. A missing decision for a closed window is a fault, not a
  legitimate state.
- **C4 (bounded resume).** Resumption of a qualified-but-undeployed cycle is bounded
  (`MAX_CYCLE_RESUME_ATTEMPTS = 5`, `closedLearningRolloverScheduler.ts:115`) and restricted to the
  same KST trading day (`:183-184`). Blind restart is not a transition.

---

## 2. Decision states

```
  PROPOSED ──► BOUNDED ──► META_EVALUATED ──► APPLIED
      │           │              │
      │           │              └──► REJECTED (guidance did not survive meta-holdout)
      │           │
      │           └──► REJECTED (would exceed the trust region; the bound is stated)
      │
      └──► INSUFFICIENT (input set below minimum bar)
```

| State | Meaning | Consequence |
| --- | --- | --- |
| `PROPOSED` | Guidance derived from the input set, with provenance. | none |
| `BOUNDED` | Passed the per-surface trust region; the bound is recorded alongside the proposal. | none |
| `META_EVALUATED` | Assessed against meta-validation and meta-holdout. | none |
| `APPLIED` | Adopted for iteration N+1 **on an allowlisted surface only**. | the named surface's next value |
| `REJECTED | INSUFFICIENT` | Recorded with the reason. | none |

### 2.1 Invariants

- **D1 (receipt, not mutation).** No state in this machine executes anything. Only `APPLIED` names a
  surface, and applying it is a separate, allowlisted, bounded step.
- **D2 (rejection is learning).** `REJECTED` and `INSUFFICIENT` are written to the same immutable
  ledger as `APPLIED`. A rejected proposal is not discarded, and its record is a required input for
  later cycles' diversity accounting (§3).
- **D3 (no self-approval).** The transition into `APPLIED` cannot be entered by AI. It follows the
  existing governance actor restriction — human or deterministic PAPER policy only
  (`paperChallengerDeploymentRuntime.ts:77-85`) — and the loop cannot approve its own guidance.

---

## 3. Diversity and exploration

The applied-surface history feeds an enforced exploration budget. Repeatedly selecting the
locally-best surface is prevented by construction; when the budget is exhausted the machine reports
exhaustion rather than silently continuing, mirroring the existing `EXHAUSTED` condition at
`META_EXHAUSTED_CONFIGS = 50` (`packages/contracts/src/researchMetaLearning.ts:46,93`).

---

## 4. What this machine may not do

It may not change any strategy governance lifecycle (K9), may not reopen or rewrite a realized
period, may not delete a trial, and may not address any threshold. Its only effect is to name the
next value of an allowlisted surface in [Mutable/Immutable Surface Specification](./learning-loop-v2-mutable-immutable-surface.md).
