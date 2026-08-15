# NUSA trusted HTTPS bridge for Android PAPER

Status: operator runbook for Issue #391. This does **not** add LIVE authority and does not weaken the NUSA loopback binding.

## Security invariants

- NUSA Cloud stays bound to `127.0.0.1` or `localhost` only.
- Android remote endpoints remain HTTPS-only. Do not add a cleartext exception or set `usesCleartextTraffic=true` for any build variant.
- `NUSA_CLOUD_DASHBOARD_TOKEN` is an application bearer secret. Never put it in the public hostname, URL query string, tunnel config, source tree, shell history, screenshots, or logs.
- Tunnel credential JSON is Cloudflare infrastructure state, not a NUSA broker credential. Keep it outside the repository with OS-user-only permissions.
- PAPER only: `liveAuthority=NONE`, `productionMutationAllowed=false`. AI remains ZERO_AUTHORITY/read-only.

## Canonical topology

Android NUSA app
  -> `https://paper.<your-domain>` (publicly trusted TLS at Cloudflare edge)
  -> Cloudflare Tunnel
  -> local `cloudflared`
  -> `http://127.0.0.1:<NUSA_CLOUD_DASHBOARD_PORT>`
  -> NUSA Cloud PAPER runtime

The NUSA runtime is never bound to `0.0.0.0` and does not need an inbound router/firewall port.

## Why a locally managed named tunnel

Cloudflare currently recommends remotely managed tunnels for most use cases. NUSA intentionally documents a locally managed named tunnel here because the origin mapping can be represented and regression-tested as repository-controlled configuration while the generated tunnel credential remains outside the repository. Either way, the NUSA runtime itself remains loopback-only.

## One-time setup

1. Install a current official `cloudflared` release and authenticate it to the Cloudflare account that owns the chosen domain.
2. Create a named tunnel, for example `nusa-paper`: `cloudflared tunnel create nusa-paper`.
3. Create the DNS route for a dedicated hostname, for example: `cloudflared tunnel route dns nusa-paper paper.example.com`.
4. Copy `deploy/cloudflare-tunnel/config.example.yml` to a location **outside** the repository, such as `%USERPROFILE%\.cloudflared\config.yml` on Windows.
5. Replace only these placeholders in the copied file:
   - `__TUNNEL_UUID__`
   - `__ABSOLUTE_TUNNEL_CREDENTIAL_JSON_PATH__`
   - `__PUBLIC_HOSTNAME__` (hostname only; no `https://`, path, query, username, password, or port)
   - `__NUSA_CLOUD_PORT__` (must exactly equal `NUSA_CLOUD_DASHBOARD_PORT`)
6. Validate the copied configuration before running it: `cloudflared tunnel --config <absolute-config-path> ingress validate`.
7. Optionally verify routing selection before startup with `cloudflared tunnel --config <absolute-config-path> ingress rule https://paper.example.com`.
8. Keep the generated tunnel credential JSON outside the repository. Never copy it into `deploy/`, `docs/`, `apps/`, `tests/`, or an Android project.

## Start

1. Generate a fresh high-entropy `NUSA_CLOUD_DASHBOARD_TOKEN` of at least 32 UTF-8 bytes and place it only in the NUSA Cloud process environment.
2. Set `NUSA_CLOUD_DASHBOARD_HOST=127.0.0.1`.
3. Set `NUSA_CLOUD_DASHBOARD_PORT` to the same port substituted into the tunnel config.
4. Start the NUSA cloud runtime and verify its local readiness endpoint from the same machine.
5. Start the tunnel: `cloudflared tunnel --config <absolute-config-path> run <tunnel-name-or-uuid>`.
6. Confirm the tunnel is healthy with `cloudflared tunnel info <tunnel-name-or-uuid>`.
7. On Android Settings, enter only the HTTPS origin, for example `https://paper.example.com`. Enter the NUSA dashboard bearer credential in the credential field, never in the URL.
8. Run Settings verification. Treat redirects to a different origin, TLS failures, certificate errors, auth failures, and unexpected HTTP origins as hard failures.

## Stop

1. Stop `cloudflared` first. This removes remote reachability while leaving the local runtime loopback-only.
2. Stop the NUSA cloud runtime.
3. Clear the Android dashboard credential from Settings when the device should no longer access the PAPER backend.

## Recovery / rotation

- Bearer compromise: stop the runtime, replace `NUSA_CLOUD_DASHBOARD_TOKEN`, restart, and re-enter the new credential on the device. Do not reuse the old token.
- Tunnel credential compromise: stop/delete or rotate the Cloudflare tunnel credential using Cloudflare tooling, then replace only the external credential JSON/config. NUSA source does not change.
- DNS/hostname change: update the Cloudflare route and external tunnel config, then update the Android HTTPS origin. Do not add HTTP fallback.
- Tunnel outage: Android must remain disconnected/offline rather than falling back to LAN HTTP.

## Exact-device acceptance gate

Repository automation can prove configuration contracts, but Issue #391 is not complete until an exact Android RC on a physical device proves all of the following through the trusted HTTPS hostname: Settings verification, PAPER read, PAPER order, resulting state/history, Portfolio, relaunch/recovery, TLS trust, redirect/final-origin guards, and absence of cleartext fallback.

That physical-device evidence remains HUMAN_ENVIRONMENT_ONLY and must not be fabricated or inferred from CI.
