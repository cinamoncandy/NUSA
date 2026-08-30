# NUSA Risk-Before-Action UX v1

## Goal
Make the consequence of a PAPER action understandable before the user reaches the action control.

## Information order
1. Current operating mode
2. Current position and exposure
3. Proposed order delta
4. Projected exposure and balance impact
5. Concentration / risk flags
6. Explicit permitted PAPER action

## Interaction rules
- The risk summary is visible before the primary action.
- Current exposure and projected exposure use the same units and labels.
- Positive/negative values are accompanied by semantic text; color is supplemental.
- A warning or blocking state explains what changed and why the action is limited.
- The action area states PAPER explicitly and never presents a generic LIVE-looking control.
- If required data is stale, missing, or uncertain, the UI says so before action.

## States
- `ready`: consequence preview complete; PAPER action available.
- `warning`: action remains available but a consequential risk is visible.
- `blocked`: action unavailable; reason and recovery path are visible.
- `stale`: action context is not current; refresh/recovery state is explicit.
- `loading`: preserve layout and show what is being resolved.

## Accessibility
- Risk state must be conveyed by text/icon/structure, not color alone.
- Focus order follows mode → exposure → projected impact → risk → action.
- Warning and blocking messages are programmatically associated with the action region.

## Guardrail
Presentation and interaction guidance only. This specification does not create or modify trading authority, risk gates, or execution behavior.
