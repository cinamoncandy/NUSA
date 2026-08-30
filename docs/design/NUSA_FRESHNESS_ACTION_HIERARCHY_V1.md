# NUSA Freshness & Action Hierarchy v1

## Purpose
Turn data freshness and action priority into explicit interaction rules for trading UI. Presentation only.

## Freshness grammar
Every decision-critical market/risk value should expose, when available: current state (UPDATED/STALE/UNAVAILABLE), last update time, freshness threshold or reason, source/context when useful, and action consequence (allowed/limited/blocked).

A stale value must never appear equivalent to a current value merely because its typography is identical.

## Action hierarchy
1. Decision-critical state and risk
2. Primary PAPER action
3. Secondary inspection action
4. Historical/activity actions
5. Configuration/navigation

Only one primary action should visually compete within a decision surface. Secondary actions use lower visual weight without becoming undiscoverable.

## Safety presentation
- PAPER/SHADOW/LIVE labels remain explicit text.
- LIVE availability must not be inferred from a blue/green enabled-looking button.
- Risk and freshness warnings precede action affordances.
- Disabled or blocked actions explain why and what state would permit them, when safe to disclose.
- AI recommendations remain visually separate from execution controls.

## Mobile behavior
On narrow screens preserve mode, freshness, exposure, and risk before secondary content; keep the primary PAPER action reachable without horizontal scrolling; collapse secondary evidence before decision-critical state; maintain minimum touch targets and visible focus semantics.

## Audit checklist
- Is stale data distinguishable without color perception?
- Can the user tell whether freshness affects the next action?
- Is there one obvious primary action?
- Does risk appear before the action?
- Are AI evidence and execution affordances visually distinct?
- Does the same semantic hierarchy survive mobile density reduction?
