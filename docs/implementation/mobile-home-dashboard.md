# Mobile Home Dashboard

The mobile home dashboard is a pure TypeScript projection for a future React Native client. It does not place orders, read exchange credentials, access a database, or perform network requests.

## Capital boundaries

The dashboard reconciles every capital bucket to total assets and separates funds into three groups:

- deployable capital: spot, futures, and cash
- protected capital: withdrawal reservations and reserve vaults
- pending capital: deposits or transfers that are not yet available

Withdrawal and reserve balances are never counted as deployable capital. Duplicate buckets, negative values, non-finite values, and reconciliation mismatches fail closed.

## Trading status

Paper mode may be displayed as trade-capable. Live mode is displayed as trade-capable only when AI health is `HEALTHY` and risk is not `CRITICAL`. `STOPPED` and `FAULTED` are always blocked.

This is display-state logic only. Runtime risk gates and execution authorization remain authoritative and must independently fail closed.

## Intelligence freshness

The embedded intelligence dashboard must not have a generation time later than the home snapshot. Market scenarios remain probabilistic planning inputs and are not predictions or profitability guarantees.
