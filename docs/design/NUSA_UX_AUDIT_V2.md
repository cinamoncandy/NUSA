# NUSA UX Audit V2 — Decision Efficiency & Trust Calibration

## Scope
UI/UX, visual design, design-system, accessibility, and user-research synthesis only. No execution, broker, risk-gate, AI-authority, or LIVE capability changes.

## Findings
### P0 — Decision-critical context must remain stable
Users should not need to reconstruct symbol, mode, position, risk, and AI conclusion across separate surfaces. Selected instrument and operating mode should remain persistent while secondary evidence changes.

### P0 — Trust must be calibrated, not maximized
AI presentation should communicate confidence, evidence quality, freshness, counter-evidence, and invalidation conditions. Recent financial XAI research indicates explanation quality, usefulness, information quality, and trust interact in adoption; human-centered financial explanation research finds end-users prefer concise contextual visual explanations over technically complete representations. This supports progressive disclosure rather than an always-expanded explanation wall.

### P0 — Risk must precede action
The action affordance must never visually dominate exposure and risk consequences. On narrow screens, risk remains visible before secondary AI evidence and activity history.

### P1 — Reduce navigation and control proliferation
MTS usability research reports confusion from changing button locations, excessive menus/buttons, too many colors, small controls, and weak first-screen information hierarchy. NUSA should prefer stable action placement, fewer competing controls, and a strong first-glance state summary.

### P1 — Make freshness actionable
A stale value should say what is stale, when it was last updated, and whether that state blocks or limits an action.

### P1 — Separate analysis from action
AI conclusions, evidence, and uncertainty should be visually distinct from executable PAPER controls. Users should be able to inspect reasoning without mistaking it for authorization.

### P2 — Personalization should change density, not semantics
Comfort/standard/compact modes may alter whitespace and secondary evidence visibility, but semantic state, safety boundaries, and action meaning remain invariant.

## Research-derived design principles
1. Context before interpretation.
2. Evidence before confidence.
3. Concise counterfactuals for high-impact decisions.
4. Progressive disclosure for deeper evidence.
5. Stable action grammar across screens.
6. Critical state never relies on color alone.
7. Risk remains persistent through action selection.
8. AI recommendation/explanation is visibly distinct from permission/execution.

## Next implementation candidates
1. Decision Context persistence across Market, Position, AI, and Order.
2. Unified freshness contract: timestamp, stale threshold, source, action impact.
3. Action hierarchy audit: reduce duplicate primary controls and normalize placement/labels.
4. AI explanation progressive disclosure: conclusion + 2–4 strongest evidence items by default; counter-evidence/invalidation on demand.
5. Mobile task flow: Observe → Assess → Risk → Paper action → Result.

## Validation targets
- Mode identifiable within one glance.
- Position/exposure visible before action.
- Risk visible before action selection.
- Stale data explains impact, not only status.
- AI recommendation cannot be mistaken for execution authority.
- Critical state remains understandable without color perception.
- Keyboard traversal follows decision order.
- Mobile preserves Desktop semantics.

## Research sources
- Ioannou et al. (2026), *The Role of Explainability in AI-Driven Financial Decision Making*.
- Human-centered financial XAI visual explanation evaluation (2026).
- Korean MTS UI usability study comparing four domestic MTS apps.

The research supports concise, contextual, actionable explanations, stable controls, reduced visual competition, and explicit user agency. The design objective is calibrated trust and appropriate reliance, not blind trust.
