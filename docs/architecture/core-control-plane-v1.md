# Core + Control Plane Architecture v1

## Decision

DOKKAEBI keeps the existing governance, committee, audit, replay, evidence, recovery and operator capabilities, but removes them from the real-time decision path.

The real-time path is fixed to seven stages:

```text
Market -> Probability -> Alpha -> Portfolio -> Risk -> Execution -> Runtime
```

The surrounding system is divided into four non-core categories:

- Control Plane: Research, Validation, Committee, Governance, Release
- Operations: Recorder, Replay, Audit, Evidence, Monitoring
- Plugins: Funding Carry, Polymarket and later strategy modules
- Applications: Desktop and Mobile operator surfaces

## Why

This preserves the safety and auditability of the existing platform without forcing committee, governance or reporting logic into every market cycle. It also provides a stable target for later file moves and dependency cleanup.

## Hard boundaries

1. Core modules cannot depend on Control Plane, Operations or Applications.
2. Committee and Governance are never part of the real-time path.
3. Operations are read-only or append-only observers of runtime state.
4. Applications cannot submit orders, change policy, promote strategies or enable LIVE trading through this topology.
5. Plugins may consume Core contracts but cannot reach Control Plane or Applications.
6. Runtime only orders stages, fails closed, records results and publishes snapshots.

## Committee triggers

Committee review occurs only for:

- strategy registration
- Champion promotion request
- risk-limit change request
- Paper-to-Shadow request
- post-incident resume request

It is not called per tick, per quote or per ordinary Paper order.

## Migration strategy

No existing implementation is deleted in this step.

1. Classify each existing module using `platformTopology.ts`.
2. Add adapters around existing modules where names or contracts differ.
3. Move files only after imports are covered by dependency tests.
4. Consolidate duplicate snapshots and audit models after the boundary is stable.
5. Preserve PAPER/DRY_RUN-only behavior throughout the migration.

## Validation

`tests/platform-topology.test.js` protects:

- the seven-stage pipeline order
- Committee/Governance exclusion from the real-time path
- forbidden Core-to-Control dependencies
- immutable default topology
- stable control trigger semantics
