# A5F Live Operations Layer

## Scope

The live operations layer provides a safe operations surface for session
lifecycle, startup checks, health-oriented alerts, audit events, trade history,
Evidence export, and daily reporting. It is deliberately separate from the
execution mutation path.

## Session lifecycle

An operator supplies the daily startup check before starting a session. The
check covers API connectivity, balance and open-order review, Shadow comparison,
reconciliation, risk, and Kill Switch state. Any failed check blocks the session
and records the decision in the append-only audit and Evidence stores.

Stopping a session records the stop sequence, open-order status, a daily report,
and a final Evidence record. Open orders raise a `RESTART_REQUIRED` alert; they
are never silently treated as closed.

## Audit, alerts, and Evidence

Audit events and alerts are append-only. Alerts can be acknowledged, but are
never deleted. Evidence can be exported as JSON or CSV without changing the
stored records. Trade records are scoped to the active session and included in
the daily report.

## Safety boundary

`productionMutationAllowed` remains `false`. This layer does not submit live
orders, expose credentials, or enable private exchange mutation. A blocked
startup check remains fail-closed and requires an operator-visible reason.

## Limitations

This is the operations foundation for later live-operation work. It does not
enable live trading, perform exchange mutations, or replace the existing Risk,
Recovery, Reconciliation, or Evidence integrity gates.
