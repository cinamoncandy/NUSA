# NUSA Designer Final Audit v1

## Decision model
NUSA's presentation layer should guide the user through one continuous loop:

**Observe → Assess → Risk → Paper Action → Result → Re-assess**

## Final UX requirements
- Operating mode is explicit text: PAPER / SHADOW / LIVE.
- LIVE capability is never implied by generic enabled styling.
- Dynamic values expose freshness beside the value: current, updating, stale, unavailable, error.
- Risk context precedes action.
- AI conclusion, evidence, uncertainty, counter-evidence, and invalidation remain visually distinct from executable controls.
- Result feedback immediately states what changed and what the user should reassess next.
- Decision-critical context persists across navigation where technically available.
- Mobile collapses secondary evidence before mode, freshness, exposure, risk, and action context.
- Keyboard order follows the decision sequence.
- No critical state relies on color alone.
- When multiple decision stages share one destination page, the active stage follows the user's selected decision step instead of collapsing to a generic page state.

## Design-system convergence
Use semantic state primitives rather than page-specific badges. Prefer the canonical token layer and semantic aliases over introducing new local colors, spacing scales, radii, or shadows.

## User-needs research loop
Future design work should test:
1. time-to-understand current state;
2. time-to-identify risk;
3. navigation count before action;
4. stale-data recognition;
5. AI explanation comprehension;
6. post-action result comprehension;
7. mobile decision completion without losing critical context.

Prioritize improvements that reduce decision time or interpretation errors without reducing safety visibility.

## Scope boundary
This is a designer-only contract. It does not change trading logic, broker behavior, execution authority, risk gates, AI authority, or LIVE activation.

## Exit criterion for this design phase
The foundational UX work is considered structurally complete when the active simple-ui can consume the semantic state grammar, maintain decision context, show risk before action, explain AI evidence distinctly, adapt density responsively, and close the loop with explicit result feedback. Remaining work should be driven by observed usability defects or new user research evidence rather than cosmetic iteration.
