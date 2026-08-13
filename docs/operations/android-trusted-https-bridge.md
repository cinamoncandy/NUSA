# Android trusted HTTPS bridge

## Purpose

Expose the loopback-only NUSA PAPER runtime to a physical Android device through a normal publicly trusted HTTPS origin without changing the NUSA runtime bind address or Android cleartext policy.

This bridge does **not** add LIVE authority. NUSA remains PAPER-only with `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI `ZERO_AUTHORITY`.

## Prerequisites

- NUSA cloud runtime configured with `NUSA_CLOUD_DASHBOARD_HOST=127.0.0.1` (or omitted so the existing loopback default applies).
- `NUSA_CLOUD_DASHBOARD_PORT` set to the same port used by the cloud runtime.
- `cloudflared` installed from Cloudflare's official distribution and available on `PATH`, or its exact executable path supplied through `NUSA_CLOUDFLARED_BIN`.
- The bearer credential remains separate from the endpoint URL and is entered only in the NUSA Settings credential field.

## Start

1. Start the NUSA cloud runtime normally.
2. In a second terminal, with the same `NUSA_CLOUD_DASHBOARD_PORT`, run:

   `pnpm run bridge:https`

3. `cloudflared` prints an ephemeral `https://<random>.trycloudflare.com` URL. Copy **only** that HTTPS origin into the Android Settings PAPER endpoint field.
4. Enter the dashboard bearer separately in the credential field and run Settings verification.

The launcher always forwards to `http://127.0.0.1:<port>` and never places the bearer in process arguments or the public URL.

## Stop

Stop the bridge process with Ctrl+C. The ephemeral public origin stops with the process. Stop the NUSA cloud runtime separately.

## Recovery

- If the bridge process exits, restart `pnpm run bridge:https`; a quick tunnel may receive a new HTTPS URL, so update the Android endpoint before retrying.
- If Android reports endpoint or TLS failure, do not enable cleartext HTTP and do not bind NUSA to `0.0.0.0`. Confirm the bridge is running and use the newly printed HTTPS origin.
- If authentication fails, rotate/re-enter the bearer separately. Never append it to query parameters, fragments, or paths.
- Redirect/final-origin validation in the mobile client remains authoritative and fail-closed.

## Security boundary

A Quick Tunnel creates a publicly reachable random HTTPS origin. Treat the URL as discoverable and rely on NUSA authentication, approval, rate limits, request validation, and fail-closed PAPER controls. Do not use it to expose any LIVE mutation capability. For longer-lived deployments, replace the ephemeral tunnel with an explicitly authorized named deployment while preserving the same loopback-only origin and HTTPS-only mobile boundary.

## Verification contract

Repository-controlled verification must confirm:

- bridge argv targets only `127.0.0.1`;
- no bearer secret is placed in argv or URL;
- invalid/missing ports fail closed;
- runtime loopback restrictions and Android `usesCleartextTraffic=false` remain unchanged.

Physical Android end-to-end verification remains HUMAN_ENVIRONMENT_ONLY: Settings verification and PAPER read/order/state/history/portfolio flow through the generated trusted HTTPS origin must be performed on the real device before Issue #391 can be considered fully accepted.
