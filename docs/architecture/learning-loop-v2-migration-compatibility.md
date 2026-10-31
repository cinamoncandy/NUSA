# Learning Loop v2 — Migration / Compatibility Plan

**Status:** CONFIRMED

The redesign adds a decision layer over existing ledgers. It does **not** migrate, rewrite, or
reinterpret existing evidence.

---

## 1. Additive only

| Change | Kind | Migration |
| --- | --- | --- |
| Learning Decision receipts | new append-only ledger + meta | new **additive** migration, following the existing pattern |
| Learning Input Set / fingerprint | new columns or a new record type within that ledger | same migration |
| Meta-OOS partition membership | new columns on the new ledger | same migration |
| Supersession chain | new columns (`supersedes_record_id`) on the new ledger | same migration |

No existing table is altered, dropped, back-filled, or re-keyed. No existing migration id is
modified, renamed, or renumbered. This follows the rule the repository already enforces: a migration
id rename fails closed and never touches existing data.

### 1.1 Prohibited, explicitly

- Rewriting migration history
- Re-deriving or re-storing historical Lane A or Lane B records into the new schema
- Any data migration that would require reading an existing record and writing a modified version of
  it

Existing evidence stays exactly where it is; the new ledger **references** it by id.

## 2. Existing evidence is authoritative as-is

- Lane A: `evolution_learning_ledger_events`, `research_factory_decision_history`
- Lane B: `research_paper_forward_periods`, `cloud_paper_*`

The 31 realized PAPER periods, 202 canonical fills, and the 284 recorded candidate decisions
(`REJECTED 276 / INSUFFICIENT 8 / DEPLOYABLE 0`) already present on protected main are the starting
input set. **Nothing is back-filled, nothing is synthesized, and the zero-deployable history is not
"fixed"** — under D2 it is exactly the kind of evidence the first cycles learn from.

## 3. Compatibility with running systems

- The existing `metaLearningSteering()` path continues to work unchanged until the Learning Decision
  consumes it (Impact Analysis **M3**). There is no flag day.
- `longBarTickEvery` retains its current range, default, and reset-on-error behaviour throughout.
- The single-writer lease, the single composition root, and the single closed-learning scheduler are
  untouched, so no deployment topology changes.
- `/health` gains new display-only fields via the existing allowlist projection
  (`apps/cloud/src/closedLearningLoopStatus.ts`); no existing field changes meaning.

## 4. Rollout gates

Implementation may not begin until the design set is accepted. Once accepted, each step lands behind
its own gate, in this order — each is independently revertible:

1. **Retention reference guard** (Impact Analysis M1) — prerequisite; makes provenance survivable.
2. **Remove the deprecated advisory module** (Impact Analysis D1) — removes the second, weaker
   advisory path before the first real one exists.
3. **Learning Input Set + fingerprint** — pure derivation over existing ledgers; produces nothing but
   a fingerprint.
4. **Learning Decision receipt** — records guidance; applies nothing.
5. **Meta-OOS partition** — measures; cannot promote until its constants are owner-set and frozen.
6. **Bounded application** — the first point at which any surface can change, and only S1.

Each step requires its own evidence, non-author validation, audit, and release. No step may be
combined with another to shorten the path.

## 5. Rollback

Every step is additive, so rollback is removal of the new component, never restoration of altered
data. Nothing in the plan can leave existing evidence in a state that needs to be reconstructed.

## 6. What compatibility does not mean

Compatibility with existing **evidence** does not imply compatibility with existing **ambition**: a
window with no deployable candidate must now produce a decision, where today it produced nothing.
That is the intended behavioural change, and it is the point of the redesign.
