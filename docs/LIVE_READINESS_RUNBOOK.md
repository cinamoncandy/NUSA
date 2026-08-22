# NUSA LIVE readiness runbook

This runbook describes preparation only. LIVE must remain dormant until a future explicit owner decision.

## Default invariant

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- no automatic transition from PAPER or SHADOW
- no withdrawal or transfer support
- exchange credentials remain server-side only

## Readiness sequence

1. Complete and stabilize PAPER auto-learning evidence.
2. Produce deterministic/replayable SHADOW evidence from the same governed decision path intended for LIVE.
3. Verify REAL_READ_ONLY account monitoring is healthy and account identity is known.
4. Verify strategy governance, TradePermission gates, RiskAuthority and bounded risk configuration.
5. Verify reconciliation, idempotency/no-double-order, kill-switch and exchange fault tests.
6. Require all protected exact-head workflows to be green.
7. Evaluate `LiveReadinessGate`. Only `READY_FOR_MANUAL_ENABLE` may expose a future activation control.

## Future manual activation ceremony

Activation is intentionally not implemented as an automatic action in PAPER, AI, mobile startup, or deployment. A future explicit owner activation must create a short-lived capability lease containing:

- human OWNER principal identity
- fresh explicit confirmation
- exact environment fingerprint
- exact real-account fingerprint
- issue time and expiry
- bounded risk profile and market allowlist

The lease must be rejected if expired or if the environment/account fingerprint changes. A restart must default back to dormant unless a separately approved persisted policy explicitly authorizes restoration.

## Canary rollout profile

Exact monetary values are configuration, not repository constants. The first LIVE profile should be conservative:

- one allowlisted market
- one concurrent position
- small per-order notional cap
- conservative daily-loss and total-exposure limits
- low order-frequency cap
- strict slippage limit
- immediate halt on stale data, reconciliation mismatch, exchange error, abnormal balance drift or risk-budget breach

## Emergency disable

Any hard safety event must make the readiness state `HALTED` and stop new mutation authority. Emergency disable order:

1. Activate the independent kill switch.
2. Revoke/expire the activation lease.
3. Set `productionMutationAllowed=false` and `liveAuthority=NONE`.
4. Disable the LIVE order-mutation environment gate.
5. Reconcile account/open-order/fill state through read-only APIs.
6. Preserve the audit ledger and input/evidence hashes for post-mortem.
7. Do not re-enable automatically. Require a fresh manual activation after the root cause is resolved and all readiness gates pass again.

## Rollback

Application rollback must use the last known-good deployment bundle. Secret rotation is required if credential exposure is suspected. Withdrawal/transfer permissions must never be added as part of recovery.
