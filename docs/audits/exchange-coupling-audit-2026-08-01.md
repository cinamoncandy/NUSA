# Exchange Coupling Audit

Audited commit: 8468cb3bd404979cd9cead998f9e4bfad6c7e800

## Findings

- Public Upbit WebSocket, candle, and read-only adapter code is isolated under `apps/desktop/src/upbit*.ts` and is an adapter boundary.
- JWT, query hashing, Authorization, and Upbit REST URLs occur only in the read-only adapter and logger/redaction code.
- The functional Paper execution boundary contained Upbit-specific error wording. The wording is now spot-exchange neutral; execution behavior is unchanged.
- `apps/desktop/src/main.ts`, `paperBroker.ts`, and shadow profile files still contain the current product profile (`KRW-BTC`, Upbit minimum notional, and allowed symbol). These are runtime configuration/profile concerns, but are not yet represented by a canonical exchange policy contract.
- Renderer labels and screenshots may mention Upbit because the current product target is Upbit Spot Paper Trading; this is presentation/configuration, not Domain exchange logic.

## Status

- Domain rewrite: not required for this slice.
- Live mutation: disabled.
- Production mutation: false.
- Remaining architecture gap: introduce a small canonical exchange/profile contract before adding a second adapter. Do not build a universal framework from the first exchange.
