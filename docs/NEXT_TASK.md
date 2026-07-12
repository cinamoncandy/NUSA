# Next Task

## Current baseline

Development continues on `agent/electron-upbit-paper-trading` in Draft PR #1.

Implemented and continuously validated:

- SQLite-backed Paper and Control persistence with default-off recovery;
- deterministic backtest, Walk-Forward, dataset provenance, Research Memory, and cost stress;
- PAPER/DRY_RUN Strategy Governance and Investment Committee controls;
- read-only AI CIO Electron dashboard with fail-closed source availability;
- Paper portfolio, bounded risk, and synthetic execution projections;
- runtime health, recovery, evidence, and release-readiness contracts;
- operational completion policy with calendar and scenario-based Paper validation profiles.

## Active validation profile

The owner does not plan to wait for a 30-day Paper calendar period. Use `SCENARIO_BASED` explicitly.

Required evidence:

- 20 observed Paper sessions;
- 50 completed Paper orders;
- 3 represented market regimes;
- 3 restart-recovery passes;
- 10 duplicate-order checks;
- persistence failure, WebSocket disconnect, partial-write, duplicate-signal, and Kill Switch scenarios;
- Walk-Forward, cost-stress, and integrity PASS.

This replaces only elapsed calendar duration. It does not replace CI, recovery, source coverage, security review, or owner approval.

## Remaining work

1. Collect real scenario evidence; never manufacture counters or elapsed operation.
2. Connect actual Opportunity, Committee, Strategy analytics, and Research sources to the read-only dashboard.
3. Keep unavailable sources explicit and the completion gate blocked until connected.
4. Run supported SQLite corruption/restore and event-log replay drills and preserve immutable evidence.
5. Resolve every critical/high audit finding or record explicit owner acceptance.
6. Keep LIVE trading, private APIs, credentials, withdrawal actions, automatic promotion, and automatic release disabled.
7. Keep PR #1 Draft and unmerged until owner review.

## Validation commands

```text
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm test
```

Windows CI is the authoritative clean-checkout result. Never claim completion while required CI is failing or scenario evidence is incomplete.
