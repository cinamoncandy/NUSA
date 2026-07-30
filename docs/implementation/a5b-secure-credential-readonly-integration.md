# A5B Secure Credential Read-only Integration

## Scope

This change adds an OS-backed credential provider for the Upbit public/read-only
integration. It does not add order, cancel, withdrawal, live trading, or private
mutation capabilities.

## Storage and threat model

The main process uses Electron `safeStorage` and stores only an encrypted envelope
under the application user-data directory. The envelope contains a schema version,
provider identifier, and encrypted payload. Writes use a temporary file followed by
an atomic rename. Storage is unavailable unless OS encryption is available; save and
load fail closed in that case. Renderer code never receives the secret key or the
decrypted payload.

Credentials are validated as bounded printable values and are cleared from the form
after a successful save. Status responses expose only whether credentials exist and a
short access-key hint.

## IPC contract

The preload bridge exposes fixed methods only:

- `upbitCredentials.getStatus()`
- `upbitCredentials.save({ accessKey, secretKey })`
- `upbitCredentials.delete()`
- `upbitReadOnly.testConnection()`
- `upbitReadOnly.getSnapshot()`
- `upbitReadOnly.reconcile()`

The main process validates the exact save object, maps provider failures to stable
read-only result codes, and uses the existing `UpbitLiveReadOnlyAdapter`. No arbitrary
IPC channel, credential read, or mutation endpoint is exposed.

## Account view and reconciliation

The settings surface can request a read-only account snapshot showing observation time,
asset count, and open-order count. It never exposes signing material. Reconciliation
compares consecutive authenticated snapshots by currency balance/locked amount and open
order count. The first comparison is `UNKNOWN` because no baseline exists; equal snapshots
are `MATCH`, and any difference is `DIFF`. There is no automatic correction or order path.

## Verification

Use the repository's normal checks:

```text
pnpm typecheck
pnpm build
npm test
pnpm lint
pnpm package:validate
```

Tests use injected safe-storage and adapter fakes. No real Upbit credentials or live
network calls are used by the automated suite. A real connection test is therefore
not claimed as executed here.

## Operational safety

The deployment descriptor distinguishes OS-backed credential storage from unsafe
credential storage. The risk gateway continues to fail closed for explicit unsafe
storage, while legacy descriptors without the new field retain their prior
conservative behavior. Live trading and private mutation capabilities remain disabled.
