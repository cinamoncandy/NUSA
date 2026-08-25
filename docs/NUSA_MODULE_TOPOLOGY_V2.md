# NUSA v2 Module Topology

## Goal

Reorganize investment intelligence into explicit boundaries so that data, prediction, strategy research, decision selection, execution modelling, portfolio allocation, and hard risk authority cannot collapse into one opaque trading agent.

## Proposed canonical module families

### `apps/desktop/src/market/`
Market observation and point-in-time state only.

Proposed modules:
- `marketStateFrame.ts`
- `featureFreshness.ts`
- `sourceHealth.ts`
- `microstructureFeatures.ts`
- `derivativesState.ts`
- `crossAssetState.ts`

Must not contain strategy selection or execution authority.

### `apps/desktop/src/regime/`
Market regime and model-health observation.

Proposed modules:
- `regimeDetector.ts`
- `changePointDetector.ts`
- `featureDriftMonitor.ts`
- `strategyHealthMonitor.ts`
- `staleEvidenceDetector.ts`

Outputs beliefs/health state, not orders.

### `apps/desktop/src/forecast/`
Probabilistic specialist forecasts.

Proposed modules:
- `forecastContract.ts`
- `forecastRegistry.ts`
- `calibrationTracker.ts`
- `uncertaintyModel.ts`
- `specialists/`

A forecast is never an order.

### `apps/desktop/src/league/`
Population-level strategy research and adversarial robustness.

Proposed modules:
- `leagueRegistry.ts`
- `agentRole.ts`
- `matchmaker.ts`
- `exploiter.ts`
- `frozenChampionArchive.ts`
- `leagueScore.ts`

The league may promote research candidates but cannot grant LIVE authority.

### `apps/desktop/src/counterfactual/`
Alternative-decision evaluation.

Proposed modules:
- `branchPolicy.ts`
- `counterfactualBranchEngine.ts`
- `decisionRegret.ts`
- `opportunityCost.ts`

Counterfactuals must use feasible execution assumptions.

### `apps/desktop/src/decision/`
Selects whether to act after combining forecast, uncertainty, regime, cost, and strategy-health evidence.

Proposed modules:
- `decisionContract.ts`
- `abstentionGate.ts`
- `metaDecisionEngine.ts`
- `decisionEvidence.ts`

Valid output includes ABSTAIN.

### `apps/desktop/src/research/`
Scientific validity and strategy-search integrity.

Existing deterministic research/backtest/walk-forward capabilities should migrate or be wrapped here without duplicating engines.

Proposed additions:
- `trialLedger.ts`
- `searchAdjustedMetrics.ts`
- `purgedValidation.ts`
- `combinatorialValidation.ts`
- `placeboBaselines.ts`
- `regimeSliceEvaluator.ts`
- `robustnessBattery.ts`
- `benchmarkScorecard.ts`

Existing `cloud/researchDataset.ts`, backtest and walk-forward engines should be reused behind this boundary until an explicit migration is justified.

### `apps/desktop/src/execution-sim/`
Execution digital twin.

Proposed modules:
- `executionModel.ts`
- `ghostExecution.ts`
- `marketReplay.ts`
- `lobSimulator.ts`
- `impactModel.ts`
- `fillModel.ts`
- `executionCalibration.ts`

This boundary must have no private/live credential dependency in research mode.

### `apps/desktop/src/portfolio/`
Portfolio-level allocation across strategies and assets.

Proposed modules:
- `allocationRequest.ts`
- `capitalAuction.ts`
- `robustAllocator.ts`
- `riskBudget.ts`
- `correlationGuard.ts`
- `drawdownDeRisker.ts`
- `cashAllocator.ts`

Strategy modules request risk/capital. They do not assign themselves capital.

### `apps/desktop/src/risk/`
Independent hard limits and risk constitution.

Existing risk components remain authoritative. New intelligence may feed observations but cannot relax hard limits.

Proposed additions only when absent:
- `staleDataGuard.ts`
- `executionAnomalyGuard.ts`
- `strategyQuarantine.ts`

### `apps/desktop/src/evidence/`
Durable, provider-independent research and decision memory.

Proposed modules:
- `evidenceEnvelope.ts`
- `researchTrialStore.ts`
- `decisionLedger.ts`
- `counterfactualLedger.ts`
- `modelHealthHistory.ts`
- `promotionEvidence.ts`

### `apps/desktop/src/ai/`
AI reasoning remains an advisory/research capability.

AI may:
- generate research hypotheses
- propose challenger configurations
- explain disagreement
- summarize evidence
- prioritize experiments

AI may not:
- bypass `decision/abstentionGate`
- bypass `portfolio/`
- relax `risk/`
- create LIVE authority
- mutate broker credentials

## Runtime flow

```text
MARKET SOURCES
  -> Market State Fabric
  -> Regime & Shift Observatory
  -> Forecast Guild
  -> NUSA League / Strategy Candidates
  -> Uncertainty & Abstention Gate
  -> Portfolio Allocator
  -> Risk Constitution
  -> Execution Digital Twin (research/ghost/replay/paper)
  -> Evidence Memory

Counterfactual Branch Engine observes the decision path and evaluates bounded alternatives.
Research Integrity Kernel audits every candidate and promotion decision.
```

## Separation rules

1. Forecast code does not import broker mutation APIs.
2. League/research code does not import LIVE credential providers.
3. Portfolio allocation cannot weaken hard risk rules.
4. Risk code is deterministic and independently testable.
5. All time-sensitive features carry observed-at timestamps.
6. All research trials receive stable IDs before result inspection.
7. All promotion evidence includes source SHA, dataset hash, search-count context, cost model, and OOS protocol.
8. UI renders evidence and state but never becomes the authority source.

## Migration policy

Do not perform a big-bang rewrite.

New modules are introduced as wrappers/adapters around proven current components, then old paths are retired only after parity tests pass. The current PAPER runtime remains operational scaffolding while Ghost/Replay/Execution-Digital-Twin capability is added alongside it.
