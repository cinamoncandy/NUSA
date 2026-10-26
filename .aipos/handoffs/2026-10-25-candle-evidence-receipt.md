# Candle evidence receipt follow-up — 2026-10-25

Canonical owner: Research / Market Data Integrity, Issue #2815, existing PR #2879.
Work order: `WO-RESEARCH-20261025-CANDLE-EVIDENCE-RECEIPT`.

Fresh review of PR head `db35ee55de37584ff45169aaf19b7cbd7ca92ba3` found a P1: the existing closed-candle aggregator could synthesize a digest from market ticks when all per-observation evidence was absent, or hash `null` placeholders when evidence was partial. The existing collector forwards that digest to the durable candle material store, making unprovenanced ticker candles appear receipt-backed.

The local repair preserves the separate deterministic source fingerprint and omits `evidenceFingerprintSha256` unless every observation has a valid event evidence fingerprint. Regression coverage checks absent, partial, and complete evidence, plus persistence of SQL NULL through the existing SQLite collector/store path. No historical state or production database is changed.

Validation so far: Node 24.19.0 `pnpm run preflight` PASS; `pnpm run build` PASS; `tests/closed-candle-aggregator.test.js` 12/12 PASS. Remaining: collector regression, `validate:full`, `security:gate`, exact-head CI, fresh non-author review. Keep PAPER-only authority boundaries and do not deploy or claim dataset-manifest eligibility from this change.
