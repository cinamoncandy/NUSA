# Independent Paper Risk Gateway and Deployment Safety Gate (WO-0032)

## Purpose

Two pure decision functions that stand between a Paper trading intent and its execution:

- `evaluatePreTradeRisk` — may this one order proceed, right now, under these conditions?
- `evaluateDeploymentSafety` — may this build run Paper automation at all?

Both are read-only. They never mutate the request, the account, or any execution state,
never place an order, and never grant authority: `productionMutationAllowed` is `false` on
every decision either of them can produce. Neither is Live Trading capability, and neither
creates one.

## Two properties that carry the whole design

### 1. Every declared reason code is enforced

The contract in `packages/contracts/src/riskGateway.ts` declares 40 pre-trade reason codes
and 10 deployment reason codes. **Every one of them is reachable.**

This was the main defect corrected while completing WO-0032. The first implementation
declared 41 pre-trade codes but could only ever emit 28: order rate limits, same-side burst,
daily buy/sell notional caps, symbol and portfolio exposure caps, daily loss, consecutive
loss, session drawdown, and price deviation were all declared and never checked, and
`DEPLOYMENT_INTEGRITY_FAILED` had no input that could set it. A gateway that advertises a
limit it never enforces reads as coverage that does not exist — which is worse than not
declaring the limit, because a reviewer sees the code name and assumes the check.

`tests/independent-risk-gateway-coverage.test.js` holds this in place two ways: it parses
the contract's own type union and asserts it equals the evaluator's `RISK_REASON_ORDER`,
and it crafts one request per code and asserts each code is actually produced. Adding a
code to the contract without wiring it fails the suite.

### 2. Fail closed

Missing, malformed, or non-finite state is `INVALID_REQUEST` and **halts**. It is not a
skipped check. A check that cannot read its input is indistinguishable from a check that
passed, so the gateway refuses rather than proceeding on partial state — including when the
caller omits an entire state block such as `sessionState` or `deploymentState`, and
including a `null` request, which returns a decision rather than throwing.

## Severity: HALT vs REJECT

`RISK_REASON_ORDER` is both the report order and the severity order. Every code at or before
`OPEN_P0_ALERT` produces `HALT`; everything after produces `REJECT`.

The distinction is deliberate. `REJECT` means *this order* was not acceptable — too large,
duplicate, out of cash. `HALT` means the *operating envelope itself* is broken: a live
trading capability was detected, the deployment does not match what was reviewed, the kill
switch is on, approval is missing or expired, persistence or reconciliation is unhealthy, or
a P0 alert is open. Those are not conditions a smaller order would fix.

Halting codes, in order: `INVALID_REQUEST`, `LIVE_CAPABILITY_DETECTED`,
`PRIVATE_API_CAPABILITY_DETECTED`, `DEPLOYMENT_INTEGRITY_FAILED`, `KILL_SWITCH_ACTIVE`, the
four fingerprint mismatches, the three approval codes, `PERSISTENCE_UNHEALTHY`,
`RECONCILIATION_FAILED`, `OPEN_P0_ALERT`.

## What is checked

| Group | Codes |
| --- | --- |
| Safety envelope | live capability, private-API capability, deployment integrity, kill switch |
| Identity | strategy, config, runtime, and risk-policy fingerprint mismatches |
| Authorization | approval missing, expired, out of symbol scope |
| Infrastructure | persistence unhealthy, reconciliation failed, open P0 alert |
| Market data | stale, reconnecting, warming up, gap, out of order, invalid, price deviation |
| Idempotency | duplicate signal, command, client order id |
| Rate | orders per second, orders per minute, same-side streak, open order count |
| Size and exposure | order notional, position notional, symbol exposure, portfolio exposure, daily buy notional, daily sell notional |
| Sufficiency | insufficient cash, insufficient position |
| Circuit breakers | daily loss, consecutive losses, session drawdown |

Fingerprint checks exist because an order produced by a build that changed underneath the
gateway is not an order the gateway was configured to guard. Price deviation exists because
a feed can report itself `HEALTHY` while the caller prices off something stale.

## Deployment safety gate

Evaluated before Paper automation is allowed to start. Every reason code halts — there is no
degraded-but-allowed deployment.

`LIVE_TRADING_CAPABILITY_PRESENT`, `PRIVATE_API_CAPABILITY_PRESENT`,
`CREDENTIAL_STORAGE_PRESENT`, `RISK_GATEWAY_ABSENT`, `KILL_SWITCH_UNREACHABLE`,
`AUTO_TRADE_DEFAULT_ON`, `ARTIFACT_HASH_MISMATCH`, `SOURCE_COMMIT_MISMATCH`,
`PERSISTENCE_SCHEMA_MISMATCH`, `INVALID_DESCRIPTOR`.

`AUTO_TRADE_DEFAULT_ON` is treated as a deployment defect rather than a preference: after an
install or an upgrade, nobody chose it for that deployment.

## Independent verification

`scripts/lib/paper-risk-gateway-verifier.js` deliberately does **not** import the evaluator
or its compiled output. It re-implements the rules from the contract and compares status,
reason codes, canonical ordering, and both hashes. A verifier that asked the evaluator for
the answer would confirm a buggy evaluator rather than catch it — the same principle applied
in WO-0029's regime verifier and WO-0031's promotion gate.

If the two ever disagree, that disagreement is the finding; neither side is authoritative
alone. The verifier additionally enforces one rule unconditionally: **any finding at all
forbids `ALLOW`.**

## Determinism

Both functions are pure. Identical inputs produce identical decisions and identical hashes;
there is no wall-clock read anywhere — `evaluatedAt` is copied from the request. Decisions
are frozen, as are their reason-code arrays.

## What is NOT done, and why

**The gateway is not wired into the running order path.** This is a deliberate stop, not an
oversight.

The gateway requires `approvalState`, `reconciliationState`, `deploymentState`, and four
fingerprints. None of that state exists anywhere in `apps/desktop/src` today (verified by
search: the only files mentioning them are the gateway and its contract). Wiring the gateway
in now would mean synthesizing `approved: true`, `healthy: true`, and
`integrityVerified: true` at the call site — turning the gate into a component that always
returns `ALLOW` while appearing in the architecture diagram as a control. That is worse than
an unwired gate, because it would also let WO-0031's D-010 dimension claim
`independentRiskGatewayPresent: true` when no gateway is in fact guarding anything.

Integration therefore requires, as separate work: a real approval store with expiry and
symbol scope, a reconciliation health source, a deployment-integrity descriptor produced at
build time, and fingerprint derivation for strategy, config, runtime, and risk policy. Until
those exist, D-010 stays `INCONCLUSIVE`.

## Known limitations

- Rate, exposure, and session state are **supplied by the caller and trusted**. The gateway
  verifies internal consistency and finiteness, not that the caller counted correctly.
- Limits are configuration. This module enforces them; it does not decide whether they are
  the right numbers.
- Deployment integrity is asserted by a descriptor, not measured by this module. Producing
  a trustworthy descriptor (real artifact hashing at build time) is separate work.
- Paper fills differ from real exchange fills; nothing here is Live Trading evidence.
- The production strategy, symbol, fee/PnL formulas, and existing risk limits are unchanged.
  This work only adds checks — it relaxes none.
