# NUSA UI/UX Implementation Acceptance — 2026-09-12

Owner: UI/UX  
Status: implementation-ready requirements; broad code work waits for Core approval  
Authority: presentation only

## 1. Canonical mobile jobs

Visible end-state navigation:

`NUSA | 판단 | 시장 | PAPER | 자산`

Compatibility rule: internal route IDs may remain unchanged during migration. Visible labels and accessibility semantics must not imply new execution authority.

## 2. NUSA first viewport

The first viewport passes only if the user can answer without scrolling to a second screen or opening another tab:

- Is PAPER/system observation healthy?
- Is market data current, stale, unavailable or failed?
- Is there a verified AI observation/thesis?
- Is confidence calibrated or unavailable?
- Is there evidence against the thesis?
- Does anything require human attention now?

Required order:

1. compact brand + authority/status shell
2. global truth strip
3. dominant Decision/Observation surface
4. evidence/counter-evidence summary or explicit unavailable state
5. uncertainty/risk summary
6. one safe next action

Portfolio/capital and raw market chart are secondary.

### Home fail conditions

- decorative `IntelligenceMotionField` is dominant or consumes decision-space
- giant equity figure dominates first viewport
- `LIVE` wording appears without explicit non-LIVE execution context
- stale/unknown/error is shown as healthy/zero
- calibrated confidence is shown when calibration is not `CALIBRATED`
- “what changed” is synthesized while `changesSupported` is false
- market risk is invented from operational risk

## 3. Decision/Observation surface

Use current runtime fields first:

- thesis
- status
- evidence references
- counter-evidence
- uncertainty
- disagreements
- critic severity
- last model run
- calibration status + calibrated confidence when valid
- scenario robustness / trust disposition when available

Unavailable fields do not get placeholder guesses. In particular, do not invent:

- BUY/HOLD/SELL stance
- invalidation price
- portfolio impact
- expected return
- decision-history delta

until canonical projections exist.

Progressive disclosure:

- Level 1: thesis, trust state, evidence/against counts, freshness
- Level 2: evidence + counter-evidence + uncertainty + disagreements
- Level 3: calibration diagnostics, model/prompt provenance, research/learning diagnostics
- Authority truth remains visible before any action-like control.

## 4. PAPER

Current production mobile PAPER is supervision/learning only.

Acceptance:

- no manual BUY/SELL/price/quantity/submit controls are introduced
- no “execute”, “place order”, or equivalent mutation affordance
- Decision -> PAPER link means “검증/학습 근거 보기” or equivalent
- when linkage between a decision and PAPER evidence is absent, show unavailable instead of a dead CTA
- persistent `PAPER ONLY`; no visual similarity to LIVE mode

## 5. Markets

Markets is observation, not authority.

First order:

1. data source state/freshness
2. selected market context
3. price/change/chart
4. watchlist/detail
5. link to PAPER context only as supervision/context

Stale/error state must remain attached to the chart/data it qualifies. Public data never becomes a strategy signal by UI inference.

## 6. Portfolio

Portfolio keeps PAPER and REAL_READ_ONLY separated.

Priority:

1. account/source truth
2. PAPER equity/PnL/exposure
3. capital allocation
4. current positions
5. accounting detail
6. REAL_READ_ONLY baseline as separate reference

Never sum REAL_READ_ONLY balances into PAPER performance.

## 7. State semantic component

All primary data-backed surfaces map into:

`LOADING | READY | STALE | EMPTY | DEGRADED | BLOCKED | ERROR | UNKNOWN`

Each non-ready rendering must contain:

- state label
- plain-language cause if known
- user impact
- freshness/last-known-good when available
- one recovery action only when a real action exists

Forbidden equivalences:

- `ERROR -> EMPTY`
- `UNKNOWN -> READY`
- `UNAVAILABLE -> 0`
- observation failure -> `NO_WORK`
- CI pass -> release complete
- PAPER -> LIVE

