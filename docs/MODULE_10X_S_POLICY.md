# NUSA 10X-S Module Policy

## Purpose

`10X-S` is the single highest NUSA module tier. No `SS`, `SSS`, `11`, or `12` tier is defined. A better candidate replaces the incumbent at the same `10X-S` tier after evidence-gated comparison.

## Tier model

- `LEVEL_10`: canonical, deterministic, typed, fail-closed, observable, recoverable, tested, and architecture-validated.
- `10X`: Level 10 plus self-diagnostics, rollback readiness, and evidence-based promotion support.
- `10X-S`: 10X plus shadow comparability, regression guarding, automatic quarantine capability, and continuous evidence that the module remains the best validated candidate.

A tier is not a permanent label. Evidence loss or regression demotes the effective tier. Safety-boundary failure, loss of the last-known-good rollback reference, or failure of the Level 10 baseline quarantines the module.

## Mandatory 10X-S capabilities

Every canonical stage targets all of the following:

1. `SELF_DIAGNOSTIC`
2. `SHADOW_COMPARABLE`
3. `REGRESSION_GUARDED`
4. `AUTO_QUARANTINE`
5. `ROLLBACK_READY`
6. `EVIDENCE_PROMOTION`

Promotion and retention at `10X-S` require CI/runtime evidence. Registry metadata alone cannot certify a module.

## Replacement rule

A candidate may replace the current canonical module only when it:

- preserves all safety and authority invariants;
- passes the Level 10 baseline;
- passes all 10X-S capabilities;
- is regression-free against the incumbent under the governed comparison window;
- has a valid last-known-good rollback reference;
- produces durable evidence sufficient to reproduce the promotion decision.

If the candidate fails, the incumbent remains canonical. If an active module later violates a safety-critical condition, it is quarantined and the last-known-good version is selected. This process never grants LIVE trading authority.

## Authority invariants

`10X-S` is a software-quality and resilience tier, not trading authority. PAPER/SHADOW restrictions, AI zero authority, `liveAuthority=NONE`, and `productionMutationAllowed=false` remain unchanged unless a separately approved architecture/work-order change explicitly modifies them.

## Execution boundary

The canonical execution engine must not accept a raw execution loop. It accepts only the risk-enforcing execution port, and that port executes a PAPER tick only after an independent risk decision returns `ALLOW`. A rejected or halted risk decision cannot reach order processing.

## Canonical registry

`apps/cloud/src/canonicalModuleRegistryV10.ts` retains its historical filename for API compatibility but exports `CANONICAL_MODULE_REGISTRY_10XS` as the authoritative tier target for all ten canonical stages. The prior `CANONICAL_MODULE_REGISTRY_V10` name is an alias during migration.
