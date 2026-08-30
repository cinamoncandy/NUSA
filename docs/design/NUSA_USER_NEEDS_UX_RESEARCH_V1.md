# NUSA User-Needs UX Research v1

Date: 2026-08-30
Scope: UI/UX, visual design, design system, user experience only.

## Research question

What does a NUSA user need to understand or do with the fewest possible attention shifts while NUSA observes markets, explains AI decisions, manages PAPER execution, and presents safety boundaries?

The goal is not to copy another trading terminal. The goal is to identify durable user needs and turn them into NUSA-specific interface patterns.

## Evidence reviewed

### NUSA implementation

The active Desktop entry point uses `simple-ui-root` and a task-oriented presentation layer. The renderer loads a separate `simple-ui.css` alongside the canonical token and Control Room styles. The simple UI currently defines its own light surface, blue primary, success/warning/danger palette, spacing, radii, and shadows. This creates a real design-system split that should be treated as a convergence problem rather than solved by adding more decoration.

The current UI already exposes Paper Trading / real-trading-disabled language and connection state. Existing work has also established explicit authority and safety boundaries, HOME hierarchy, Markets observation-first work, and AI evidence/diagnostic ordering. Therefore the next UX gains should come from reducing decision friction and increasing state legibility, not another wholesale visual reskin.

### External product patterns

TradingView documents an order panel that remains accessible beside the chart and becomes active for parameter entry, keeping the chart visible while connecting order and position context. This supports an NUSA pattern of keeping the primary market context visible while an order task is performed.

Interactive Brokers documents workspace layouts combining streaming market information, charts, order management and portfolio context. Its Risk Navigator provides portfolio-level risk with drill-down and what-if analysis. These patterns support an NUSA principle: users should be able to move from portfolio state to the specific position or market driver without losing context.

Interactive Brokers also documents rapid order entry with keyboard tab order. This supports keyboard-first efficiency for repeated workflows, while NUSA should preserve a safer, explicit confirmation boundary for any consequential action.

Recent research on explainable AI in retail investment describes explainability, trust, perceived risk, information quality and confidence as material factors in adoption. A 2026 study of GenAI use in stock-market participants also reports greater continued engagement with concise and directionally accurate answers. These findings support concise AI explanations with inspectable evidence rather than verbose AI narration.

## User needs identified

### P0: Know the operating state immediately

A user must be able to answer, within one glance:

- What mode am I in?
- Is the market/data connection healthy?
- Is the strategy active, paused, blocked, or waiting?
- Is anything requiring attention?
- Is an action actually executable?

NUSA should never make a user infer PAPER/SHADOW/LIVE from color alone. State must use explicit text plus a consistent semantic status treatment.

### P0: Know risk before performance

For a trading product, return is not sufficient context. The first actionable layer should surface risk posture, exposure, drawdown/heat where available, stale data, execution uncertainty, and hard blocks.

The user should not have to open a separate risk screen to discover that an otherwise attractive action is currently unsafe or unavailable.

### P0: Move from signal to decision without context loss

The ideal flow is:

`market observation -> signal -> evidence -> risk -> proposed action -> order state`

Each step should preserve the selected instrument/strategy and relevant context. Avoid navigation that resets the user's mental model.

### P0: Understand AI without trusting it blindly

AI output should answer three compact questions first:

1. What is the current thesis?
2. How confident/trusted is the evidence?
3. What evidence or counter-evidence could change the thesis?

Details and diagnostics can follow progressively. AI authority must remain visually separate from AI intelligence, so a confident visual treatment can never imply execution authority.

### P1: See positions as decisions, not just rows

A position row should make the important state scannable: instrument, direction, size/value, P&L, risk relevance, execution status, and the next meaningful action. Secondary metadata belongs behind progressive disclosure.

### P1: Test consequences before acting

When a hypothetical or PAPER action can be previewed, show its effect on exposure, cash, concentration, and relevant risk before the user commits. This mirrors established professional-platform what-if patterns while remaining explicitly hypothetical.

### P1: Repeated actions should be fast and keyboard-friendly

Repeated workflows should support logical tab order, predictable shortcuts where safe, visible focus, and compact forms. Speed should come from fewer unnecessary steps, not from hiding safety checks.

### P1: Exceptions must become the interface

Empty, stale, unavailable, reconnecting, blocked, and failed states should explain what happened and what the user can do next. A blank chart or disabled button without reason is a UX failure.

### P2: Let users control information density

Desktop users need high information density; mobile users need progressive disclosure. NUSA should not maintain two unrelated information architectures. The same hierarchy should collapse gracefully from multi-column workspace to focused task cards.

## NUSA design principles derived from research

1. **State before decoration.** Mode, health, risk and authority are more important than visual flourish.
2. **Decision chain continuity.** Preserve instrument, strategy and evidence context across screens and tasks.
3. **Progressive disclosure.** Put the decision-critical facts first; diagnostics and raw evidence one layer deeper.
4. **Safety is semantic.** Never communicate LIVE/PAPER authority by hue alone.
5. **AI is explainable, not theatrical.** Concise thesis + confidence + evidence + counter-evidence beats a large conversational block.
6. **Action proximity.** When the user decides to act, the relevant market/position/risk context should remain nearby.
7. **Exception-first feedback.** Errors and stale states should tell the user what changed and what is possible next.
8. **One system, many densities.** Desktop and mobile share tokens, semantics and hierarchy while changing composition.

## Proposed NUSA interaction model

### Command Center

Top band: operating mode + system health + attention state.

Primary band: risk posture + account value/P&L + exposure.

Decision band: market/signal/evidence + selected instrument context.

Action band: PAPER order or simulation action with explicit authority state.

Activity band: recent orders, fills, strategy events, and unresolved exceptions.

### Instrument workspace

`Price/market context -> active positions/orders -> signal/evidence -> risk impact -> action`

The order surface should remain adjacent to market context where space permits, following the useful professional-terminal pattern of not forcing a full context switch for order entry.

### AI workspace

`Thesis -> trusted confidence -> evidence -> counter-evidence -> diagnostics -> authority boundary`

This extends the ordering already established in NUSA's AI work rather than replacing it.

## Research backlog

### Next UX experiments

1. **Attention Rail:** a single prioritized list of only the things that can change a user's decision now.
2. **Decision Context Dock:** selected instrument + position + risk + AI evidence kept together while navigating related tasks.
3. **Risk-before-action preview:** compact before/after exposure and cash impact for PAPER actions.
4. **State grammar:** one reusable semantic component for PAPER/SHADOW/LIVE, connection, strategy, order, data freshness, and blocking states.
5. **Density modes:** desktop dense / tablet balanced / mobile focused using the same semantic hierarchy.
6. **AI evidence compression:** test whether users can identify thesis, confidence and invalidating evidence faster with a compact evidence stack than with narrative cards.

## Acceptance criteria for future design work

A design change is high-value when it measurably improves at least one of:

- time to identify operating mode;
- time to identify the most important risk;
- time to understand why an AI signal exists;
- time to locate the relevant position/order;
- number of context switches required for a decision;
- error recovery clarity;
- keyboard completion efficiency;
- mobile scanability;
- distinction between information and authority.

A change should not be accepted merely because it looks more modern.

## Research conclusion

The strongest opportunity for NUSA is not adding more panels. It is creating a coherent **decision surface** where state, risk, evidence and action remain connected while irrelevant detail recedes.

The design system should therefore evolve toward a shared semantic state grammar and a reusable decision-context pattern. The Command Center v1 prototype is the first implementation target for this research, and subsequent work should validate these hypotheses against the actual NUSA renderer rather than treating them as finished assumptions.
