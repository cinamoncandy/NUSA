# NUSA Circular Dependency Report

Audited: 2026-08-22

## Runtime cycles

| Cycle |
|---|
| None |

## Type-only cycles

| Cycle |
|---|
| packages/contracts/src/researchHardening.ts -> packages/contracts/src/researchRuntime.ts -> packages/contracts/src/researchHardening.ts |
| packages/storage/src/index.ts -> packages/storage/src/risk-safety.ts -> packages/storage/src/index.ts |
