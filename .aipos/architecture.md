# NUSA Architecture Contract

## Mission

NUSA is the product. AIPOS is the repository contract that allows any capable AI to recover project context and continue NUSA implementation without relying on prior chat history, hidden model state, or a specific AI vendor.

AIPOS must remain compatible with NUSA's permanent core principle: future technologies should be safely absorbed, evaluated, replaced, upgraded, combined, retired, and rolled back without forcing a redesign of the stable system skeleton.

## Architecture authority

The design source of truth is the approved NUSA architecture, led by:

- `docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md`
- `docs/NUSA_AI_ARCHITECTURE_V1.md`
- `docs/NUSA_INVESTMENT_KNOWLEDGE_PRINCIPLE.md`
- `docs/NUSA_USER_EXPERIENCE_PRINCIPLE.md`
- durable architecture decisions under `.aipos/decisions/`

AIPOS is the execution-plan and execution-state source of truth. It must synchronize implementation planning with approved architecture, but it must not silently redefine architecture.

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

- repository-readable project state;
- explicit work orders;
- durable architectural decisions;
- deterministic recovery guidance;
- semantic validation of project metadata;
- architecture-to-execution synchronization;
- cross-AI handoff continuity;
- durable evidence references for completion and recovery.

Investment-related execution planning must preserve the governed distinction between Foundational Knowledge, Market Knowledge, and Learned Knowledge defined by `docs/NUSA_INVESTMENT_KNOWLEDGE_PRINCIPLE.md`. Financial knowledge is not trading authority, and learned investment intelligence may not weaken independent safety or deployment controls.

User-facing execution planning must preserve the semantics defined by `docs/NUSA_USER_EXPERIENCE_PRINCIPLE.md`: internal complexity should be progressively disclosed rather than leaked into ordinary workflows, while PAPER/LIVE authority, kill-switch state, risk decisions, approvals, uncertainty, and system health must remain semantically accurate.

The TypeScript package may expose runtime APIs, but `.aipos/` remains the cross-AI execution-state source of truth.

## Cross-AI continuity

Any capable AI or agent must be able to take over active NUSA work by reading repository state and following `.aipos/AI_HANDOFF_CONTRACT.md`.

Conversation history, model memory, provider-private context, and hidden chain-of-thought are never required project dependencies.

Different AI systems may reason differently internally, but they must recover the same authoritative objective, constraints, active work order, safety boundaries, evidence requirements, financial reasoning constraints where applicable, user-facing safety semantics where applicable, and next permitted action from the repository contract.

## Architecture-to-AIPOS synchronization

When approved architecture changes materially affect capabilities, dependencies, safety boundaries, interfaces, validation requirements, investment-knowledge contracts, user-facing product semantics, or implementation order, AIPOS must run an impact analysis and synchronize the affected execution metadata.

Synchronization may update:

- work-order creation, modification, supersession, or retirement;
- dependency graph;
- priorities;
- acceptance criteria;
- architecture references and versions;
- migration and compatibility requirements;
- state and next permitted action.

The direction is authoritative architecture -> AIPOS execution plan. AIPOS may record or propose architecture changes, but may not silently mutate architecture in the reverse direction.

## Dependency direction

```text
NUSA architecture / constitution
  -> AIPOS execution contract and state
  -> NUSA application planning
  -> NUSA core runtime
  -> AIPOS plugin/services
  -> repository metadata under .aipos/
```

AIPOS is implemented for NUSA first. Standalone CLI, certification, plugin marketplaces, and unrelated generic features are out of scope until NUSA requires them.

## Safety invariants

- Paper trading remains the default and authoritative execution mode.
- Read-only authenticated exchange access must not imply mutation authority.
- Live order mutation remains disabled unless a separately approved work order explicitly changes the boundary.
- Missing, malformed, contradictory, or stale critical safety state must fail closed.
- Recovery selection must be deterministic for the same authoritative repository state.
- Work completion requires durable evidence, not a conversational assertion.
- AI replacement or handoff must never weaken Risk Governor, Deployment Gate, evidence, approval, or kill-switch boundaries.
- Learned investment knowledge must never silently redefine hard financial safety constraints or become production authority by itself.
- UI simplification must never hide or change authoritative trading mode, approval, risk, kill-switch, uncertainty, or health semantics.
