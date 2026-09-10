# Pipeline → Code Map

The canonical pipeline (`README.md`, `nusa.md`):

```
Market Data → Intelligence → Strategy → Decision → Portfolio → Risk → Execution → Paper Adapter → Review → Memory
```

The level-10 module layer is defined by `apps/cloud/src/moduleLevel10.ts`, the canonical
entrypoints are registered in `apps/cloud/src/canonicalModuleRegistryV10.ts`, and
`apps/cloud/src/pipelineOrchestratorV10.ts` provides deterministic fail-closed sequencing and
per-stage evidence. Runtime callers still provide the concrete stage adapters and inputs; the
orchestrator never grants LIVE authority and accepts only PAPER/SHADOW execution context.

Which of these stages runtime code actually reaches is declared in
`apps/cloud/src/architecture/pipelineWiringV10.ts` and checked against the import graph by
`tests/pipeline-wiring-v10.test.js`. Today the V10 engines are reached only from the V10
registry, the retained implementations underneath carry the running pipeline, and the
Intelligence stage additionally has no producer for the `MarketRegimeFeatures` its gate
reads. Read that declaration before treating a row below as a description of a running
system.

| Stage | Canonical status | Canonical entrypoint and retained implementations |
|-------|------------------|---------------------------------------------------|
| Market Data | V10 REGISTERED | `packages/core/src/upbitWebSocket.ts`; desktop websocket, connection supervisor and closed-candle adapter remain the acquisition implementations |
| Intelligence | V10 ENGINE | `apps/cloud/src/intelligenceEngineV10.ts` unifies `marketIntelligenceFusion.ts` + `marketRegimeEngine.ts`; existing scanners remain evidence sources |
| Strategy | V10 REGISTERED | `packages/core/src/strategyEngine.ts`: SMA, RSI, Bollinger, MACD, Stochastic, Donchian + `RegimeGatedStrategy`, registry, backtest and walk-forward tooling |
| Decision | V10 REGISTERED | `apps/cloud/src/cioDecisionEngine.ts` (`decideCio`) plus shared decision contracts |
| Portfolio | V10 ENGINE | `apps/cloud/src/portfolioEngineV10.ts` composes `capitalAllocationEngine.ts` and `portfolioOrchestrator.ts` and re-checks gross/futures/deployable-capital invariants |
| Risk | V10 REGISTERED | `apps/cloud/src/independentRiskGateway.ts` with desktop parity, pre-trade/hard-risk/safety gates |
| Execution | V10 ENGINE | `apps/cloud/src/executionEngineV10.ts` is PAPER-only and delegates to `paperTradingExecutionLoop.ts`; non-PAPER mode is blocked |
| Paper Adapter | V10 REGISTERED | `apps/cloud/src/paperTradingExecutionLoop.ts`; paper brokers remain state-isolated and parity/killswitch/fill-model tested |
| Review | V10 ENGINE | `apps/cloud/src/reviewEngineV10.ts` combines investment-committee output with deterministic review checks and never emits LIVE authority |
| Memory | V10 ENGINE | `packages/storage/src/memoryEngineV10.ts` unifies research, improvement-candidate, evolution-learning and AI-outcome persistent memories behind one facade |

## Level-10 contract

Every registered module must satisfy the ten criteria enforced by `moduleLevel10.ts`:
canonical entrypoint, deterministic I/O, strict typed contract, fail-closed behavior,
idempotency or state isolation, observable evidence, recovery path, unit tests, integration tests,
and architecture validation. `moduleLevel10.test.ts` verifies registry completeness, source-path
truth, deterministic evidence hashing, LIVE-mode rejection, canonical stage order and immediate
halt on the first failed-closed stage.

## Rules the tree enforces (not just docs)

- Strategy emits signals only; order placement remains behind adapters that throw
  `LiveMutationDisabledError` without explicit LIVE authority (`apps/desktop/src/exchange/liveTradingAdapter.ts`).
- Risk may reject, resize, pause, or halt any intent (`independentRiskGateway.ts` on desktop and cloud).
- PAPER and LIVE adapters share interfaces but never share mutable operating state.
- Level-10 module execution accepts PAPER/SHADOW context only; `executionEngineV10.ts` is PAPER-only.
- AI remains advisory / zero-authority and `productionMutationAllowed` remains `false`.
- Fail closed on uncertainty (`productionHardening.ts`, safety validators, `moduleLevel10.ts`).

## Non-stages that still exist in the tree

- `apps/autopilot/` — audit runner and coding-evidence automation (fail-closed, zero authority), not part of the trading pipeline.
- `services/upbit-readonly/` — localhost-only read-only observation bridge.
- `services/nusa-mcp/` — constrained local MCP surface.
