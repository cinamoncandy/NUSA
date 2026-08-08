# Personal-Use Runtime Gap Audit

**Audit base:** `de530d273b51aa5551fe6900bdb36baf80c47aea` (`origin/main`)

## Verification Context

- Full CI: PASS, run [31243166792](https://github.com/cinamoncandy/NUSA/actions/runs/31243166792)
- Mobile Native CI: PASS, run [31243166797](https://github.com/cinamoncandy/NUSA/actions/runs/31243166797)
- PR #168 signing infrastructure: merged at the audit base
- Signing secrets: not configured in the repository secret listing at audit time
- Independent human signing verifier: no repository evidence

CI results prove repository checks only. They do not prove a real certificate,
production artifact, external broker preflight, or LIVE authorization.

## Runtime Classification

| Capability | Classification | Repository evidence | Runtime evidence | Tests |
|---|---|---|---|---|
| PAPER market ingestion | COMPLETE_RUNTIME | `apps/cloud/src/runtime.ts`, `apps/cloud/src/upbitWebSocket.ts` | Runtime constructs `UpbitWebSocketClient` and passes ticker callbacks | `tests/cloud-runtime.test.js`, `tests/upbit-websocket.test.js` |
| PAPER execution loop | COMPLETE_RUNTIME | `apps/cloud/src/paperTradingExecutionLoop.ts`, `apps/cloud/src/paperBroker.ts` | `runtime.ts` creates the loop and feeds market observations | `tests/cloud-paper-trading-execution-loop.test.js` |
| Paper persistence/recovery | COMPLETE_RUNTIME | `apps/cloud/src/paperTradingExecutionLoop.ts`, `apps/cloud/src/durableCloudDashboardStateProvider.ts`, `packages/storage/src` | Account and dashboard state are restored through SQLite-backed repositories | `tests/paper-trading-execution-loop.test.js`, `tests/durable-cloud-dashboard-state.test.js` |
| Pre-trade risk / kill switch | COMPLETE_RUNTIME | `apps/cloud/src/paperOperationalPreflight.ts`, `apps/execution/src/risk-safety-integration.ts` | Broker access is gated by preflight and fail-closed state | `tests/risk-safety-runtime-wiring.test.js`, `tests/paper-operational-preflight.test.js` |
| Stale-data protection | COMPLETE_RUNTIME | `apps/cloud/src/marketConnectionSupervisor.ts`, `apps/cloud/src/upbitWebSocket.ts` | Connection health and freshness feed safe dashboard/execution state | `tests/market-connection-supervisor.test.js` |
| Portfolio projection | COMPLETE_RUNTIME | `apps/cloud/src/portfolioOrchestrator.ts`, `apps/cloud/src/paperTradingExecutionLoop.ts` | Paper fills update account/position state and dashboard projection | `tests/portfolio-orchestrator.test.js`, `tests/cloud-paper-trading-execution-loop.test.js` |
| Strategy registration/lifecycle | PARTIAL_RUNTIME | `apps/cloud/src/strategyRegistry.ts`, `apps/cloud/src/strategyGovernanceService.ts` | Registry/governance services exist; runtime wiring from cloud execution loop is not evidenced | `tests/strategy-registry.test.js`, `tests/strategy-governance-service.test.js` |
| Champion/challenger evaluation | PARTIAL_RUNTIME | `apps/cloud/src/championChallengerManager.ts`, `apps/cloud/src/championDashboard.ts` | Evaluation and dashboard functions exist; no cloud runtime invocation was found in `runtime.ts` | `tests/champion-challenger-governance.test.js`, `tests/champion-monitor.test.js` |
| Challenger zero-authority boundary | CONTRACT_ONLY | `packages/contracts/src/championChallenger.ts`, `packages/contracts/src/shadowGovernance.ts` | Contract prevents authority; no production evaluation adapter connected to the execution runtime | contract/governance tests |
| Same-input champion/challenger comparison | NOT_IMPLEMENTED | Separate strategy/research and paper execution modules exist | No runtime coordinator proving shared market/fill/fee/slippage inputs was found | no end-to-end comparison test found |
| Promotion decision workflow | PARTIAL_RUNTIME | `apps/cloud/src/researchPromotionGate.ts`, `apps/cloud/src/strategyPromotionEngine.ts`, `apps/cloud/src/strategyGovernanceService.ts` | Deterministic decision and ledger services exist; end-to-end candidate-to-owner workflow is not runtime-wired | promotion and governance tests |
| Append-only promotion audit ledger | PARTIAL_RUNTIME | `apps/cloud/src/strategyGovernanceService.ts`, `packages/storage/src/strategyGovernanceStore.ts` | Persistence contract exists; live research runtime append/query path is not evidenced | governance ledger tests |
| Risk/session/daily-loss state | COMPLETE_RUNTIME | `apps/execution/src/risk-safety-integration.ts`, `apps/cloud/src/paperOperationalPreflight.ts` | Canonical risk input is connected to paper preflight and dashboard safety projection | risk-safety integration tests |
| Read-only broker integration | CONTRACT_ONLY | `apps/cloud/src/readOnlyBroker*`, `docs/release/constitutional-human-transition-runbook.md` | Requires operator-controlled external credentials; no external runtime evidence in repository | read-only credential integration tests |
| Desktop PAPER UI | COMPLETE_RUNTIME | `apps/desktop/src/main.ts`, `apps/desktop/src/paperDashboardProjection.ts` | Electron main process exposes PAPER dashboard and read-only AI/challenger status | desktop IPC/dashboard tests |
| Mobile runtime validation | PARTIAL_RUNTIME | `.github/workflows/mobile-native.yml`, `apps/mobile` | CI validates native structure/build; physical device lifecycle/recovery evidence is external | mobile native tests |
| Production signing | RETAINED_NOT_REQUIRED | `.github/workflows/windows-production-signing.yml`, `scripts/verify-windows-authenticode.ps1` | Manual optional workflow; no certificate or independent verifier evidence | signing readiness tests |

## Priority Backlog

### P0

1. **Wire a production Research Runtime coordinator.** Connect candidate
   registration, evaluation, governance, and evidence to one explicit PAPER/
   Research lifecycle while preserving zero authority. Evidence:
   `apps/cloud/src/championChallengerManager.ts` is not referenced by
   `apps/cloud/src/runtime.ts`.

### P1

1. **Implement shared-input Champion/Challenger evaluation.** Reuse one
   immutable market/fill/fee/slippage dataset and emit reproducible comparison
   evidence. No current end-to-end coordinator was found.
2. **Connect candidate lifecycle to the runtime.** Register and restore strategy
   candidates through the existing registry/governance services.
3. **Connect promotion decisions to append-only evidence.** Require owner
   review metadata and queryable records before any non-live paper promotion.
4. **Add Research Runtime restart/replay integration.** Prove identical
   evaluation output after restart and explicit missing-data behavior.
5. **Add physical/mobile lifecycle evidence.** Automate or externally record
   background/foreground and network-transition recovery; current CI is build
   and structure evidence only.
6. **Add external read-only broker preflight when an operator supplies approved
   credentials.** This remains human/environment gated and must not grant order
   authority.

### P2

1. Add long-run research/paper runtime metrics for memory, CPU, reconnects, and
   evaluation latency.
2. Add portfolio reconciliation diagnostics against persisted paper account
   snapshots.
3. Add operational dashboards for research evaluation health and evidence age.

### P3

1. Improve UI presentation of strategy lifecycle, research evidence, and broker
   connectivity while preserving authoritative safety semantics.
2. Keep optional public signing/installer checks isolated from private execution.

## Scope Boundary

The public Windows signing blocker is not a personal-use release blocker. The
following remain prohibited regardless of product scope: automatic LIVE
activation, real orders, withdrawals, execution credential generation, kill
switch/HALT bypass, and automatic risk increases.
