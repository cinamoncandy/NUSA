# Pipeline → Code Map

The canonical pipeline (`README.md`, `nusa.md`):

```
Market Data → Intelligence → Strategy → Decision → Risk → Portfolio → Execution → Paper Adapter → Review → Memory
```

The highest NUSA module tier is `10X-S`. The base module contract is defined by
`apps/cloud/src/moduleLevel10.ts`, certification by `apps/cloud/src/module10XS.ts`,
and the governed canonical/runtime mapping by `apps/cloud/src/moduleRuntimeManifest10XS.ts`.
`apps/cloud/src/canonicalModuleRegistryV10.ts` keeps its historical filename/API alias but its
authoritative export is `CANONICAL_MODULE_REGISTRY_10XS`.

The runtime manifest deliberately distinguishes a canonical module from the concrete composition
point that invokes or binds it. This prevents registry/runtime drift from being hidden behind a
single path. Each stage owns its own last-known-good reference and evidence collection.

| Stage | 10X-S canonical entrypoint | Cloud PAPER runtime binding |
|-------|----------------------------|-----------------------------|
| Market Data | `packages/core/src/upbitWebSocket.ts` | `apps/cloud/src/upbitWebSocket.ts` |
| Intelligence | `apps/cloud/src/intelligenceEngineV10.ts` | `apps/cloud/src/cloudRuntimeDashboardHydrator.ts` |
| Strategy | `packages/core/src/strategyEngine.ts` | `apps/cloud/src/paperCandidateStrategy.ts` |
| Decision | `apps/cloud/src/cioDecisionEngine.ts` | `apps/cloud/src/cioDecisionEngine.ts` |
| Risk | `apps/cloud/src/cloudPaperCanonicalRiskGateway.ts` | `apps/cloud/src/cloudPaperExecutionBoundary.ts` |
| Portfolio | `apps/cloud/src/portfolioEngineV10.ts` | `apps/cloud/src/cloudRuntimeDashboardHydrator.ts` |
| Execution | `apps/cloud/src/cloudPaperExecutionBoundary.ts` | `apps/cloud/src/runtime.ts` |
| Paper Adapter | `apps/cloud/src/paperTradingExecutionLoop.ts` | `apps/cloud/src/cloudPaperExecutionBoundary.ts` |
| Review | `apps/cloud/src/paperLearningObservability.ts` | `apps/cloud/src/runtime.ts` |
| Memory | `packages/storage/src/memoryEngineV10.ts` | `packages/storage/src/evolutionLearningLedger.ts` |

## Runtime truth

`cloudRuntimeDashboardHydrator.ts` must route intelligence and portfolio composition through
`runIntelligenceEngineV10` and `runPortfolioEngineV10`; direct calls to the lower-level fusion or
portfolio-plan builders are architecture drift. `moduleRuntimeManifest10XS.test.ts` enforces this.

The only Cloud PAPER strategy-mutation path is:

```
runtime.ts
  → CloudPaperExecutionBoundary
    → CloudPaperCanonicalRiskGateway
      → PaperTradingExecutionLoop
```

The execution boundary requires PAPER-only challenger provenance, P0 safety, health/allocation
checks, and canonical risk `ALLOW` before mutation. Review and learning observations are downstream
only and cannot submit orders.

## 10X-S certification

A module is not `10X-S` because registry metadata says so. Certification requires:

- the complete Level-10 baseline;
- intact safety boundary;
- all six 10X-S capabilities;
- valid stage-scoped evidence references;
- valid source commit and evidence fingerprint;
- deterministic replay success;
- shadow-comparison success;
- recovery-drill success;
- regression-budget success;
- a valid stage-scoped last-known-good commit.

Any identity/safety failure quarantines the module. Operational regression demotes it. Candidate
replacement is governed by `moduleReplacementPolicy10XS.ts`: a challenger is selected only when it
is independently `10X-S` certified and proven better; a quarantined incumbent selects its stage LKG.
The policy is selection-only and never grants production-mutation or LIVE trading authority.

## Authority invariants

- Strategy emits signals/decisions; broker mutation remains behind canonical execution/risk boundaries.
- Risk may reject or halt any PAPER intent.
- PAPER and LIVE adapters never share mutable operating state.
- AI remains advisory / zero-authority.
- `productionMutationAllowed=false` remains invariant for module governance and certification.
- Fail closed on uncertainty.

## Non-stages

- `apps/autopilot/` — audit/coding evidence automation, not part of the trading pipeline.
- `services/upbit-readonly/` — localhost-only read-only observation bridge.
- `services/nusa-mcp/` — constrained local MCP surface.
