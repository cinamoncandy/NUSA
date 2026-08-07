# NUSA User Experience Principle

## Status

This document is a normative NUSA architecture principle. It defines how NUSA must expose increasingly sophisticated investment, AI, safety, research, and execution capabilities without transferring internal system complexity to the user.

It is subordinate to `docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md` and must be interpreted consistently with the NUSA Safety Constitution.

## Principle

NUSA may become internally sophisticated, but ordinary use must remain understandable without requiring the user to understand its internal agent, model, risk, evidence, or orchestration architecture.

> Internal complexity must not leak into user complexity.

Safety-critical truth must never be hidden for simplicity, but implementation detail should be progressively disclosed only when it helps the user make a decision.

## 1. Default Experience

The default experience is designed for a non-engineer.

A user should be able to understand, at a glance:

- current assets and performance;
- whether NUSA is operating normally;
- whether trading is PAPER or LIVE-capable;
- whether new risk can currently be taken;
- what strategy or investment intent is active;
- why an action was blocked when relevant;
- what action, if any, the user should take next.

Internal service names, model identifiers, gate names, evidence schemas, and agent topology are advanced details, not default navigation concepts.

## 2. Progressive Disclosure

NUSA uses progressive disclosure.

Default surfaces show task-level meaning. Advanced surfaces may expose:

- risk decision details;
- assumptions and uncertainty;
- financial reasoning;
- model, prompt, strategy, tool, policy, and data versions;
- evidence and provenance;
- logs and operational diagnostics;
- architecture and agent-level detail.

Advanced evidence must remain available without forcing every user to read it.

## 3. Action Language

User-facing language should describe state and action before implementation terminology.

Prefer meanings such as:

- "Order allowed"
- "Blocked by risk limit"
- "Approval required"
- "Market data unavailable"
- "Trading paused"

rather than exposing internal enum or service names as the primary explanation.

Technical identifiers may appear in expandable diagnostic detail.

## 4. PAPER / LIVE Separation

PAPER and LIVE-capable operation must not be differentiated only by a subtle color or small badge.

The UI must make the execution authority unmistakable through clear state, wording, confirmation, and safety boundaries.

LIVE activation or other high-impact authority changes require deliberately different interaction semantics from ordinary PAPER actions.

No UI simplification may make LIVE authority ambiguous.

## 5. Safety UX

The user must be able to distinguish:

- real kill-switch state;
- recent risk rejection;
- degraded/unknown system health;
- required human approval;
- trading mode.

A risk rejection must not be presented as kill-switch activation, and a healthy-looking dashboard must not hide UNKNOWN or fail-closed state.

Safety state must be simple to understand but semantically faithful to the authoritative backend state.

## 6. Error UX

For recoverable failures, the primary message should answer:

1. What happened?
2. What did NUSA do to remain safe?
3. What can the user do next?

Raw stack traces and internal errors belong in diagnostics, not as the primary user experience.

If the correct next action is no action, NUSA should say so rather than inventing remediation.

## 7. Interaction Budget

Frequent, low-risk user tasks should normally complete within a small number of deliberate interactions.

Additional confirmation is justified when it meaningfully protects money, authority, credentials, irreversible state, or safety boundaries.

NUSA must not optimize click count by weakening safety controls.

## 8. Explainability Without Overload

NUSA should summarize investment and AI conclusions in layers:

1. conclusion / current state;
2. key reason;
3. confidence or uncertainty when relevant;
4. advanced evidence and provenance on demand.

The system must not reduce complex uncertainty to fake certainty merely to make the UI look simple.

## 9. Consistency Across Clients

Desktop, mobile, cloud, and future clients should preserve the same semantic meaning for critical states even when layouts differ.

In particular, PAPER/LIVE authority, kill switch, risk blocking, approval requirements, system health, and investment intent must not acquire different meanings between clients.

## 10. Accessibility and Internationalization

User-facing architecture should permit accessible interaction, readable information hierarchy, keyboard/screen-reader-compatible controls where supported, and localization without changing safety semantics.

Critical safety labels must not depend solely on color.

## 11. Replaceability

The UX layer may evolve radically without changing the underlying authority model.

UI frameworks, client technologies, visualization systems, and AI conversational interfaces are replaceable implementations behind stable product semantics and backend capability contracts.

The UI is never itself the source of truth for approvals, risk state, kill-switch state, trading authority, or durable investment state.

## 12. UI Complexity Gate

Every significant user-facing Work Order must answer:

1. What user task becomes easier or newly possible?
2. Which new concepts are exposed to the user, and are they necessary?
3. Can the default path remain understandable without internal architecture knowledge?
4. Are advanced details progressively disclosed?
5. Are PAPER and LIVE authority unmistakably distinct?
6. Does the UI faithfully represent authoritative risk, kill-switch, approval, and health state?
7. Is the common task achievable with a reasonable number of deliberate interactions?
8. Are errors actionable without exposing raw implementation detail first?
9. Does simplification preserve uncertainty and safety truth?
10. Are semantics consistent across clients?

A feature is not UX-complete merely because all backend controls are technically reachable.

## Definition of Done

NUSA's UI is successful when a new user can perform ordinary safe tasks without studying the internal architecture, while an expert can inspect progressively deeper evidence and controls without losing semantic accuracy or safety boundaries.
