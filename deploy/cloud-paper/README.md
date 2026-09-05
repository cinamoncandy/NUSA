# NUSA Cloud PAPER production runtime

This deployment layer runs the existing `apps/cloud/src/runtime.ts` composition root continuously on a Linux Cloud/Server host. It does **not** add a second PAPER engine and does not grant LIVE authority.

## Safety contract

- `NUSA_MODE=PAPER`
- `NUSA_LIVE_MUTATION=PROHIBITED`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI remains `ZERO_AUTHORITY`
- Upbit access is PUBLIC market-data only; do not provision private exchange credentials.
- The Node HTTP server remains bound to `127.0.0.1`; expose it only through an HTTPS reverse proxy.

## Host layout

- repository/build: `<repo-root>/nusa`
- protected runtime env: `/etc/nusa/cloud-paper.env` (`0600`)
- durable SQLite state: `/var/lib/nusa/state.sqlite`
- durable supervisor state: `/var/lib/nusa/supervisor.json`
- systemd unit: `/etc/systemd/system/nusa-cloud-paper.service`
- TLS proxy: Caddy using `deploy/cloud-paper/Caddyfile`

## Install / update from an exact protected-main SHA

1. Check out the exact protected-main SHA into `<repo-root>/nusa` and run `corepack enable`, `corepack prepare pnpm@11.7.0 --activate`, `pnpm install --frozen-lockfile`, then `pnpm run build`.
2. Create a dedicated unprivileged `nusa` user/group.
3. Copy `cloud-paper.env.example` to `/etc/nusa/cloud-paper.env`, replace all `CHANGE_ME` values, set `NUSA_SOURCE_COMMIT` to the exact deployed 40-hex protected-main SHA, and `chmod 0600` the file.
4. Install `nusa-cloud-paper.service`, then run `systemctl daemon-reload && systemctl enable --now nusa-cloud-paper`.
5. Install Caddy on the same host, set `NUSA_PUBLIC_DOMAIN` to the HTTPS hostname, and use the supplied Caddyfile. The reverse proxy reaches only the runtime loopback listener.
6. Verify `systemctl is-active nusa-cloud-paper`, then call `/health`, authenticated `/ready`, and authenticated `/api/paper-operations` through the HTTPS origin.

The service invokes `scripts/start-cloud-paper-supervisor.js`. The supervisor refuses non-PAPER mode, refuses LIVE mutation authority, refuses in-memory state, strips any private exchange credentials from the child environment, persists restart state, and automatically restarts the existing Cloud runtime after a crash with bounded exponential backoff. Its restart telemetry is already projected through `operations.supervisor` to the mobile control plane.

## Production evidence

Run the read-only verifier from a separate machine/process:

```bash
NUSA_PRODUCTION_BASE_URL=https://paper.example.com \
NUSA_CLOUD_DASHBOARD_TOKEN='...' \
NUSA_SOURCE_COMMIT='<exact-protected-main-sha>' \
NUSA_PRODUCTION_PROOF_DURATION_MS=3600000 \
node scripts/verify-cloud-paper-production.js
```

The verifier never calls `/api/paper-orders`. It checks HTTPS health/readiness, runtime/scheduler/transport state, fresh heartbeat and market progress, autonomous PAPER order/fill counters, fee evidence, durable supervisor restart evidence, projected order/fill ID uniqueness, and the immutable LIVE/AI authority boundaries. It writes `artifacts/operational-evidence/cloud-paper-production-proof.json` by default and fails closed when required evidence is absent.

A short verifier PASS is **not** equivalent to the final 24-hour completion claim. The final claim requires elapsed production evidence for the required operating window plus the repository's restart/replay/reconciliation/risk-failure evidence, with LIVE mutation remaining zero.
