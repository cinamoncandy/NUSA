# NUSA Upbit read-only backend

This service is the repository-managed source for the NUSA server-side Upbit read-only bridge.

## Safety boundary

- Binds to `127.0.0.1:3000` only. Public HTTPS termination belongs to the reverse proxy.
- Exposes unauthenticated `GET /health`.
- Exposes authenticated `GET /api/v1/account/summary`.
- Retains `GET /api/upbit/accounts` as a normalized compatibility path.
- Exposes read-only `GET /api/v1/orders/open`, `GET /api/v1/orders/history`, and `GET /api/v1/orders/:uuid` query routes.
- Order query responses are normalized to stable NUSA fields and never expose BUY/SELL/CANCEL controls.
- Validates and normalizes the provider payload server-side; PAPER state is never mixed into the response.
- Upbit credentials stay server-side in environment variables.
- The mobile client supplies only the NUSA bridge bearer token.
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
