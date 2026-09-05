# Owner decision brief: idempotency TTL / quarantine + UTC/KST daily boundary

Status: **options only — no behavior changed by this document.**
Both items are POLICY BLOCKED: implementation requires an explicit owner
decision. Code references are pinned to main `a0ba9fe6`.

Safety invariants are unaffected either way:
`liveAuthority=NONE`, `productionMutationAllowed=false`,
`aiAuthority=ZERO_AUTHORITY`.

---

## 1. Idempotency record retention

### Current state (measured, not assumed)

- `risk_idempotency_records` (`packages/storage/src/index.ts:340`): primary key
  `(account_id, idempotency_key)` plus UNIQUE on `(account_id, command_id)`,
  `(account_id, signal_id)`, `(account_id, client_order_id)`. No expiry
  column consulted, no deletion job exists.
- Claim path (`packages/storage/src/risk-safety.ts:32`): same key +
  different payload fails closed (`IDEMPOTENCY_CONFLICT`); same key + same
  payload is rejected as duplicate (`IDEMPOTENCY_DUPLICATE`). Both behaviors
  are test-pinned and must survive any option below.
- `created_at_ms` is recorded but never used for expiry.

### Option A — permanent idempotency (status quo)

- Replay risk: none. A retried/replayed command is recognized forever.
- Storage growth: unbounded, linear in distinct commands. For a single-user
  PAPER runtime this is kilobytes per year; a non-issue at current scale.
- Auditability: perfect — every historical claim remains provable.
- Broker semantics: matches exchange idempotency expectations (keys are
  per-command UUIDs; reuse across commands is already a conflict).
- Cost of choosing: zero code change.

### Option B — bounded TTL (e.g. 30/90 days)

- Replay risk: a duplicate arriving after expiry is treated as NEW. Safe
  only if upstream systems never retry past the TTL (today nothing
  guarantees that — would need a documented retry ceiling first).
- Storage growth: bounded, but the bound only matters at scales this
  project does not have.
- Auditability: degraded — post-expiry forensics lose the claim record.
- Needed work if chosen: owner-picked duration, scheduled purge job,
  purge-before-read ordering proof, tests for expiry-boundary races
  (claim at T-1ms, purge at T, re-claim at T+1ms).

### Option C — TTL + quarantine

- Same as B, plus expired keys move to an append-only quarantine table
  instead of deletion: replays after expiry fail closed with
  `IDEMPOTENCY_EXPIRED` rather than executing as new.
- Replay risk: none (fail-closed preserved).
- Storage growth: same as A in practice (quarantine retains everything).
- Auditability: preserved.
- Needed work if chosen: quarantine schema + migration, purge-and-archive
  job, tests. Strictly more machinery than A for identical safety.

### Recommendation for the owner

**A.** B trades provable safety for storage savings the project does not
need; C re-implements A with extra moving parts. Revisit only if the
idempotency table measurably impacts operations (it does not today).

---

## 2. UTC vs KST daily boundary

### Current state (measured)

- `tradingDayKey` (`packages/contracts/src/risk-safety-integration.ts:132`)
  hard-codes `DAY_TIME_ZONE = "Asia/Seoul"`: the risk day, daily-loss
  reset (`risk_daily_loss_state.trading_day`), and day-start equity are
  all **KST-calendar** based today.
- Internal canonical timestamps elsewhere are epoch millis (UTC-based,
  timezone-agnostic). Only the *calendar-day bucketing* is KST.
- Mobile UI day labels (e.g. order-history TODAY/7D filters) are computed
  on device in local time — consistent with KST for a Korea-based user,
  but by device locale, not by contract.

### Option A — keep KST (status quo)

- Risk day == Korean user's calendar day: PnL-day, loss-reset, and UI day
  filters agree for the primary user.
- Cost: zero. Risk: a user traveling across timezones sees device-local UI
  days diverge from the KST risk day (cosmetic only; risk math unchanged).

### Option B — move risk day to UTC

- Matches exchange-day conventions (Upbit operates on KST too, so this
  buys little) and makes server logs timezone-neutral.
- Cost: migration of `trading_day` values, dual-write or cutover plan,
  UI day-filter realignment, tests. Breaks the current intuitive match
  between "today's loss limit" and the user's calendar.
- Only pick this if operations move to UTC-based reporting.

### Open definitional question for the owner

Must the UI day and the risk day always coincide? Today they do (for a
KST user). If yes, keep A and additionally pin device-local day filters
to KST explicitly. If no, say which surface owns which definition before
any code changes.

### Recommendation for the owner

**A.** The system is already KST-consistent where it matters (risk reset).
Do not churn it without an operations-driven reason.

---

## Decision record

- [ ] Idempotency retention: A / B / C (+ duration if B/C) — owner decision, date:
- [ ] Daily boundary: A / B (+ UI-day definition) — owner decision, date:
