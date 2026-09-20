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

## 13. Living System Surface

NUSA should look and behave like a live investment intelligence system, not a collection of generic application cards.

The default visual hierarchy should prioritize actual system state, market structure, judgment, risk, portfolio outcome, and verified progress. Containers are secondary. Data, state transitions, and decision-relevant change are the visual subject.

### 13.1 Visual hierarchy

Prefer:

- near-black / low-luminance canvas;
- restrained borders and quiet containers;
- dense but legible information hierarchy;
- strong numeric typography with tabular figures for financial values;
- compact labels and aligned metrics;
- a small semantic accent palette rather than decorative color;
- terrain, signal, evidence, risk, progress, and time-series primitives as first-class visuals.

Avoid:

- generic fintech or SaaS card stacks;
- oversized rounded containers that dominate the information;
- decorative gradients or glow without semantic meaning;
- empty hero areas that displace decision-relevant state;
- visual chrome that makes NUSA look like settings or infrastructure software.

### 13.2 Semantic color

Color should compress meaning, not decorate empty space.

Where compatible with the active product theme, reserve distinct accent families for semantic states such as:

- verified positive / healthy;
- attention / risk;
- AI reasoning / research;
- blocked / loss / failure;
- system / runtime state.

Critical meaning must never depend on color alone, and no palette rule may fabricate financial meaning.

### 13.3 Motion equals state change

Motion should primarily communicate truthful state transition.

Good motion includes:

- a real progress value changing;
- a pipeline stage advancing;
- a metric updating from authoritative data;
- a task moving from running to verified;
- evidence converging into a decision state;
- a chart or terrain updating from new market data.

Decorative perpetual motion, fake intelligence animation, particle theatre, or activity that implies work when no verified state changed should be avoided.

### 13.4 Mobile translation of dense systems

NUSA may use high-density terminal-like information architecture, but mobile must not be a desktop canvas scaled down.

On Galaxy-class portrait layouts:

1. show the dominant financial/system outcome first;
2. surface market and AI judgment next;
3. expose portfolio/risk and active-system state in compact aligned blocks;
4. push deeper evidence, provenance, logs, and operational detail behind progressive disclosure;
5. preserve touch ergonomics, readable type, and truthful fold behavior.

Density is valuable only when hierarchy remains immediately understandable.

### 13.5 Canonical screen composition

For major mobile surfaces, prefer a composition in which:

- the first viewport communicates NUSA's investment-intelligence identity immediately;
- one or two live data/judgment visualizations are the visual hero;
- compact metrics support the hero rather than competing with it;
- operational notices remain secondary unless they are safety-critical;
- missing evidence renders as UNKNOWN / UNAVAILABLE rather than synthetic completion.

### 13.6 Design acceptance

A user-facing implementation is not visually complete merely because it is functional or technically polished.

For major Android surfaces:

- compare the result against the current OWNER-approved MASTER VISUAL REFERENCE;
- reject generic template-like composition even if CI passes;
- prefer a small number of coherent, high-quality primitives over many inconsistent widgets;
- validate the exact APK on a physical Galaxy for typography, spacing, density, contrast, navigation balance, touch ergonomics, and fold behavior;
- treat actual-device visual acceptance as separate from code and CI acceptance.

`Code PASS != Design PASS`
`CI PASS != Product PASS`
`Feature complete != visually complete`

### 13.7 Dense operational modules

NUSA may use compact operational modules to expose multiple subsystems at once when doing so improves situational awareness.

Good candidates include AI judgment, Market, Risk, PAPER, Research, Autopilot, Strategy, Portfolio, and Performance. Each module should compress a small set of authoritative values such as current state, one dominant metric, progress or verification state, and the next material change.

Use this pattern to increase information density without turning the interface into a game HUD.

Absorb:

- compact multi-module status composition;
- clear boundaries between concurrent subsystems;
- aligned numeric summaries;
- visible progress and verification state;
- side-by-side economic and operational outcomes;
- live state changes that make the system feel active because the underlying state is active.

Do not absorb:

- pixel or retro-game typography;
- decorative hacker-console aesthetics;
- excessive neon;
- tiny unreadable text used only to create density;
- fake counters, fake progress, fake speedups, or synthetic activity;
- visual noise that competes with financial judgment or risk.

The preferred result is an institutional-grade AI investment terminal, not a game interface.

## Definition of Done

NUSA's UI is successful when a new user can perform ordinary safe tasks without studying the internal architecture, while an expert can inspect progressively deeper evidence and controls without losing semantic accuracy or safety boundaries.
