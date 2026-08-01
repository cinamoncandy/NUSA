# A5C Safe Desktop and Local Mobile Monitor Integration

## ZIP assessment

The supplied ZIP was used only as a comparison source. Its full `index.html` and
`main.ts` were not copied because the input included wildcard CORS, control POST
routes, hard-coded localhost assumptions, and UI paths that could bypass the
existing A4P safety boundary.

## Closed-candle and reconnect boundary

The existing `ClosedCandleAdapter` remains the source of truth. Raw WebSocket
ticker volume is mapped only from Upbit's per-ticker `acc_trade_volume`; the
24-hour quote turnover field is never used as candle volume. Missing volume marks
the candle as unavailable rather than estimating it. Tickers are forwarded to
the existing Shadow runtime, which still admits only closed candles.

On disconnect, the existing reconnect supervisor and Shadow runtime discard the
open candle, reset warm-up, stop signal admission, and require recovery before
normal processing. No order or mutation path was added.

## Local mobile bridge

The desktop bridge is disabled by default. It starts only when both environment
values are explicit:

```text
NUSA_MOBILE_MONITOR_ENABLED=true
NUSA_MOBILE_MONITOR_PORT=41731
```

It binds to `127.0.0.1` only. It exposes GET-only, no-store JSON endpoints:

- `/health`
- `/api/status`
- `/api/account`
- `/api/market`
- `/api/events`

All POST, PUT, PATCH, DELETE, control, credential, order, and settings routes
are rejected. There is no wildcard CORS header and no LAN binding. The bridge
stops during the existing desktop resource-release path.

The mobile prototype reads `EXPO_PUBLIC_NUSA_MONITOR_URL` and renders status,
warm-up, account summary, open-order count, and observed time. It has no control
buttons or mutation API.

## Verification and limitations

Automated bridge, candle, reconnect, UI, package, release, typecheck, build, and
full test checks pass. No real mobile device or LAN session was used. LAN access,
remote authentication, and mobile store packaging remain outside this phase.

Rollback is a single commit revert; the bridge is independently removable because
it is disabled unless explicitly configured.
