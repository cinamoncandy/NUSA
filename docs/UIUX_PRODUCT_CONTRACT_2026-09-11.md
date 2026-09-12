# NUSA Product UX Contract — 2026-09-11

Status: Core review required before broad implementation  
Owner: UI/UX  
Scope: Mobile + Desktop presentation only

## Product UX goal

NUSA is an AI trading intelligence system, not a generic brokerage dashboard. The interface must let a user understand the important truth without hunting through screens, then move to the smallest safe next action.

Primary loop:

`OBSERVE -> REASON -> DECIDE -> VALIDATE -> LEARN`

`SIMULATE` may appear only when an authoritative simulation projection actually exists. The UI must not invent a simulation or execution capability.

## Non-negotiable authority truth

- `PAPER_ONLY`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `aiAuthority=ZERO_AUTHORITY`

PAPER must never visually resemble LIVE. AI insight must never look like autonomous execution. Missing evidence must never become a success state.

## Current capability boundary discovered in repository audit

The current production mobile `PAPER` route is a supervision/learning surface. It intentionally does not expose manual BUY/SELL, quantity, price or submit controls. Therefore:

- the UX contract does not require a manual PAPER order flow;
- a Decision may deep-link to PAPER supervision/validation evidence, not to a fabricated order ticket;
- portfolio-impact or scenario simulation is `UNAVAILABLE` until an authoritative projection exists;
- any future user-triggered PAPER mutation requires separate Core/authority/product approval and is outside this UI/UX contract.

## Information priority

Every primary surface uses this hierarchy:

1. Immediate judgement — what matters now.
2. Operational truth — system/data/PAPER/strategy/risk/autopilot state.
3. Decision evidence — why, counter-evidence, uncertainty, invalidation when authoritative.
4. Safe next action — review, inspect, validate, recover, or open PAPER supervision.
5. Detail — raw market, portfolio, history, diagnostics.

Developer diagnostics do not compete with the first viewport.

## First-glance status contract

Without opening another screen the user must be able to determine:

- System state
- Data state and freshness
- PAPER state
- Strategy state
- Risk state
- Autopilot state when an authoritative projection exists
- Most recent meaningful activity
- Active warning/failure
- Whether human action is required

Unknown is a first-class state. No observed data is not success.

## Primary information architecture

### Mobile

Use five destinations maximum.

- `NUSA` — current brief: judgement + system truth + available change evidence + safe next action.
- `판단` — AI decision ledger: current observations, evidence, counter-evidence, confidence provenance, uncertainty and decision history when available.
- `시장` — market intelligence: important observed changes and data evidence; raw quotes are subordinate.
- `PAPER` — PAPER supervision, validation and learning evidence. PAPER identity remains persistent.
- `자산` — PAPER portfolio exposure, PnL, capital allocation and read-only account separation.

Do not create a generic visible `AI` destination as the end-state IA. AI is the intelligence layer across NUSA. Existing route IDs may remain during compatibility migration.

### Desktop

Desktop keeps higher density but uses the same user jobs and state semantics. Secondary operational/diagnostic navigation is progressive. Current desktop documentation that makes capital the universal dominant object conflicts with this product hierarchy when judgement, failure or user action is materially more important.

## NUSA Home / Live Brief

The first viewport answers:

1. What can NUSA truthfully say now?
2. Is the system/data/PAPER path healthy enough to trust that statement?
3. What evidence and uncertainty matter?
4. Does anything require user attention?

Composition:

- compact global truth rail
- one dominant Decision/Observation Object
- current evidence + counter-evidence summary
- risk/uncertainty or `UNKNOWN`
- one safe next action
- compact portfolio impact/result only when authoritative

Do not lead with giant account value, decorative AI objects, raw quote cards, or news.

### What changed

Current mobile status code explicitly reports `changesSupported: false`; no device snapshot-history source currently supports a truthful change ledger. Therefore the first viewport must show `변화 이력 없음/미지원` or omit the delta section until an authoritative history source exists. It must never synthesize “what changed”.

## Decision / Observation Object

This is the primary reusable AI-trading UX primitive. Fields are rendered only when their source exists.

- subject / scope
- thesis / current observation
- calibration state
- calibrated confidence only when verified `CALIBRATED`
- evidence FOR
- evidence AGAINST
- uncertainty
- critic severity / disagreements
- last model run/freshness
- invalidation condition only if an authoritative field exists
- portfolio impact only if an authoritative projection exists
- safe next action
- `PAPER ONLY · AI ZERO AUTHORITY` context where execution could otherwise be misunderstood

The current `AiReadOnlyProjection` has evidence, counter-evidence, uncertainty, critic severity, disagreements, calibration, scenario robustness and authority truth. It does not provide a canonical stance enum, portfolio impact, invalidation condition, or decision-history ledger. UI must not invent those fields.

## Autopilot state UX

Target semantic states:

`NO_WORK | READY | CLAIMED | RUNNING | VALIDATING | BLOCKED | HUMAN_ONLY | FAILED | STARVATION | DONE`

The summary should expose active/queued work, blocker, human-only action, latest successful work, last healthy run, recent failure and subsystem health — but only from an authoritative projection. Observation failure is never `0` or `NO_WORK`.

Until those fields are available to the product surface, render `UNKNOWN/UNAVAILABLE`; do not infer queue truth from unrelated runtime state.

## State model

Data-backed modules distinguish:

