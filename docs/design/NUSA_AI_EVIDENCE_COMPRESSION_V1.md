# NUSA AI Evidence Compression UX v1

## Goal
Help users understand an AI trading assessment quickly without turning a signal into an unexplained command.

## Information hierarchy
1. Conclusion — what the model currently believes.
2. Confidence — how strongly the evidence supports it.
3. Supporting evidence — the few highest-value reasons.
4. Counter-evidence — what argues against the conclusion.
5. Invalidation — what condition would make the assessment stale or wrong.
6. Timestamp/freshness — when the evidence was evaluated.

## UX rules
- Conclusion and executable action are visually separate.
- Confidence is never presented as certainty or a guarantee.
- Evidence is compressed to decision-relevant facts; details remain expandable.
- Counter-evidence is visible without requiring a deep navigation path.
- Invalidation conditions are concrete where data permits.
- Stale evidence is visibly stale and cannot masquerade as current analysis.
- Loading and unavailable evidence preserve the hierarchy instead of showing fabricated certainty.

## Responsive behavior
- Desktop: conclusion and confidence remain persistent; evidence can expand inline.
- Tablet: evidence becomes a compact expandable group.
- Mobile: conclusion, confidence, freshness, and invalidation remain first-class; secondary evidence collapses.

## Accessibility
- Use headings/landmarks for the evidence groups.
- Do not encode confidence solely with color or a meter.
- Keyboard users can expand evidence and reach invalidation text in logical order.
- Dynamic freshness changes should be announced without excessive live-region noise.

## Guardrail
This is a presentation model only. It does not authorize, trigger, or recommend a live trade by itself.
