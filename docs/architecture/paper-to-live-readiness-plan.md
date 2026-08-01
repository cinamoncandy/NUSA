# NUSA Paper-to-Live Readiness Plan

## Objective

Move NUSA from a reliable Upbit spot Paper Trading system toward a **small-capital live candidate** without enabling live orders prematurely.

The first success condition is not profit. It is:

> The system operates for a sustained evidence window without an unresolved accounting, persistence, recovery, market-data, execution, or risk-control ambiguity.

Live mutation remains disabled until every mandatory gate is satisfied and the owner gives explicit approval.

## Corrected architecture

```text
Market Data Sources
  -> Data Quality Gate
  -> Normalized Event Stream
  -> Market Regime / Intelligence
  -> Strategy Registry
  -> Decision Engine
  -> Portfolio & Exposure Policy
  -> Pre-Trade Risk
  -> Durable Intent / Outbox
  -> Execution Coordinator
  -> Paper Adapter | Shadow Adapter | Future Live Adapter
  -> Fill & Account Event Ingestion
  -> Immutable Ledger
  -> Position / Balance / Fee Projections
  -> Exchange Reconciliation
  -> Runtime Health & Kill Switch
  -> Analytics / Reality Check / Strategy Decay
  -> Research Memory and Promotion Governance
```

## Non-negotiable boundaries

- Strategy emits evidence-backed signals; it never places orders.
- Decision creates an intent; it cannot bypass portfolio or risk policy.
- Risk can reject, resize, pause, or halt every intent.
- Only durable, approved intents may reach execution.
- Order submission uses idempotency keys and explicit unknown-submission handling.
- Paper, shadow, and live adapters share contracts but never mutable operating state.
- Reconciliation detects differences; it never silently rewrites economic history.
- Unknown, stale, missing, or contradictory evidence fails closed for new exposure.
- A kill switch stops new exposure first; position liquidation is a separate explicit policy.
- AI may explain evidence but cannot authorize, resize, submit, cancel, or close orders.

## P0 gates before any small-capital live candidate

### 1. Data integrity gate

Block strategy evaluation or new exposure when any of the following is unresolved:

- candle or trade sequence gap,
- duplicate or regressing event,
- stale market data,
- invalid timestamp or unsafe clock offset,
- malformed price, quantity, or symbol metadata,
- snapshot recovery that would regress applied state.

Required evidence:

- gap detection test,
- duplicate suppression test,
- reconnect and snapshot recovery test,
- stale-data block test,
- clock-drift block test.

### 2. Durable execution gate

Execution must implement an explicit state machine:

```text
INTENT_CREATED
  -> RISK_APPROVED | RISK_REJECTED
  -> QUEUED
  -> SUBMITTING
  -> ACCEPTED | REJECTED | SUBMISSION_UNKNOWN
  -> PARTIALLY_FILLED
  -> FILLED | CANCELED | EXPIRED
  -> RECONCILED | RECONCILIATION_BLOCKED
```

Rules:

- no implicit retry after `SUBMISSION_UNKNOWN`,
- no duplicate submission for the same idempotency key,
- partial fills update exposure and fees incrementally,
- cancellation is not final until provider state is reconciled,
- process restart resumes from durable state rather than reconstructed assumptions.

### 3. Accounting and reconciliation gate

Compare local state with provider evidence for:

- balances,
- open orders,
- fills,
- positions or asset inventory,
- trade fees,
- realized and unrealized PnL where applicable.

Any material mismatch must:

1. create append-only evidence,
2. block new exposure for the affected account or symbol,
3. require a later verified match before release,
4. preserve the original ledger history.

### 4. Capital survival gate

Mandatory limits:

- maximum order notional,
- maximum symbol exposure,
- maximum correlated-bucket exposure,
- maximum total invested capital,
- maximum concurrent positions,
- daily realized-loss limit,
- rolling weekly loss limit,
- drawdown limit,
- stale-evidence and system-health blocks.

Initial live-candidate allocation must be a fixed owner-approved amount. Automatic capital scaling is prohibited in the first live stage.

### 5. Kill-switch gate

Automatic halt triggers:

- critical persistence failure,
- unresolved reconciliation mismatch,
- repeated provider or authentication errors,
- unsafe clock synchronization,
- market-data gap not recovered within policy,
- abnormal latency or slippage,
- daily or weekly loss-limit breach,
- invariant failure or unknown critical health state.

Kill-switch behavior:

- atomically disable new intents and submissions,
- persist reason, scope, evidence references, and actor,
- leave existing-position handling to a separately configured policy,
- require explicit recovery verification before re-enable.

### 6. Recovery gate

Crash and restart drills must cover:

