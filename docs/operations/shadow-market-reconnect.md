# Shadow Public-Market Reconnect Procedure

Shadow uses public Upbit market data only. It has no private API, credential, broker, order,
fill, cash, or position mutation capability.

## States

`CONNECTED` accepts public data. `STALE`, `DISCONNECTED`, and `RECONNECTING` pause an active
Shadow session without creating a new session identifier. `RECOVERED` is emitted after a new
public socket opens. `FAILED` is terminal and ends the active session with
`MARKET_RECONNECT_TIMEOUT`.

## Retry policy

The public socket retries at 1s, 2s, 4s, 8s, 16s, then 30s, capped at eight attempts. Only one
reconnect timer, socket listener set, and subscription are allowed at once. A stale socket is
closed so it enters this same bounded path; it is never treated as healthy merely because the
process remains alive.

## Operator validation

1. Run `pnpm run desktop` from the repository root.
2. Open the read-only A4 diagnostics panel and inspect **Public market reconnect**.
3. Confirm the state, last market message, retry attempt, listener/subscription/timer counts,
   and failure reason without invoking a start, reset, or trading action.
4. During an intentional public-feed interruption, confirm `RECONNECTING`, then `RECOVERED`
   and `CONNECTED`; the Shadow session identifier must remain unchanged.
5. Confirm an exhausted retry budget reports `MARKET_RECONNECT_TIMEOUT` and leaves all mutation
   counters at zero.

Connection transitions are appended as `MARKET_CONNECTION` events in the existing hash-chained
Shadow Evidence archive. They record disconnect/recovery timestamps, retry count, downtime, and
the final reconnect state without modifying prior Evidence.
