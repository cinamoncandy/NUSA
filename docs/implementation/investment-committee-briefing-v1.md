# Investment Committee Briefing v1

The mobile briefing is a read-only projection of an already computed Investment Committee decision.

It exposes:

- final committee decision
- weighted confidence, edge, risk, and agreement
- conflict level
- hard veto reasons
- normalized strategy identity
- ACTIONABLE, CAUTION, or BLOCKED display state

## Fail-closed rules

The briefing rejects future-dated and stale payloads. Any veto, REJECT, or EMERGENCY_EXIT result is displayed as BLOCKED. WAIT, PAPER_ONLY, APPROVE_PARTIAL, HIGH conflict, and CRITICAL conflict are displayed as CAUTION.

The view model cannot submit orders, modify strategy state, clear a veto, disable the Kill Switch, or activate LIVE trading. It is immutable and deterministic for the same input.
