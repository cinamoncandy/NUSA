# NUSA Architecture Index

This directory contains NUSA architecture specifications.

## Precedence

Architecture documents are interpreted in this order:

1. `../NUSA_CORE_ARCHITECTURE_PRINCIPLE.md` — permanent core principle and safety-oriented architecture constraints.
2. `NUSA_CANONICAL_ARCHITECTURE_V2.md` — whole-system canonical architecture and conflict-resolution authority.
3. `core-control-plane-v1.md` — detailed seven-stage real-time fast-path topology.
4. `../NUSA_AI_ARCHITECTURE_V1.md` — detailed AI/research/evolution capability taxonomy, interpreted through the canonical plane mapping.
5. `USER_ACCESS_APPROVAL_ARCHITECTURE.md` — required operator-controlled user admission architecture; authentication alone never grants system use.
6. `reliability.md`, `paper-to-live-readiness-plan.md`, `ensemble-consensus-decision.md` — domain-specific subordinate specifications.

If a subordinate document appears to conflict with the canonical architecture, preserve the stronger safety boundary and follow `NUSA_CANONICAL_ARCHITECTURE_V2.md` until the subordinate document is explicitly reconciled.

## Canonical real-time spine

`Market -> Probability -> Alpha -> Portfolio -> Risk -> Execution -> Runtime`

Committee, governance, research, validation, Meta-AI, learning, audit, applications, and release management remain outside the synchronous market-decision spine.

## Required migrations

Architecture hardening that is intentionally deferred from an active serialized change must be recorded here rather than left as informal debt.

- `PLUGIN_CAPABILITY_NARROWING_MIGRATION.md` — narrow plugin-visible Core authority from the current broad service-locator context to explicit capability-scoped interfaces. Classified P1; implement as a separately serialized runtime hardening change.
- `USER_ACCESS_APPROVAL_ARCHITECTURE.md` — introduce server-authoritative, operator-controlled user admission. Current mobile `SIGNED_IN` state is authentication only and must never be interpreted as approval to use protected NUSA capabilities.

## Architecture review rule

Every significant Work Order must identify:

- plane;
- capability contract;
- authority level;
- state owner;
- failure semantics;
- evidence/provenance;
- Risk and Deployment Gate effects;
- rollback path;
- architecture guard tests.

Implementation completeness does not imply architecture compliance.
