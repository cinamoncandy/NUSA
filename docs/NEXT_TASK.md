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

The consolidated lifecycle and explicit command boundaries are documented in `docs/operations/OPERATIONS_PLAYBOOK.md`.

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
