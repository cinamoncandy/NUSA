# NUSA read-only MCP gateway

This service is an authenticated adapter over existing NUSA HTTP relays. It does not create a second NUSA backend or persist trading state.

## Current tool inventory

The gateway exposes only projections backed by endpoints that exist in the repository:

- `nusa_health`
- `get_paper_state`
- `get_paper_portfolio`
- `get_paper_order_history`
- `get_market_ticker` (from the existing NUSA PAPER operations market projection)
- `get_ai_signal`
- `get_upbit_readonly_summary`
- `get_upbit_open_orders`
- `get_upbit_order_history`
- `get_upbit_order_detail`

`get_market_candles` is intentionally absent: no existing candle endpoint was found during inventory. It must not be fabricated by the gateway.

## Security boundary

- MCP clients authenticate with a dedicated `NUSA_MCP_READONLY_TOKEN`.
- Relay tokens are server-side only and are never returned, logged, or sent to clients.
- The gateway binds to loopback. A server-side stable HTTPS reverse proxy is required for remote ChatGPT access; this repository does not claim that deployment exists.
- Only GET-backed allowlisted relay paths are used. POST/PUT/PATCH/DELETE and unknown paths are rejected before upstream access.
- PAPER remains `liveAuthority=NONE` and `productionMutationAllowed=false`; AI remains ZERO_AUTHORITY/read-only.

## Local run

Inject the environment from a protected service manager. Do not commit a populated `.env` file.

```bash
node server.js
```

The MCP endpoint is `/mcp`; the health endpoint is `/health`. The current repository has no stable deployed hostname or ChatGPT connection evidence, so deployment and connection remain pending until externally verified.