`LOADING | READY | STALE | EMPTY | DEGRADED | BLOCKED | ERROR | UNKNOWN`

`EMPTY`, `ERROR`, `UNKNOWN`, `UNAVAILABLE`, and `NO_WORK` are not interchangeable. Every non-ready state explains what happened, user impact, last-known-good/freshness when available, and the smallest corrective action.

## Dark Glass visual direction

Premium dark + restrained glassmorphism. Not neon, cyberpunk, or game HUD.

### Foundation

- near-black neutral background with subtle tonal depth
- glass only where layer hierarchy is meaningful
- restrained blur; never blur dense chart/table content
- thin low-contrast boundaries
- high-contrast primary text, quiet secondary text
- tabular numerals for financial values
- typography and spacing create hierarchy before color/effects

### Glass tiers

- `glass.base` — navigation/persistent shell
- `glass.raised` — dominant judgement, modal, urgent foreground
- `glass.overlay` — transient sheet/dialog

No more than two glass depths compete in one viewport.

### Color and motion

- remove active neon vocabulary from product presentation
- no rainbow AI gradients
- one restrained intelligence accent
- green/red only for semantic positive/negative or safe/danger
- amber for caution/stale/human attention
- state is never color-only
- no orbit/particle/scan/glowing-sphere/evidence-field theatre
- motion communicates transition/change and respects reduced-motion

## Data visualisation

- chart title states subject and timeframe
- stale/error/partial data appears on the chart itself
- no sparkline without a real series
- comparative bars use meaningful scale
- confidence always includes calibration/provenance meaning
- tables order information by subject -> state/change -> impact/action
- raw prices do not outrank system truth or judgement

## Interaction and accessibility

- mobile target >= 48px where practical; never below existing platform contract
- visible desktop focus
- critical state uses text/icon + color
- text expansion must not hide risk/authority truth
- mobile acceptance: 360 / 390 / 430px
- desktop keyboard/horizontal-region accessibility
- reduced-motion honored

## Critical task flows

### Understand current state

Launch -> NUSA -> identify current observation, PAPER/system state, data freshness and risk without navigation.

Target: 0 additional taps.

### Inspect AI reasoning

NUSA -> 판단 -> evidence / counter-evidence / uncertainty / calibration / scenario robustness.

Target: <= 1 primary navigation transition.

### Validate a judgement

판단 -> PAPER supervision/learning evidence where the runtime provides a relationship.

Target: no fabricated simulation or order action. If linkage is unavailable, explain that validation evidence is unavailable rather than offering a dead control.

### Resolve a blocker

Truth rail/notice -> exact recovery destination where authority permits.

Target: one tap from surfaced blocker to corrective control when such a control exists.

## Responsive rules

- 360: single-column; evidence/counter-evidence stack; status text never clips
- 390: canonical mobile composition
- 430: more breathing room, not more card count
- tablet: two-column detail only when scan order remains obvious
- desktop: density increases; semantic hierarchy stays stable

## Design debt / drift findings on main

1. Mobile Home leads with `LIVE INTELLIGENCE`, decorative `IntelligenceMotionField`, and a large capital rail.
2. Mobile design system exposes neon token/API vocabulary including `NusaCard(neon)`.
3. Desktop canonical architecture states capital truth is the largest object, conflicting with judgement/system-truth priority.
4. Mobile visible navigation still uses `AI`, while target IA uses the user job `판단`.
5. AI detail already has valuable evidence/calibration/uncertainty content; recompose rather than duplicate it.
6. `homeStatusRail` explicitly has no snapshot-history source (`changesSupported: false`).
7. Production mobile PAPER is supervision/learning only; earlier “Decision -> simulation -> confirm PAPER action” language exceeded actual capability and is superseded by this revision.
8. Current `AiReadOnlyProjection` cannot truthfully supply every aspirational Decision Object field. Missing fields remain unavailable until their canonical owners expose them.

## Implementation sequence

### P0 — truth and hierarchy

- global first-glance state semantics
- Home judgement/observation hierarchy
- remove decorative intelligence dominance
- preserve authority wording
- unknown/error/stale distinction

### P1 — navigation and reasoning

- visible `AI` -> `판단` migration with route compatibility
- reorganize existing AI evidence into Decision/Observation Object
- PAPER supervision linkage only where backed by runtime evidence
- blocker deep links

### P2 — Dark Glass system

- semantic glass surface tokens
- retire active neon/decorative motion presentation
- charts/tables/KPI hierarchy cleanup
- responsive parity

### P3 — parity and drift prevention

- screenshot acceptance at 360/390/430
- desktop responsive/accessibility checks
- design-doc <-> implementation contract tests
- active-renderer import/load guards

## Acceptance metrics

Measure where telemetry/evidence exists:

- taps/clicks
- navigation transitions
- time to identify failure/stale data
- time to identify current NUSA observation/risk
- task completion steps
- authority misunderstanding risk
- mobile overflow/clipping
- accessibility failures
- screenshot parity against approved implementation-ready mockup

## Core decisions required

1. Approve visible mobile IA migration `AI` -> `판단` while retaining route compatibility.
2. Approve judgement/system truth over universal capital-first hierarchy.
3. Approve Dark Glass/non-neon product direction.
4. Decide Autopilot exposure boundary on mobile.
5. Decide whether new canonical projections should be created for: decision history/change, stance, invalidation, portfolio impact, and Autopilot detail. UI will not infer them.
6. Decide whether PR #1838 is reworked into this contract or superseded.
