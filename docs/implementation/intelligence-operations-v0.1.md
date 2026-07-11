# Intelligence and Operations v0.1

This slice connects normalized market observations to CIO signals and exposes a mobile-safe operational health snapshot.

## Intelligence fusion

- accepts deterministic observations from macro, news, chart, on-chain, ETF, funding, OI, and risk sources
- rejects duplicate IDs, invalid ranges, future timestamps, and malformed expiry windows
- excludes expired observations and reports their sources as stale
- creates one weighted signal per source with deterministic ordering and bounded confidence

## Operational snapshot

- combines API, database, market-data, intelligence, exchange, runtime mode, and kill-switch health
- permits trading only in PAPER mode when all services are healthy
- any DOWN service or FAULTED runtime fails closed and recommends emergency stop
- degraded services recommend waiting; STOPPED and kill-switch states require system review

## Boundaries

No external news provider, AI API, exchange private API, live order path, credentials, or deployment infrastructure is introduced here.
