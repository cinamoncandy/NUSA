# NUSA Upbit read-only backend

This service is the repository-managed source for the NUSA server-side Upbit read-only bridge.

## Safety boundary

- Binds to `127.0.0.1:3001` only by default (`NUSA_UPBIT_READONLY_PORT`). Public HTTPS termination belongs to the reverse proxy. Cloud Runtime keeps its separate canonical port.
- Exposes unauthenticated `GET /health`.
- Exposes authenticated `GET /api/v1/account/summary`.
- Retains `GET /api/upbit/accounts` as a normalized compatibility path.
- Exposes read-only `GET /api/v1/orders/open`, `GET /api/v1/orders/history`, and `GET /api/v1/orders/:uuid` query routes.
- Order query responses are normalized to stable NUSA fields and never expose BUY/SELL/CANCEL controls.
- Validates and normalizes the provider payload server-side; PAPER state is never mixed into the response.
- Upbit credentials stay server-side in environment variables.
- The Cloud runtime proxies its authenticated read-only routes to this loopback service. Configure the same server-only `NUSA_API_TOKEN` in the Cloud and relay processes; the mobile access token is validated by Cloud and is never forwarded to Upbit.
- Cloud uses `http://127.0.0.1:3001` by default (`NUSA_UPBIT_READONLY_URL` may select an approved HTTPS relay origin). No relay token, Upbit credential, or dashboard bearer is configured in Android.
- Cloud supplies the relay-only `NUSA_API_TOKEN`; the mobile client supplies only its authenticated NUSA session bearer to Cloud.
- No order placement, cancellation, withdrawal, transfer, or other financial mutation endpoint is implemented here.

## Required environment

Copy `.env.example` only as a list of variable names. Never commit real values.

- `NUSA_API_TOKEN`
- `UPBIT_ACCESS_KEY`
- `UPBIT_SECRET_KEY`

Production should inject these through a protected environment file or service manager. The repository does not load `.env` automatically.

## Local checks

```bash
cd services/upbit-readonly
npm test
```

Start only after required environment variables are injected:

```bash
npm start
```

The next backend capability may add read-only order-query routes only after this source-control foundation is merged and its protected-main checks pass.
