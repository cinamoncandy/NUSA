# Plugin Capability Narrowing Migration

**Status:** REQUIRED FOLLOW-UP / NON-BLOCKING FOR CURRENT PAPER-ONLY HOLD  
**Authority:** Subordinate to `NUSA_CANONICAL_ARCHITECTURE_V2.md`  
**Priority:** P1 architecture hardening

## 1. Problem

The current Core plugin API exposes the full `EngineRegistry` and `ServiceContainer` through `PluginContext`.

`ServiceContainer` supports unrestricted key-based `resolve`, `register`, and `replace`, so a plugin that receives the raw container has a wider technical capability surface than the canonical rule requires.

No current broker-mutation bypass or production-authority abuse has been proven from this exposure. The risk is architectural: a future plugin could accidentally or intentionally reach services outside its approved capability contract.

## 2. Canonical target

A plugin is an implementation extension, never an authority extension.

Future plugin contexts MUST expose only explicit capability-scoped interfaces required by the plugin declaration. A plugin MUST NOT receive a generic mutable service locator capable of discovering or replacing unrelated runtime services.

The target shape is capability-oriented, for example:

- declared capability IDs and versions;
- explicit read interfaces;
- explicit event publication interfaces;
- explicit engine registration interface where required;
- no generic service replacement;
- no direct broker/exchange mutation interface outside the Execution Boundary;
- no direct Risk, Deployment, policy, application, or secret-store authority unless separately defined by an approved contract.

## 3. Migration constraints

This migration must be behavior-preserving and incremental.

Do not perform a flag-day rewrite. Do not weaken PAPER-only, Risk, Execution Boundary, deployment, credential, or physical-device gates while migrating.

Recommended sequence:

1. Inventory every current plugin and the exact services/engines it consumes.
2. Define a `PluginCapabilityContext` composed only of approved interfaces.
3. Introduce read-only/scoped adapters around required Core services.
4. Remove generic `ServiceContainer.replace` and unrestricted `resolve` from plugin-visible context.
5. Add static and runtime tests proving plugins cannot access undeclared services.
6. Add a guard proving plugins cannot call broker mutation outside the governed Execution Boundary.
7. Migrate plugins one by one while preserving exact behavior.
8. Retire the legacy broad `PluginContext` only after all consumers are migrated.

## 4. Acceptance criteria

This migration is complete only when:

- every plugin declares its capability dependencies;
- plugin-visible interfaces are least-privilege and explicit;
- undeclared service access fails closed;
- plugins cannot replace arbitrary runtime services;
- plugins cannot directly reach application internals;
- plugins cannot create a second execution path;
- Risk and Deployment Authority remain independent and unavoidable;
- exact-head architecture tests, full CI, and safety workflows PASS.

## 5. Current classification

Current classification: **P1 architecture debt, not a demonstrated P0 exploit**.

Reasoning:

- the broad context exists;
- unrestricted service lookup/replacement is technically possible through the raw container;
- no current production plugin misuse or broker-mutation bypass has been established;
- narrowing the runtime API during the active #371 serialization/HOLD would create unnecessary cross-cutting risk.

Therefore the correct current action is to record and guard the migration target, then implement it in a separately serialized runtime hardening change.
