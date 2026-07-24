# Mobile Dashboard HTTP v1

This slice exposes the read-only mobile dashboard through a framework-neutral HTTP handler and maps validated payloads into a fail-closed mobile screen state.

## Security boundary

- `GET` only
- Bearer authentication required
- `dashboard:read` scope required
- `Cache-Control: no-store`
- authentication verifier failures return `401`
- dashboard assembly failures return `503`
- no exchange credentials, private API calls, order submission, or withdrawal behavior

## Mobile states

- `LOADING`: no trusted snapshot yet
- `READY`: PAPER mode and healthy data
- `CAUTION`: degraded or stale intelligence; trading disabled
- `BLOCKED`: stopped, faulted, down, or kill switch active
- `ERROR`: invalid, stale, future-dated, or incompatible response

The mobile state never enables trading merely because a server payload says it is allowed. The payload must also pass the version, freshness, capital reconciliation, health, and kill-switch checks in `mobileDashboardSync`.
