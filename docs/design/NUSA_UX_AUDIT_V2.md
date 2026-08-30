# NUSA UX Audit V2 — Decision Flow

## Scope
UI/UX, visual design, design-system presentation, accessibility, responsive behavior, and user decision efficiency only.

## Current evidence
The active Desktop surface is `simple-ui-root`. Navigation separates Dashboard, Market, Orders, and Positions, while mode and connection state are repeated in the sidebar, header, page headings, and order surfaces. The current Dashboard also exposes quick Paper Buy/Sell actions before a dedicated decision context is established.

## Primary UX finding
The current information architecture is functional but fragmented. A trader can move between market, account, position, and order views without carrying one stable decision context. Repeated status labels consume attention while decision-critical context is distributed across cards.

## Priority model
### P0 — Decision continuity
Keep selected instrument and its decision context persistent across navigation:
- instrument / price
- mode and capability
- freshness
- position / exposure
- risk impact
- AI conclusion / evidence
- permitted Paper action

### P0 — Freshness hierarchy
Every decision-critical value should expose freshness semantics consistently:
- Live/current
- Updating
- Stale
- Unavailable
- Error

Freshness must not rely on color alone.

### P1 — Action hierarchy
An action should be preceded visually by its context and risk. Generic primary-button styling must not imply live capability.

### P1 — Shared-page stage semantics
Risk, Paper Action, and Result currently share the Orders destination. The decision rail must preserve which stage the user explicitly selected so assistive technology and visual active-state feedback do not collapse distinct stages into one generic Orders state.

### P1 — Mobile continuity
On narrow screens, preserve mode, freshness, exposure, risk, and the selected instrument before secondary evidence.

### P2 — Navigation simplification
Reduce repeated status chrome and use one canonical state grammar instead of multiple visually similar badges.

## User research hypotheses to test
1. Users decide faster when instrument context remains persistent.
2. Users make fewer interpretation errors when freshness appears beside the value it qualifies.
3. Users trust AI more appropriately when conclusion, evidence, uncertainty, and invalidation are adjacent but visually distinct from action.
4. Users need less navigation when risk preview appears before the action rather than after it.
5. Mobile users prefer progressive disclosure of evidence rather than removal of decision-critical context.
6. Users understand the workflow more reliably when Risk, Action, and Result retain distinct active-step semantics even on a shared destination page.

## Validation checklist
- Mode is identifiable within one glance.
- Freshness is visible beside every decision-critical dynamic value.
- Risk is visible before any order action.
- AI recommendation cannot be mistaken for an executable command.
- Paper actions remain explicitly labeled.
- No critical state depends on color alone.
- Keyboard order follows the decision sequence.
- Narrow layouts preserve decision-critical information.
- Risk, Action, and Result each expose the correct active-step state after direct selection.

## Next design experiment
Measure whether the persistent Decision Flow Rail lowers navigation count and stale-data interpretation errors, then prioritize the remaining disabled-control affordance and duplicated mode/status chrome issues.

## Safety boundary
Presentation and interaction structure only. This audit does not grant execution authority, change broker behavior, modify risk gates, or activate LIVE trading.
