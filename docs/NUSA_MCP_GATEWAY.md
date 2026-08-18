# NUSA read-only MCP gateway

## Status

Repository implementation is present. Oracle deployment, stable HTTPS ingress, and a real ChatGPT connection are not proven by this repository and remain pending external operator evidence.

## Reused API inventory

The gateway calls existing read-only relays only:

| MCP tool | Existing route | Provenance |
| --- | --- | --- |
| `nusa_health` | NUSA Cloud `GET /health` | `NUSA_CLOUD` |
| `get_paper_state` | NUSA Cloud `GET /api/paper-operations` | `PAPER` |
| `get_paper_portfolio` | NUSA Cloud `GET /api/paper-operations` | `PAPER` |
| `get_paper_order_history` | NUSA Cloud `GET /api/paper-operations` | `PAPER` |
| `get_market_ticker` | NUSA Cloud `GET /api/paper-operations` market projection | `UPBIT_PUBLIC` |
| `get_ai_signal` | NUSA Cloud `GET /api/paper-operations` AI projection | `PAPER` |
| `get_upbit_readonly_summary` | Upbit relay `GET /api/v1/account/summary` | `UPBIT_READ_ONLY` |
| `get_upbit_open_orders` | Upbit relay `GET /api/v1/orders/open` | `UPBIT_READ_ONLY` |
| `get_upbit_order_history` | Upbit relay `GET /api/v1/orders/history` | `UPBIT_READ_ONLY` |
| `get_upbit_order_detail` | Upbit relay `GET /api/v1/orders/:uuid` | `UPBIT_READ_ONLY` |

No existing candle endpoint was found, so `get_market_candles` is intentionally not exposed. The gateway does not invent a candle source or add a new market API.

## Configuration

Inject `services/nusa-mcp/.env.example` values through a protected Oracle/systemd environment file such as `/etc/nusa/mcp-gateway.env`. The MCP client receives only the dedicated `NUSA_MCP_READONLY_TOKEN`; NUSA relay tokens, Upbit credentials, Oracle credentials, and ingress credentials remain server-side.

The service binds to `127.0.0.1`. The existing Oracle deployment path may run `deploy/oracle/nusa-mcp.service` alongside the NUSA runtime. A separately managed reverse proxy or persistent approved ingress must expose `/mcp` at a stable HTTPS hostname. User-PC servers, localhost client configuration, Quick Tunnels, temporary `trycloudflare.com` URLs, and HTTP public exposure are prohibited.

## MCP connection

Once an operator has deployed and verified a stable HTTPS origin, configure ChatGPT with that origin's `/mcp` endpoint and the scoped read-only token through the connector's secret handling. Do not paste the token into repository files, issue comments, logs, tool responses, or URLs.

Before claiming connection success, call `nusa_health`, `get_paper_state`, `get_market_ticker`, and `get_upbit_readonly_summary` from the actual ChatGPT connection and preserve redacted evidence. Without those calls, report `MCP IMPLEMENTATION PASS / CHATGPT CONNECTION PENDING`.

## Safety

The gateway is read-only and GET-backed. It rejects unknown routes and all non-GET upstream access. It exposes no PAPER order submission, operator user-management mutation, LIVE order, cancellation, withdrawal, transfer, broker mutation, or AI execution capability. `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI `ZERO_AUTHORITY` remain required invariants.
