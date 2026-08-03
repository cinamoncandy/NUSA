# NUSA local monitor prototype

This is a read-only mobile monitor prototype. It consumes only the fixed GET
endpoints exposed by the desktop localhost bridge:

- `GET /health`
- `GET /api/status`
- `GET /api/account`
- `GET /api/market`
- `GET /api/markets`
- `GET /api/candles?market=KRW-BTC&interval=1m&count=120`
- `GET /api/events`

Set `EXPO_PUBLIC_NUSA_MONITOR_URL` to the monitor URL. The desktop bridge is
disabled by default and binds to `127.0.0.1` only when explicitly enabled with
`NUSA_MOBILE_MONITOR_ENABLED=true` and a valid `NUSA_MOBILE_MONITOR_PORT`.

No mobile control, order, credential, kill-switch, or settings mutation exists.
LAN exposure is intentionally outside this phase.

The candle endpoint returns only validated Upbit public closed-candle DTOs. The
mobile chart may aggregate those 1-minute candles into supported display
intervals, but it never fabricates missing prices or volume.

The markets endpoint returns only validated Upbit public ticker DTOs. The
watchlist stores market identifiers locally through AsyncStorage; it never
stores credentials or creates trading mutations.

The order history screen reads the validated Paper order snapshot included in
`GET /api/account`. The desktop Paper broker persists that snapshot; the mobile
screen remains read-only and does not create, cancel, or replace orders.
