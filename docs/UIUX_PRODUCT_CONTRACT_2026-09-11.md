# NUSA Product UX Contract — 2026-09-11

Status: Core review required before broad implementation
Owner: UI/UX
Scope: Mobile + Desktop presentation only

## Product UX goal

NUSA is an AI trading intelligence system, not a generic brokerage dashboard. The interface must let a user understand the important truth without hunting through screens, then move to the smallest safe next action.

Primary loop:

`OBSERVE -> REASON -> DECIDE -> SIMULATE -> LEARN`

The visual product must surface AI reasoning and system truth without implying execution authority that does not exist.

## Non-negotiable authority truth

Every implementation preserves these facts unless an authoritative runtime source explicitly changes them:

- `PAPER_ONLY`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `aiAuthority=ZERO_AUTHORITY`

PAPER must never visually resemble LIVE. AI insight must never look like autonomous execution. Missing evidence must never become a success state.

## Information priority

Every primary surface uses this hierarchy:

1. Immediate judgement — what matters now.
2. Operational truth — system/data/PAPER/strategy/risk/autopilot state.
3. Decision evidence — why, counter-evidence, uncertainty, invalidation.
4. Safe next action — review, inspect, simulate, or PAPER action.
5. Detail — raw market, portfolio, history, diagnostics.

Developer diagnostics do not compete with the first viewport.

## First-glance status contract

Without opening another screen the user must be able to determine:

- System state
- Data state and freshness
- PAPER state
- Strategy state
- Risk state
- Autopilot state
- Most recent meaningful activity
- Active warning/failure
- Whether human action is required

Unknown is a first-class state. No observed data is not success.

## Primary information architecture

### Mobile

Use five destinations maximum.

- `NUSA` — current brief: decision + system truth + change since last judgement + safe next action.
- `판단` — AI decision ledger: current decisions, evidence, counter-evidence, confidence provenance, invalidation and decision history.
- `시장` — market intelligence: regime, important changes, themes and evidence; raw quotes are subordinate.
- `PAPER` — simulation/validation/action flow. PAPER identity remains persistent.
- `자산` — portfolio exposure, risk budget, PnL and position detail.

Do not create a separate generic `AI` destination: AI is the intelligence layer across NUSA. Existing route IDs may remain temporarily for compatibility, but visible IA must converge on the product jobs above after Core approval.

### Desktop

Desktop keeps higher density but uses the same user jobs and status semantics. It may expose secondary operational/diagnostic navigation progressively. Desktop must not use a contradictory product hierarchy such as making account capital the universal dominant object when current judgement or a failure requires attention.

## NUSA home / Live Brief

The first viewport answers four questions in order:

1. What is NUSA's current validated posture?
2. What changed since the previous posture?
3. What can invalidate this posture / what is the current risk?
4. Is there a safe action that needs me now?

Recommended first viewport composition:

- compact global truth rail
- one dominant `Decision Object`
- `What changed` delta
- risk / invalidation condition
- one safe next action
- portfolio impact summary only when meaningful

Do not lead with giant account value, a decorative AI object, raw quote cards, or a news feed.

## Decision Object

This is the primary reusable AI-trading UX primitive.

Required fields when evidence exists:

- stance: `BUY | HOLD | REDUCE | EXIT | NO_TRADE | OBSERVE`
- subject / scope
- horizon
- thesis
- confidence provenance (never fabricate calibrated confidence)
- evidence FOR
- evidence AGAINST
- uncertainty
- invalidation condition
- risk
- portfolio impact when calculable
- last material change
- safe next action

When fields are unavailable, show unavailable/unknown rather than generating substitute values.

## Autopilot state UX

Autopilot must distinguish at least:

- `NO_WORK` — observed successfully; no eligible work
- `READY` — work exists and is dispatchable
- `CLAIMED` — owner/lease assigned
- `RUNNING` — implementation/execution in progress
- `VALIDATING` — verification in progress
- `BLOCKED` — work exists but cannot progress; blocker required
- `HUMAN_ONLY` — explicit human action required
- `FAILED` — execution/validation failed
- `STARVATION` — work exists but is not being claimed/progressed within policy
- `DONE` — latest work completed

The primary Autopilot summary must expose:

- active work yes/no
- queued work yes/no
- blocker summary
- human-only count/action
- last successful work
- last healthy run timestamp
- most recent failure reason
- automation subsystem health

Observation failure is never rendered as `0` or `NO_WORK`.

## State model

Every data-backed module supports these presentation states as applicable:

- `LOADING` — first observation pending
- `READY` — valid current evidence
- `STALE` — last valid evidence exists but freshness threshold exceeded
- `EMPTY` — successful observation, valid empty result
- `DEGRADED` — partial evidence / reduced capability
- `BLOCKED` — known prerequisite prevents progress
- `ERROR` — observation/request failed
- `UNKNOWN` — semantic state cannot be derived from available evidence

`EMPTY`, `ERROR`, `UNKNOWN`, and `NO_WORK` are never interchangeable.

Each non-ready state answers: what happened, impact, last-known-good/freshness when available, and the smallest corrective action.

## Dark Glass visual direction

