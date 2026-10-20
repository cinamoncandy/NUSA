# NUSA Circular Dependency Report

Audited: 2026-10-20

## Runtime cycles

| Cycle |
|---|
| None |

## Type-only cycles

| Cycle |
|---|
| packages/contracts/src/researchHardening.ts -> packages/contracts/src/researchRuntime.ts -> packages/contracts/src/researchHardening.ts |
| packages/storage/src/index.ts -> packages/storage/src/risk-safety.ts -> packages/storage/src/index.ts |
| packages/storage/src/index.ts -> packages/storage/src/persistedPaperPeriodStore.ts -> packages/storage/src/index.ts |
| packages/storage/src/index.ts -> packages/storage/src/paperMarketObservationRepository.ts -> packages/storage/src/index.ts |
| packages/storage/src/index.ts -> packages/storage/src/researchCandleStore.ts -> packages/storage/src/index.ts |
| packages/storage/src/index.ts -> packages/storage/src/researchDatasetManifest.ts -> packages/storage/src/index.ts |
| packages/storage/src/futuresPublicStore.ts -> packages/storage/src/index.ts -> packages/storage/src/futuresPublicStore.ts |
| packages/storage/src/index.ts -> packages/storage/src/marketMicrostructureStore.ts -> packages/storage/src/index.ts |
| packages/storage/src/index.ts -> packages/storage/src/researchHoldoutLedger.ts -> packages/storage/src/index.ts |
| apps/cloud/src/paperAccountingLedger.ts -> apps/cloud/src/paperTradingExecutionLoop.ts -> apps/cloud/src/paperAccountingLedger.ts |
| apps/cloud/src/paperExecutionIntent.ts -> apps/cloud/src/paperTradingExecutionLoop.ts -> apps/cloud/src/paperExecutionIntent.ts |
| apps/cloud/src/ownerBaselinePaperPeriod.ts -> apps/cloud/src/paperRealizedPeriodProducer.ts -> apps/cloud/src/ownerBaselinePaperPeriod.ts |
| apps/mobile/src/localPaperLearningProjection.ts -> apps/mobile/src/paperLearningScreen.ts -> apps/mobile/src/localPaperLearningProjection.ts |
