# HTTP Input Boundary Hardening

## Finding

The Cloud dashboard server accumulated request-body chunks after the 10,000-character check rejected an oversized request. That made the nominal body limit a memory-retention limit rather than a bounded read, and the failure was reported as a generic service-unavailable response.

## Change

- Bound request bodies at 10,000 UTF-8 bytes, including a fast path for an oversized `Content-Length`.
- Drain rejected request streams without retaining additional chunks.
- Return `413 REQUEST_BODY_TOO_LARGE` for the bounded client error.
- Preserve the existing endpoint authentication, PAPER approval, idempotency, and authority checks.

## Evidence

- `tests/cloud-dashboard-server.test.js`: oversized ASCII and multibyte UTF-8 bodies both receive 413.
- Focused Cloud/PAPER HTTP suite: 21/21 PASS.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm build`: PASS.
- Architecture, security, AIPOS, PAPER runtime, and diff-check gates: PASS.

## Safety

This is a request-resource boundary only. It creates no broker, LIVE, credential, risk, kill-switch, or AI authority. PAPER remains fail-closed and `liveAuthority=NONE`, `productionMutationAllowed=false`, and `AI ZERO_AUTHORITY` remain unchanged. Physical Android acceptance remains HUMAN_ENVIRONMENT_ONLY_PENDING.