- before intent persistence,
- after intent persistence but before queueing,
- during submission,
- after provider acceptance but before local acknowledgement,
- during partial fill,
- after fill but before ledger projection,
- during kill-switch activation,
- during reconciliation.

Every drill must prove deterministic replay, no duplicate economic mutation, and a fail-closed startup decision.

### 7. Strategy promotion gate

```text
DRAFT
  -> BACKTESTED
  -> WALK_FORWARD_PASS
  -> PAPER_CANDIDATE
  -> PAPER_VALIDATED
  -> SHADOW_VALIDATED
  -> SMALL_LIVE_CANDIDATE
  -> SMALL_LIVE_ACTIVE
  -> PAUSED | RETIRED
```

Promotion requires immutable strategy version, dataset identity, parameters, cost assumptions, regime coverage, and evidence references.

Minimum validation dimensions:

- out-of-sample performance,
- fees and slippage,
- parameter stability,
- regime sensitivity,
- turnover and liquidity,
- maximum drawdown,
- minimum trade count,
- paper-to-backtest degradation,
- shadow-to-paper divergence.

No single metric authorizes promotion.

### 8. Reality-check and decay gate

Continuously compare Backtest, Walk-Forward, Paper, Shadow, and Live results using:

- signal agreement,
- fill ratio,
- slippage,
- turnover,
- expectancy,
- profit factor,
- drawdown,
- exposure,
- regime distribution.

Pause or reduce eligibility when degradation exceeds policy. Do not automatically increase allocation when performance improves.

## Important corrections to prior design ideas

### Do not add redundant execution workers yet

Multiple workers can increase duplicate-submission risk. The first implementation should use one logical execution owner with durable leasing, fencing tokens, and idempotency. Redundancy comes only after failover correctness is proven.

### Do not use strategy voting as a default

Voting among correlated indicators can create false confidence without independent edge. Ensemble use requires independent validation, explicit conflict policy, and portfolio-level risk evaluation.

### Do not map a vague confidence score directly to position size

A percentage confidence number is not meaningful unless calibrated out of sample. Position size must derive from deterministic risk budgets, volatility, liquidity, and exposure constraints.

### Do not implement automatic black-swan liquidation as a universal rule

Blind market liquidation during disorder can amplify slippage. The policy must distinguish: stop new exposure, cancel resting orders, reduce exposure, or close positions. Each action requires tested market and provider assumptions.

### Keep AI read-only

AI output is explanatory and advisory only. Deterministic code owns risk, execution, accounting, reconciliation, and state transitions.

## 30-day implementation sequence

### Days 1–7: truth and failure boundaries

- freeze architecture contracts,
- inventory current runtime state machines and persistence paths,
- close missing data-quality gates,
- define durable execution state transitions,
- add crash-point and restart tests,
- verify automatic trading defaults to OFF.

Exit criteria: no known path can submit twice or continue new exposure under unknown critical state.

### Days 8–14: risk, reconciliation, and kill switch

- complete account and order reconciliation,
- implement exposure buckets and loss limits,
- make kill-switch activation transactional and auditable,
- test stale, missing, mismatch, and provider-unavailable cases,
- add startup gating from persisted evidence.

Exit criteria: every uncertainty produces a deterministic block or explicit degraded state.

### Days 15–21: strategy evidence

- lock one strategy version and one market universe,
- run exact-target backtest and Walk-Forward,
- include fees, slippage, latency, and missing-data behavior,
- establish paper baseline and shadow comparison,
- reject or pause the strategy if evidence is insufficient.

Exit criteria: a strategy is either quantitatively eligible for continued Paper validation or explicitly rejected. No forced promotion.

### Days 22–30: operational evidence

- collect real Paper sessions and completed-order evidence,
- perform reconnect, duplicate, persistence, kill-switch, and recovery drills,
- export and independently verify the evidence bundle,
- produce owner review packet,
- keep live mutation disabled unless all gates pass.

Exit criteria: `SMALL_LIVE_CANDIDATE` or `BLOCKED` with exact reasons. Both are valid outcomes.

## Small-capital live-candidate rules

When eventually approved:

- owner-defined fixed capital only,
- one exchange and spot market only,
- one validated strategy version,
- no leverage, borrowing, withdrawals, or automatic capital increase,
- conservative maximum exposure and loss limits,
- Paper shadow run remains active,
- daily human review,
- immediate fallback to no-new-exposure on any uncertainty.

## Definition of done

This plan is not complete because code exists or tests are green. It is complete only when:

- every P0 gate has implementation and tests,
- real Paper operational evidence meets the declared thresholds,
- exact-target reports and evidence bundle are independently verifiable,
- no unresolved critical or unknown state remains,
- owner explicitly approves the reviewed commit and fixed capital amount,
- live mutation remains technically impossible before that approval.
