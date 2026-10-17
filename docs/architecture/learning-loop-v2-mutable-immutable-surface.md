# Learning Loop v2 — Mutable / Immutable Surface Specification

**Status:** CONFIRMED

This is the complete list of what a Learning Decision may address (D4) and of what it can never
reach. **Anything not enumerated as mutable is immutable by construction**, and the immutable
surface is fail-closed.

---

## 1. Immutable surface — fail-closed, unreachable from any decision

| Surface | Integrity mechanism | Failure mode on tamper |
| --- | --- | --- |
| `evolution_learning_ledger_events` | hash chain `previous_hash`/`event_hash` | strict replay throws (`closedLearningEvolutionLedgerRepository.ts:166`) |
| `research_factory_decision_history` | hash chain + meta | integrity check throws (`researchFactoryDecisionHistoryRepository.ts:122-147`) |
| `research_paper_forward_periods` (realized) | append-only, checksum, `RECORD_ID_CONFLICT` on reuse | throw (`persistedPaperPeriodStore.ts:213-216`) |
| `cloud_paper_accounts` / `cloud_paper_account_history` / `cloud_paper_fill_ledger` | checksum-verified on read | account marked `CORRUPTED` (`paperTradingExecutionLoop.ts:256,260,273,293-295`) |
| `paper_public_market_observations` | `evidence_fingerprint_sha256 UNIQUE` | insert conflict |
| governance ledgers (`strategy_governance_events`, `research_evaluation_ledger`, `research_hypothesis_events`, …) | hash chains | integrity check throws |
| `qualified-paper-challengers.json` | sha256 per artifact | identity mutation fails closed (`qualifiedPaperChallengerArtifactStore.ts:117`) |
| migration history | immutable migration ids | a rename fails closed (`migrationRunner`) |

**A Learning Decision cannot write, delete, or supersede any row in the above.** Supersession
(§3) appends a *new* record; it never edits the superseded one.

---

## 2. Mutable surface — the complete allowlist

Each entry names the surface, its bound, and the fact that the bound is a **frozen constant**.

| # | Surface | Current value | Bound | Notes |
| --- | --- | --- | --- | --- |
| S1 | Research long-bar tick cadence `longBarTickEvery` | `1` | `[1, 4]`, `META_DEPRIORITIZED_TICK_EVERY = 4` | Already exists today; `metaLearningSteering()` (`packages/contracts/src/researchMetaLearning.ts:146-164`), applied at `closedLearningProductionRuntime.ts:441`, resets to `1` on error (`:443`). This is the **prototype and the ceiling** of the allowlist. |

**S1 is the entire current allowlist.** That is deliberate. The redesign adds decision *machinery* —
receipts, identity, meta-OOS, bounds, supersession, diversity — and does not, by that act, widen what
may be changed. Any surface added to this table in future requires its own frozen bound, its own
trust-region rule, and its own row in the validation matrix, and cannot be introduced by a Learning
Decision itself.

### 2.1 Explicitly not on the allowlist (and never may be)

- Qualification thresholds (including `PAPER_FORWARD_EVIDENCE_DEFAULT_POLICY.minimumLongitudinalPeriods = 30`,
  `apps/desktop/src/cloud/paperForwardEvidenceAdmission.ts:36-37`)
- Out-of-sample or holdout bars (including `META_EXHAUSTED_CONFIGS = 50`, the 20-period bar, the
  50-trade baseline-shadow bar)
- Execution quality policy (`CLOSED_LEARNING_EXECUTION_QUALITY_POLICY_V1`,
  `closedLearningProductionConfig.ts:4-9`)
- Cost, fee, or commission treatment
- Sample-size minimums anywhere
- Any risk setting, budget cap, or authority
- Any retention bound (see §4)

A search of protected main confirms **no runtime-reachable threshold mutation exists today**, and
this specification forbids creating one.

---

## 3. Bounded updates and supersession

### 3.1 Trust region

An applied update states, in the receipt, the previous value, the new value, and the bound it was
clamped against. A proposal that would exceed the bound is recorded as `REJECTED` with the bound
stated — it is not silently clamped and reported as success, because a silently-clamped success would
misrepresent what was learned.

### 3.2 Supersession

Supersession is an append-only chain: a new record declares which prior record it supersedes. The
superseded record remains, fully resolvable, in the immutable ledger. This is the same discipline
already used for release supersession and for the `PENDING_TERMINAL` immutability rule
(`persistedPaperPeriodStore.ts:242`).

---

## 4. Retention — the one place realized evidence is deleted

```ts
// packages/storage/src/persistedPaperPeriodStore.ts:248-251
public prune(maximumPeriods: number): void {
  if (!Number.isSafeInteger(maximumPeriods) || maximumPeriods < 1 || maximumPeriods > 1_000) throw new PersistedPaperPeriodStoreError("INVALID_RETENTION", "PAPER period retention must be between 1 and 1000");
  this.db.transaction(() => this.db.connection.prepare(`DELETE FROM ${TABLE} WHERE record_id NOT IN (SELECT record_id FROM ${TABLE} ORDER BY period_index DESC, record_id DESC LIMIT ?)`).run(maximumPeriods));
}
```

Retention is legitimate — the Oracle host has a 45 GB root filesystem and unbounded growth is a real
failure mode. What is wrong is that pruning is **unaware of references**: it keys only on recency,
while lineage replay cites exact `paper-period:<recordId>` references
(`apps/cloud/src/closedLearningLineageReplayInputSource.ts:89-127`) and the evidence identity embeds
those ids (`closedLearningEvidenceIdentitySource.ts:175-199`).

Once receipts exist (D3), pruning a referenced period silently destroys the basis of a recorded
decision. The required rule:

> A realized period may be pruned **only if no surviving receipt references it**. A retention bound
> that would remove a referenced period must fail closed rather than delete.

The retention bound stays an owner-set constant. It is **not** on the mutable allowlist and can never
become a learned value.

---

## 5. Best-effort and display-only surfaces

Unchanged and explicitly outside the decision path: `closed-learning-last-blocked.json`
(`closedLearningBlockedRecord.ts:10,25-36`), `runtime-last-failure.json`,
`research-refresh-last-attempt.json`, the baseline-shadow record, and the entire in-memory
`ClosedLearningLoopStatus` projection (`closedLearningLoopStatus.ts:95-109`). These are overwritten,
documented as low trust, and are never decision inputs.

---

## 6. Authority

Every surface above is addressed by a decision that carries **no authority whatsoever**:
`liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. Naming a value
is not permission to apply it, and applying it is not permission to touch anything else.