The user-approved direction is premium dark theme + restrained glassmorphism. It is not neon/cyberpunk/game HUD.

### Foundation

- near-black neutral background with subtle depth
- translucent surfaces only when layering communicates hierarchy
- restrained background blur; never blur dense table/chart content
- thin low-contrast borders + selective stronger boundary for focus/critical state
- high-contrast primary text and quiet secondary text
- tabular numerals for financial values
- typography and spacing carry the hierarchy before color/effects

### Glass tiers

- `glass.base`: navigation and persistent shell
- `glass.raised`: decision / modal / urgent foreground surface
- `glass.overlay`: transient sheet/dialog only

No more than two glass depth levels should visually compete in one viewport.

### Color

- no neon palette
- no rainbow AI gradients
- one restrained intelligence accent
- green/red reserved for semantic positive/negative or safe/danger meaning
- amber reserved for caution/stale/human-attention
- state never communicated by color alone

### Motion

Motion communicates transition/change, never intelligence theatre. Respect reduced-motion. No orbit, particle field, scanning beam, glowing AI sphere, or decorative evidence animation on product surfaces.

## Data visualisation

- chart title must state subject and timeframe
- stale/error/partial data is explicit on the chart itself
- no sparkline if the underlying series is unavailable
- comparative bars share meaningful scale
- risk and confidence include provenance/meaning, not just percentage decoration
- tables prioritize symbol/name -> state/change -> impact/action

## Interaction and accessibility

- mobile touch target >= 48px where practical; never below existing platform contract
- visible focus on desktop
- critical state includes text/iconography, not color only
- dynamic type / text expansion must not hide authority or risk text
- 360 / 390 / 430px mobile acceptance widths
- keyboard operation and horizontal table accessibility on desktop
- reduced-motion honored

## Mobile task flows

### Understand current state

Launch -> NUSA Live Brief -> answer current posture / risk / system truth without navigation.

Target: 0 additional taps.

### Inspect a decision

NUSA -> Decision Object -> evidence/counter-evidence/invalidation/history.

Target: <= 1 navigation transition from Home.

### Validate an idea

Decision -> PAPER simulation -> before/after portfolio impact -> confirm PAPER action.

Target: one continuous workflow; no unrelated screen detour.

### Resolve a blocker

Global truth rail / notice -> exact recovery destination.

Target: one tap from surfaced blocker to corrective control where authority permits.

## Responsive rules

- 360: single-column, evidence FOR/AGAINST stacks, no clipped status semantics
- 390: canonical mobile composition
- 430: increase breathing room; do not inflate card count
- tablet: max content width and two-column detail only when scan order remains obvious
- desktop: density increases, hierarchy does not change

## Design debt / drift findings on main

1. Mobile Home currently leads with `LIVE INTELLIGENCE`, a decorative IntelligenceMotionField, and a large capital rail. This conflicts with the Decision Object-first product hierarchy.
2. Mobile design tokens expose `neonPurple`, `neonBlue`, `neonTeal`, `neonGlow`; card API exposes a `neon` presentation. This conflicts with the approved non-neon visual direction.
3. Desktop canonical architecture says `capital truth is the largest object`, while the current NUSA product requirement is judgement/system truth first. Cross-platform hierarchy is inconsistent.
4. Mobile has a dedicated visible `AI` destination while the target IA makes AI the intelligence layer and uses `판단` as the user job.
5. Existing AI detail is evidence-rich, but the primary hierarchy needs Decision -> trust -> evidence -> risk/invalidation -> safe action, with diagnostics progressively disclosed.
6. Historical renderer theme files remain in-repo; they are permitted by architecture but require drift tests so inactive visuals cannot re-enter the active renderer.

## Implementation sequence

P0 — information/state truth

- global first-glance status contract
- state semantic components and unknown/error/stale distinctions
- Home Decision Object hierarchy
- authority wording/persistence

P1 — navigation and flows

- visible mobile IA convergence
- Decision ledger/history
- continuous Decision -> PAPER simulation flow
- blocker deep links

P2 — Dark Glass visual system

- semantic glass tokens and components
- eliminate active neon/decorative intelligence surfaces
- charts/tables/KPI hierarchy
- responsive parity

P3 — parity and debt prevention

- screenshot acceptance at 360/390/430
- desktop responsive/accessibility checks
- design-doc <-> implementation contract tests
- active-renderer import/load guards

## Acceptance metrics

For critical tasks, measure before/after where telemetry/evidence exists:

- taps / clicks
- navigation transitions
- time to identify failure or stale data
- time to identify current NUSA posture/risk
- task completion steps
- authority misunderstanding risk
- mobile overflow/clipping
- accessibility violations
- screenshot parity against approved implementation-ready mockup

## Core decisions required

1. Approve visible mobile IA rename/convergence from `AI` to `판단` while retaining route compatibility during migration.
2. Approve judgement/system truth as the cross-platform first-viewport priority over universal capital-first hierarchy.
3. Approve Dark Glass as product visual direction and deprecate active neon/decorative intelligence motifs.
4. Confirm whether Autopilot is a desktop-only operational surface or should gain a progressive mobile status/detail surface. Do not expose operational mutation controls by presentation alone.
