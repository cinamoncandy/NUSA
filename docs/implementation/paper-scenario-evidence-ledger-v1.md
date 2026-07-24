# Paper Scenario Evidence Ledger v1

Scenario-Based Paper completion counters are derived from an append-only,
SHA-256 chained event log. The ledger rejects duplicate event IDs, timestamp
regressions, sequence gaps, hash tampering, and malformed events.

The ledger is an evidence collector, not an evidence generator. It does not
create sessions, orders, regimes, recovery passes, or fault results. Operators
must feed it events emitted by real Paper runtime activity. Replaying the same
records produces the same immutable summary.
