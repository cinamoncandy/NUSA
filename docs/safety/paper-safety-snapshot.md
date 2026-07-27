# Paper Safety Snapshot

WO-0032 persists Paper-only safety state in the existing desktop SQLite store. The
snapshot is schema-versioned, deterministically hashed, and replaced inside the same
SQLite transaction as account and control persistence. A failed validation or write
does not replace the previous valid snapshot.

The persisted record contains the kill switch, approval binding, deployment and
reconciliation status, idempotency identifiers, open alerts, loss counters and the
runtime fingerprints. It always stores `automaticTrading: false`; it is not an
authorization artifact and cannot grant live, private API, credential, or production
trading capability.

On restart, the snapshot is validated before use. A malformed, future-version,
partial, duplicate-identity, non-finite, or hash-invalid snapshot is fail-closed. The
desktop runtime records a diagnostic, remains unable to place Paper orders, and needs
operator review. The snapshot is never silently deleted to make a restart succeed.
