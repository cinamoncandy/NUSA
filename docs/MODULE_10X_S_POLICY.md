# NUSA 10X-S Module Policy

## Purpose

`10X-S` is the single highest NUSA module tier. No `SS`, `SSS`, `11`, or `12` tier is defined. A better candidate replaces the incumbent at the same `10X-S` tier after evidence-gated comparison.

## Tier model

- `LEVEL_10`: canonical, deterministic, typed, fail-closed, observable, recoverable, tested, and architecture-validated.
- `10X`: Level 10 plus self-diagnostics, rollback readiness, and evidence-based promotion support.
- `10X-S`: 10X plus shadow comparability, regression guarding, automatic quarantine capability, recovery evidence, and continuous proof that the module remains the best validated candidate.

A tier is not permanent. Evidence loss or regression demotes the effective tier. Safety-boundary failure, invalid evidence identity, invalid last-known-good state, or failure of the Level 10 baseline quarantines the module.

## Mandatory 10X-S capabilities

Every canonical stage targets all of the following:

1. `SELF_DIAGNOSTIC`
2. `SHADOW_COMPARABLE`
3. `REGRESSION_GUARDED`
4. `AUTO_QUARANTINE`
5. `ROLLBACK_READY`
6. `EVIDENCE_PROMOTION`

Registry metadata is only a requirement declaration. It cannot certify a module by itself.

## Operational certification evidence

`evaluateTenXSCertification` requires a valid source commit, a deterministic evidence fingerprint,
deterministic-replay success, shadow-comparison success, recovery-drill success, regression-budget
success, an intact safety boundary, the Level-10 baseline and stage-scoped evidence references.
Certification is therefore based on an evidence snapshot rather than a permanent label.

## Runtime truth

`apps/cloud/src/moduleRuntimeManifest10XS.ts` is the authoritative map from each canonical module to
the concrete Cloud PAPER runtime binding. Canonical and runtime entrypoints are stored separately so
architecture drift is visible instead of being hidden behind a single path. Each stage owns a
separate evidence collection and last-known-good reference, even when several stages currently share
the same known-good release commit.

`apps/cloud/src/moduleRuntimeManifest10XS.test.ts` verifies the binding files and critical composition
rules, including canonical Intelligence/Portfolio facades and the PAPER Risk → Execution boundary.

## Replacement and rollback

`apps/cloud/src/moduleReplacementPolicy10XS.ts` governs module selection. A candidate can replace the
incumbent only when it is independently `10X-S` certified and the governed challenger comparison says
`BETTER`. `UNVERIFIED`, `NOT_BETTER`, demoted or quarantined candidates cannot replace the incumbent.
If the incumbent is quarantined, the stage-specific last-known-good ref is selected.

This policy is selection-only. It does not dynamically download code, mutate production, enable LIVE
trading, or bypass the normal deployment and review path.

## Authority invariants

`10X-S` is a software-quality and resilience tier, not trading authority. PAPER/SHADOW restrictions,
AI zero authority, `liveAuthority=NONE`, and `productionMutationAllowed=false` remain unchanged.

## Cloud PAPER execution boundary

The canonical Cloud PAPER execution path is:

```
runtime.ts
  → CloudPaperExecutionBoundary
    → CloudPaperCanonicalRiskGateway
      → PaperTradingExecutionLoop
```

Actionable strategy ticks cannot reach the simulator mutation path until challenger provenance,
allocation/health/P0 checks and canonical risk approval succeed. A rejected or halted risk decision
cannot reach order processing.

## Canonical registry

`apps/cloud/src/canonicalModuleRegistryV10.ts` retains its historical filename for API compatibility
but exports `CANONICAL_MODULE_REGISTRY_10XS` as the authoritative tier target for all ten stages. The
registry consumes the runtime manifest instead of maintaining a second, drifting path table.
