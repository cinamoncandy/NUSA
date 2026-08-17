# ADR-0014: Read-only MCP gateway over existing NUSA relays

## Status

Accepted for implementation on the MCP adapter branch. Deployment and external ChatGPT connection remain separate acceptance gates.

## Context

The repository contains authenticated read-only NUSA Cloud projections at `/api/dashboard` and `/api/paper-operations`, plus a separate loopback-only `services/upbit-readonly` relay for account summary, open orders, order history, and order detail. No repository-controlled candle endpoint or stable deployed cloud origin was found during inventory.

## Decision

1. Add a small MCP gateway adapter under `services/nusa-mcp`; it must call the existing HTTP relays and must not reimplement NUSA domain state or create a second backend.
2. Use authenticated MCP Streamable HTTP JSON-RPC with a dedicated server-side `NUSA_MCP_READONLY_TOKEN`. Upstream relay credentials remain server-side and are never returned to MCP clients.
3. Expose only normalized tools backed by existing endpoints: health, PAPER state, PAPER portfolio, PAPER order history, market ticker projection, AI signal projection, Upbit read-only summary, open orders, order history, and order detail.
4. Do not expose `get_market_candles` because no existing candle endpoint is present. Do not expose PAPER order submission, operator user management, settings mutation, or any Upbit mutation path.
5. Enforce GET-only upstream method/path allowlists in the gateway, sanitize upstream errors, bound inputs/outputs/timeouts, rate-limit calls, and record hashed caller audit metadata without credentials or raw payloads.
6. Bind the gateway to loopback. Production external access requires the already approved server-side HTTPS ingress/deployment path; a user PC, Quick Tunnel, temporary hostname, or anonymous public endpoint is not part of this decision.

## Safety invariants

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI remains ZERO_AUTHORITY/read-only.
- No order create, cancel, withdrawal, transfer, broker mutation, or AI-triggered financial mutation is reachable through MCP.
- Upbit credentials and bearer tokens remain server-side environment material.

## Consequences

The initial MCP implementation can be repository-tested without claiming that ChatGPT connectivity or Oracle deployment exists. Missing upstream capabilities remain absent from the tool list until a real existing endpoint is added and independently verified.
