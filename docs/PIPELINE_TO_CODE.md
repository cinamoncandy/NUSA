# Pipeline → Code Map

The canonical pipeline (`README.md`, `nusa.md`):

```
Market Data → Intelligence → Strategy → Decision → Risk → Portfolio → Execution → Paper Adapter → Review → Memory
```

There is no single orchestrator file wiring these stages end to end. This map
records what each stage actually corresponds to in the tree so the pipeline
stays an honest mental model instead of implying modules that do not exist.
Status verified against the tree; paths are relative to the repository root.

| Stage | Status | Actual locations |
|-------|--------|------------------|
| Market Data | EXISTS | `apps/desktop/src/exchange/upbitWebSocket.ts`, `packages/core/src/upbitWebSocket.ts` (+ `marketConnectionSupervisor.ts`, `closedCandleAdapter.ts`) |
| Intelligence | PARTIAL (fragmented, no `IntelligenceEngine`) | `apps/desktop/src/strategy/marketRegime.ts`, `apps/cloud/src/marketRegimeEngine.ts`, `marketIntelligenceFusion.ts`, `fundingCarryScanner.ts` |
| Strategy | EXISTS (strongest) | `packages/core/src/strategyEngine.ts`: `SmaCrossoverStrategy`, `RsiMeanReversionStrategy`, `BollingerBreakoutStrategy`, `MacdMomentumStrategy`, `StochasticOscillatorStrategy`, `DonchianBreakoutStrategy` (all trailing-only, lookahead-guard tested) + `RegimeGatedStrategy` (policy-driven entry gate, exits always pass), `strategyRegistry.ts`, `backtestEngine.ts`, `walkForwardEngine.ts` |
| Decision | EXISTS (renamed) | `apps/cloud/src/cioDecisionEngine.ts` (`decideCio`), `apps/desktop/src/paper/decisionPaperExecution.ts`, `packages/contracts/src/decision*.ts` |
| Risk | EXISTS (strong) | `apps/desktop/src/risk/independentRiskGateway.ts` + `apps/cloud/src/independentRiskGateway.ts` (parity-tested), `pre-trade-risk.ts`, `hard-risk-gateway.ts`, `paperSafetyGates.ts` |
| Portfolio | WEAK (no `PortfolioEngine`) | `apps/cloud/src/capitalAllocationEngine.ts`, `portfolioOrchestrator.ts`, `apps/desktop/src/paper/positionSizing.ts`, `packages/contracts/src/portfolioRiskIntelligence.ts` |
| Execution | EXISTS (fragmented) | `apps/execution/src/` (`ExecutionService`, `execution-gateway`, `order-engine`), `apps/cloud/src/paperTradingExecutionLoop.ts` |
| Paper Adapter | EXISTS | `apps/desktop/src/paper/paperBroker.ts` (re-export of `packages/core/src/paperBroker.ts`) duplicated as `apps/cloud/src/paperBroker.ts` (parity/killswitch/fill-model tested; duplication intentional for state isolation) |
| Review | PARTIAL (no `ReviewEngine`) | `persistence/ownerReviewStore.ts`, `recovery/recoveryReconciliation.ts` (owner-review), `investmentCommittee.ts`, `strategyGovernance.ts` |
| Memory | PARTIAL (no unified `Memory`) | `packages/storage/src/researchMemory.ts`, `improvementCandidateMemory.ts`, `aiOutcomeAttributionMemory.ts`, `evolutionLearningLedger.ts` |

## Rules the tree enforces (not just docs)

- Strategy emits signals only; order placement lives behind adapters that throw
  `LiveMutationDisabledError` without explicit LIVE authority
  (`apps/desktop/src/exchange/liveTradingAdapter.ts`).
- Risk may reject, resize, pause, or halt any intent
  (`independentRiskGateway.ts` on desktop and cloud).
- Paper and Live adapters share interfaces but never share mutable operating state.
- Fail closed on uncertainty (`productionHardening.ts`, safety validators).

## Non-stages that still exist in the tree

- `apps/autopilot/` — audit runner and coding-evidence automation (fail-closed, zero authority), not part of the trading pipeline.
- `services/upbit-readonly/` — localhost-only read-only observation bridge.
- `services/nusa-mcp/` — constrained local MCP surface.
