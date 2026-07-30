# NUSA local monitor prototype

This is a read-only mobile monitor prototype. It consumes only the fixed GET
endpoints exposed by the desktop localhost bridge:

- `GET /health`
- `GET /api/status`
- `GET /api/account`
- `GET /api/market`
- `GET /api/events`

Set `EXPO_PUBLIC_NUSA_MONITOR_URL` to the monitor URL. The desktop bridge is
disabled by default and binds to `127.0.0.1` only when explicitly enabled with
`NUSA_MOBILE_MONITOR_ENABLED=true` and a valid `NUSA_MOBILE_MONITOR_PORT`.

No mobile control, order, credential, kill-switch, or settings mutation exists.
LAN exposure is intentionally outside this phase.
