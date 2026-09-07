# NUSA Circular Dependency Report

Audited: 2026-09-04

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
| apps/mobile/src/localPaperLearningProjection.ts -> apps/mobile/src/paperLearningScreen.ts -> apps/mobile/src/localPaperLearningProjection.ts |