## 8. Autopilot

Target UX semantics:

`NO_WORK | READY | CLAIMED | RUNNING | VALIDATING | BLOCKED | HUMAN_ONLY | FAILED | STARVATION | DONE`

Do not implement semantic projection from unrelated local state. UI waits for canonical backend/observability fields.

When available, one Autopilot summary answers:

- active work?
- queued work?
- blocker?
- human action?
- last success?
- last healthy timestamp?
- recent failure?
- automation subsystem health?

## 9. Dark Glass visual system

Visual target: premium dark, quiet, glass-layered, AI-native through information behavior rather than effects.

Token intent:

- `bg.canvas`: near-black neutral
- `surface.base`: opaque/near-opaque information canvas
- `glass.base`: persistent shell/nav
- `glass.raised`: judgement/urgent foreground
- `glass.overlay`: modal/sheet only
- `border.quiet`: hairline separation
- `border.focus`: accessibility/focus
- `accent.intelligence`: single restrained AI accent
- semantic `success/warning/danger/info`

Implementation constraints:

- no `neon*` product token use in new UI
- no `NusaCard(neon)` in redesigned surfaces
- no orbit, scan, particle, AI sphere, evidence-field animation
- no more than two competing glass depths in a viewport
- blur never degrades chart/table legibility
- state color always has text/icon/label redundancy
- financial numerals use tabular numerals

## 10. Responsive

### 360px

- single column
- no clipped authority/status text
- evidence and counter-evidence stack
- CTA/touch controls remain >= existing contract
- no horizontal viewport overflow

### 390px

- canonical reference width
- decision surface visible without oversized decorative content
- global truth remains scannable

### 430px

- spacing expands modestly
- no additional card count solely because width is larger

### Tablet/Desktop

- density may increase
- scan order stays the same
- keyboard focus visible
- financial horizontal regions accessible

## 11. Loading / empty / stale / error acceptance

Loading: skeleton/progress may show structure but no fabricated values.  
Empty: only after successful observation proves empty result.  
Stale: retain last valid value only with explicit age/stale qualifier.  
Error: explain failed observation and recovery path; do not erase last-known-good if safe to retain.  
Unknown: use when semantic derivation is not supported.

## 12. Accessibility

- 48px mobile touch target where practical; never regress existing target contract
- screen-reader labels describe semantic state, not color
- `accessibilityState` used for selected/disabled controls
- dynamic text expansion preserves authority/risk text
- reduced-motion removes nonessential transition motion
- chart meaning has adjacent textual summary for critical state

## 13. Visual parity gate

A mockup is not accepted until it is implementation-feasible with current React Native primitives and real data.

Implementation PR must include exact-device evidence:

- 360px capture
- 390px/reference Android capture
- 430px capture
- normal state
- disconnected/blocked state
- stale state
- AI unavailable/incomplete state

Acceptance is visual + semantic. Passing tests while the actual app materially diverges from the approved hierarchy is not sufficient.

## 14. Measurable UX targets

- current overall state: 0 extra navigation transitions
- decision reasoning: <= 1 primary navigation transition
- blocker -> real corrective destination: <= 1 tap when such control exists
- critical state recognition: no dependence on color
- mobile clipping/overflow: 0 at 360/390/430
- fabricated values/states: 0
- LIVE authority implication: 0

## 15. Implementation slices after Core approval

Slice A — Home truth/hierarchy only. No navigation rename.  
Slice B — state semantic primitives + tests.  
Slice C — visible `AI` -> `판단` migration while retaining internal route compatibility.  
Slice D — Dark Glass token/component migration and decorative-motion retirement.  
Slice E — Markets/Portfolio/PAPER visual hierarchy alignment.  
Slice F — screenshot parity + drift guards.

Each slice must remain UI-scoped. If a requirement needs new strategy, Autopilot, decision-history, invalidation, stance or portfolio-impact data, stop at the UI boundary and hand the projection requirement to Core/canonical owner.
