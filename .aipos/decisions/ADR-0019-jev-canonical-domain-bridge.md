# ADR-0019: Canonical Jev Domain Observation Bridge

- Status: Accepted
- Date: 2026-09-29
- Scope: ZERO_AUTHORITY Jev SHADOW observations for Autopilot and Research Intelligence

## Context

NUSA has one canonical Jev task-policy registry covering all planned domains, but only
the Autopilot workflow-failure and Research Intelligence attention contracts currently
have deterministic decision validators and runtime consumers. Their receipts have
different shapes, which prevents a common read-only provenance view without creating
domain-specific stores or routing authority.

## Decision

Project the two validated existing receipt contracts into the existing
`JevDomainObservation` envelope at their current call sites. The bridge is metadata
only: no new provider transport, scheduler, queue, evidence store, decision authority,
Audit/Release authority, or trading capability is added. All observations remain
`SHADOW`, `usableForRouting=false`, `liveAuthority=NONE`,
`productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.

The remaining registered domains stay deliberately non-emitting until each receives a
domain-owned deterministic decision validator and a separately accepted work order.

## Consequences

- Autopilot and Research receipts become comparable through one bounded, secret-safe
  provenance envelope.
- The registry remains the sole cross-domain Jev policy authority.
- A model result remains analysis only and cannot authorize code, Audit, Release,
  merge, PAPER actions, or LIVE actions.
