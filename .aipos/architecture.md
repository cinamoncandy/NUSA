# NUSA Architecture Contract

## Mission

NUSA is the product. AIPOS is the repository contract that allows any capable AI to recover project context and continue NUSA implementation without relying on prior chat history.

## Current implementation

- Language: TypeScript
- Runtime target: Node.js 24+
- Package manager: pnpm 11+
- Desktop application: Electron
- Core runtime: `packages/core/src`
- AIPOS runtime package: `packages/aipos/src`

## Runtime boundaries

The existing NUSA runtime owns:

- typed event publication
- service registration and resolution
- engine lifecycle and dependency ordering
- plugin registration, loading, rollback, and disposal

AIPOS integrates through that runtime. It must not create a parallel kernel, plugin system, service container, or lifecycle framework.

## AIPOS responsibilities

AIPOS provides:

- repository-readable project state
- explicit work orders
- durable architectural decisions
- deterministic recovery guidance
- semantic validation of project metadata

The TypeScript package may expose runtime APIs, but `.aipos/` remains the cross-AI source of truth.

## Dependency direction

```text
NUSA application
  -> NUSA core runtime
  -> AIPOS plugin/services
  -> repository metadata under .aipos/
```

AIPOS is implemented for NUSA first. Standalone CLI, certification, plugin marketplaces, and unrelated generic features are out of scope until NUSA requires them.

## Safety invariants

- Paper trading remains the default and authoritative execution mode.
- Read-only authenticated exchange access must not imply mutation authority.
- Live order mutation remains disabled unless a separately approved work order explicitly changes the boundary.
- Missing, malformed, or contradictory safety state must fail closed.
- Recovery selection must be deterministic for the same repository state.
