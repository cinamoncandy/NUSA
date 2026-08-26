# Android PAPER HTTPS bridge

This runbook exposes the loopback-only NUSA PAPER dashboard to a physical Android device through a trusted HTTPS hostname without weakening the NUSA runtime bind boundary.

## Safety boundary

- NUSA cloud runtime stays bound to `127.0.0.1` or `localhost`.
- Android continues to require HTTPS for non-loopback PAPER endpoints.
- `NUSA_CLOUD_DASHBOARD_TOKEN` is sent only as the existing bearer credential. Do not place it in the hostname, path, query string, tunnel config, DNS record, or repository.
- Cloudflare Tunnel only transports requests to the existing PAPER dashboard. It does not add LIVE authority, broker mutation, withdrawal, transfer, or credential expansion.
- Required invariants remain `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI `ZERO_AUTHORITY`.

## Prerequisites

1. A Cloudflare-managed hostname such as `paper.example.com`.
2. `cloudflared` installed on the machine running NUSA.
3. A named Cloudflare Tunnel and its local credentials file.
4. A strong local `NUSA_CLOUD_DASHBOARD_TOKEN` of at least 32 UTF-8 bytes.

## Configure NUSA

Run the dashboard on loopback only. The example tunnel template expects port `8787`:

```text
NUSA_CLOUD_DASHBOARD_HOST=127.0.0.1
NUSA_CLOUD_DASHBOARD_PORT=8787
NUSA_CLOUD_DASHBOARD_TOKEN=<strong local secret>
```

Start NUSA with the repository's normal cloud runtime command. Do not change the host to `0.0.0.0` to make Android connectivity work.

## Configure the tunnel

Copy `config/cloudflared/nusa-paper.example.yml` outside the repository and replace only:

- `<TUNNEL_UUID>`
- `<ABSOLUTE_PATH_TO_CLOUDFLARED_CREDENTIALS_JSON>`
- `<PAPER_HOSTNAME>`

The origin intentionally remains plain HTTP on loopback because TLS terminates at Cloudflare and the origin connection never leaves the local machine. The final ingress rule is an explicit `http_status:404` catch-all so unmatched hostnames fail closed.

Validate the configuration before starting it:

```text
cloudflared tunnel ingress validate --config <path-to-config.yml>
```

Start the named tunnel using the same local configuration. Create the public hostname/DNS route so `<PAPER_HOSTNAME>` resolves through that tunnel.

## Android endpoint

In NUSA Settings, configure only the HTTPS origin:

```text
https://<PAPER_HOSTNAME>
```

Keep the dashboard bearer credential in the existing credential field. Never append it to the URL.

Verify Settings first, then exercise the existing PAPER read/state/history/portfolio flow. PAPER order simulation remains PAPER-only and uses the existing authenticated application boundary.

## Stop and recover

To stop remote exposure, stop the `cloudflared` tunnel process or service. NUSA remains available only on loopback.

If Android cannot connect:

1. Confirm NUSA answers locally on `127.0.0.1:8787`.
2. Run `cloudflared tunnel ingress validate` again.
3. Confirm the published hostname routes to `http://127.0.0.1:8787`.
4. Confirm Android is configured with `https://`, not `http://`.
5. Re-enter the dashboard bearer credential if authentication fails. Do not log or paste the credential into issue comments.

A tunnel outage, DNS error, authentication failure, or stale dashboard response must remain a connection failure. Do not fall back to cleartext LAN HTTP or a non-loopback NUSA bind.

## Repository contract

`tests/android-paper-https-bridge-contract.test.js` locks the security-sensitive properties of this deployment path: loopback origin, HTTPS Android endpoint guidance, explicit 404 catch-all, no committed bearer token, and no instruction to bind NUSA publicly.
