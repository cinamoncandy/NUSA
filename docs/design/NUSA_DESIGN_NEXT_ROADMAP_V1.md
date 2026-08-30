# NUSA Design Next Roadmap v1

## Completed foundation

- Semantic state grammar for mode, health, authority, freshness, and action state.
- Presentation primitives that do not infer or grant trading authority.
- Attention Rail UX contract and responsive presentation primitives.

## Next priority

### P0: Decision Context Dock
Keep the selected instrument, current market context, position, exposure/risk summary, AI evidence, and permitted PAPER action in one stable context. Reduce context switching without changing execution logic.

### P1: Risk-before-action
Present the expected exposure delta, balance impact, concentration, and current mode before an actionable PAPER order step. The component must make mode explicit and must not imply LIVE capability.

### P1: AI Evidence Compression
Present AI conclusion, confidence, supporting evidence, counter-evidence, and invalidation condition in a compact hierarchy. Uncertainty remains visible.

### P2: Adaptive Density
Preserve information architecture across desktop, tablet, and mobile while changing density and interaction mechanics.

## Research loop

Continue user-needs research in parallel with implementation. Prioritize improvements that reduce scan time, prevent mode/authority misunderstanding, surface consequential risk earlier, and improve confidence without adding decorative complexity.

## Guardrails

- Do not remove existing product capabilities.
- Do not alter trading logic or execution authority.
- Do not encode safety meaning solely through color.
- Reuse canonical tokens and shared semantic primitives where possible.
- Validate empty, loading, stale, error, keyboard, reduced-motion, and narrow-viewport states.
