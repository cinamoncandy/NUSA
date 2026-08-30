# NUSA Adaptive Density + Mobile UX v1

## Goal
Preserve the NUSA decision model across viewport sizes while reducing scanning cost on small screens.

## Density model
- Comfort: spacious review and monitoring.
- Standard: default trading workspace.
- Compact: high-information monitoring without hiding critical state.

Density is presentation-only; safety-critical state is never removed.

## Responsive priority
1. Mode / authority / connection / freshness
2. Risk and exposure
3. Current instrument and market state
4. Position and P/L
5. AI conclusion and uncertainty
6. Action context
7. Secondary evidence and history

## Mobile rules
- Never hide PAPER/SHADOW/LIVE state.
- Never hide risk state to gain space.
- Never require horizontal scrolling for primary decision controls.
- Keep primary action adjacent to its risk context.
- Collapse secondary AI evidence before core decision context.
- Transform dense tables into scannable rows when columns stop working.
- A bottom navigation may replace the desktop sidebar, with explicit labels retained.
- Keep touch targets at least 44px where practical.
- Preserve visible focus indicators and reduced-motion support.

## Desktop rules
- Use width for comparison rather than decorative whitespace.
- Keep decision context beside the active work surface.
- Avoid fragmenting sections that form one decision.

## Validation questions
At every viewport, the user should be able to answer: What mode am I in? Is data/system health clear? What is my exposure? What is the risk? What does AI think and why? What action is actually permitted?

## Safety boundary
Presentation specification only. It does not grant LIVE authority, alter risk gates, or change execution behavior.
