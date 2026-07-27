# Shadow Owner Lifecycle

The control origin is `LOCAL_INTERACTIVE_UI`; the current application has no cryptographically authenticated owner identity, so `authenticatedOwner` is false. IPC accepts only exact payloads:

- `shadow:start`: `symbol`, `strategyId`, `strategyVersion`
- `shadow:pause`, `shadow:resume`, `shadow:stop`: `sessionId`
- `shadow:status`: `{}`

Extra fields, nulls, arrays, arbitrary source settings, and unknown channels fail closed.

Start requires healthy market data, 20 valid closed candles, matching strategy identity, and no active shadow session. Pause and stop require the session ID. Resume requires a paused session, healthy market data, a new warm-up after reconnect, and explicit owner action. There is no automatic resume.

Disconnect or restart invalidates the open candle and clears warm-up. Restart clears the previous session identity and never restores a running session. A healthy websocket connection alone does not resume execution.

Shadow status always reports `automaticResumeAllowed: false` and `productionMutationAllowed: false`. Canary, Extended Paper, private API, credentials, and durable Evidence storage are out of scope for A2R.
