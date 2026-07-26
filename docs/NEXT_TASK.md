# Next Task

## Current baseline

Development continues on `agent/electron-upbit-paper-trading` in Draft PR #1.

Implemented and continuously validated:

- SQLite-backed Paper and Control persistence with default-off recovery;
- deterministic backtest, Walk-Forward, dataset provenance, Research Memory, and cost stress;
- PAPER/DRY_RUN Strategy Governance and Investment Committee controls;
- read-only AI CIO Electron dashboard with fail-closed source availability;
- Paper portfolio, bounded risk, and synthetic execution projections;
- runtime health, recovery, typed fault-drill evidence, and release-readiness contracts;
- operational completion policy with calendar and scenario-based Paper validation profiles.
- deterministic Rules Control Plane v0.1 with immutable published rule/policy versions, declarative fail-closed evaluation, replayable decision traces, and SQLite ledger snapshots; it remains recommendation-only and does not create execution authority.
- Multi-Agent Decision Governance v0.2 with role-bound Agent Registry, evidence/context integrity checks, independent risk veto, deterministic zero-authority aggregation, immutable incident containment recommendations, zero-authority certification, and replayable SQLite audit state; no agent runtime or provider access exists.

The consolidated lifecycle and explicit command boundaries are documented in `docs/operations/OPERATIONS_PLAYBOOK.md`.

### WO-0027: Walk-Forward request/result contract layer

`scripts/lib/walk-forward-runner.js` and `scripts/lib/walk-forward-verifier.js` add a
request/result contract (training+validation+test windows, an explicit SMA parameter
grid, `FIXED_PARAMETER_5_20`/buy-and-hold/cash benchmarks, deterministic hashing, and an
independent verifier) on top of the existing `walkForwardEngine.ts`/`backtestEngine.ts`/
`researchDataset.ts` lineage referenced above -- it does not replace that lineage, and it
does not introduce the `MarketCandle`/`HistoricalDatasetDescriptor` contracts that a
prior work-order draft assumed already existed (they do not; see
`docs/research/walk-forward-contract.md` for the full scope decision and disclosed
deviations, chiefly: same-candle-close fill rather than next-candle, and a single
dataset content hash rather than a source/normalized pair). Only synthetic fixtures have
been run so far (`tests/fixtures/walk-forward/basic-walk-forward.json`); no real
historical dataset has been executed through this layer, and no production SMA
parameter has changed as a result of this work. Owner review is still required before
any of this research feeds a Paper-promotion decision.

## Current verified GitHub state

At the last repository inspection:

- PR #1 was open, Draft, and mergeable;
- branch HEAD before the playbook documentation commits was `7b2b486c2710753395c29f235217ce7d04632306`;
- Windows CI run #1196 passed for that HEAD;
- no unresolved inline review threads were present;
- release readiness remained blocked pending real Paper evidence and owner review.

These values become stale after any new commit. Re-query GitHub and require CI for the latest HEAD before changing PR state.

## Active validation profile

The owner does not plan to wait for a 30-day Paper calendar period. Use `SCENARIO_BASED` explicitly.

Required evidence:

- 20 observed Paper sessions;
- 50 completed Paper orders;
- 3 represented market regimes;
- 3 restart-recovery passes;
- 10 duplicate-order checks;
- persistence failure, WebSocket disconnect, partial-write, duplicate-signal, and Kill Switch scenarios;
- Walk-Forward, deterministic Monte Carlo, cost-stress, and Integrity PASS.

This replaces only elapsed calendar duration. It does not replace CI, recovery, source coverage, security review, provenance, checksums, or owner approval.

## Remaining Codex work

1. Keep the latest branch HEAD green in Windows CI.
2. Connect actual Opportunity, Committee, and Strategy analytics sources to the read-only dashboard only under an explicitly approved scope.
3. The Research section now reads persisted manifest/report pairs with checksum matching. It requires deterministic Monte Carlo, Walk-Forward, Cost Stress, and Integrity reports; keep every other unavailable source explicit and the completion gate blocked until they are connected.
4. Improve operator tooling only when it generates typed, immutable, independently verifiable Paper evidence.
5. Resolve new Critical/High findings or record an explicit owner decision.
6. Keep LIVE trading, private APIs, credentials, withdrawal actions, automatic promotion, and automatic release disabled.
7. Keep PR #1 Draft and unmerged until latest-HEAD CI, real evidence, and owner review are complete.
8. Before distribution, provide an application icon, an owner-approved code-signing certificate, a portable-artifact decision, and real Windows GUI measurements for startup time, memory, scaling, keyboard-only, and screen-reader checks. The current unsigned NSIS build is technical packaging evidence only.
9. Extend Rules Control Plane v0.1 only through separately reviewed increments: formula registry, policy composition, explicit simulation/shadow reporting, query projections, CLI/dashboard, and certification workflows. Do not introduce dynamic code execution or authority creation.
10. Extend Multi-Agent Governance only through reviewed zero-authority increments: governed fixtures, calibration history, read-only projections, and operator-reviewed remediation. Do not add prompt/provider secrets, an order path, majority override, or automatic authority expansion.

## Remaining operator and owner work

1. Run the Electron application in the intended Windows environment.
2. Collect real scenario-based Paper sessions and completed orders.
3. Run supported SQLite recovery, WebSocket reconnect, duplicate-signal, Kill Switch, persistence-failure, and partial-write drills.
4. Export and verify the current evidence bundle without manual database manipulation.
5. Review reports, checksums, limitations, and remaining risks.
6. Explicitly decide whether PR #1 may move from Draft to Ready.

## Validation commands

```text
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm test
pnpm run release:check
pnpm package:win
```

Windows CI is the authoritative clean-checkout result. Never claim completion while required CI is failing, pending, stale, or scenario evidence is incomplete.
