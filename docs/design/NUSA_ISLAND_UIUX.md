# NUSA Island UI/UX

## Product metaphor

NUSA means island. The product should feel like a controlled financial island inside a noisy market ocean.

- Ocean = external market complexity
- Island = the user's controlled financial workspace
- Lighthouse = read-only AI guidance
- Shoreline = safety and approval boundaries
- PAPER waters = simulation/training area with no LIVE authority

## Core UX rules

1. One screen answers one primary question.
2. One primary action per state.
3. Safety state is explicit but never repeated as visual noise.
4. Approval is a gateway, not a disabled dashboard.
5. PAPER order flow is Input -> Review -> Confirm -> Result.
6. Unknown authorization or transport state fails closed.
7. AI explains; AI never executes.
8. Mobile layouts must work first on small Android screens.

## Information architecture

Primary navigation:

- Home
- Markets
- PAPER
- Portfolio
- AI

Utilities:

- History
- Notifications
- Settings

## Visual direction

Premium dark fintech without neon overload or decorative glassmorphism.

- Deep ocean/navy surfaces
- Mint/ocean accent used sparingly
- High contrast text hierarchy
- Large numeric emphasis for balances/prices
- Soft rounded surfaces inspired by island forms
- Thin horizon separators
- Status colors are semantic only

## Approval states

### PENDING

Question: What is happening now?

Primary action: Check approval status.

Protected content remains hidden.

### ACTIVE

Question: Can I enter NUSA now?

Primary action: Enter NUSA.

### REJECTED

Question: Why can I not use NUSA?

Primary action: Use another account / contact operator.

### SUSPENDED

Question: Is my protected access already blocked?

Answer must be explicit: yes. Sensitive state is cleared and protected routes are unavailable.

## Home

3-second hierarchy:

1. Total PAPER equity
2. Today's / cumulative change
3. Next recommended user action
4. AI read-only insight
5. Market/system health

## PAPER

Do not present a trading cockpit. Use a guided ticket:

1. Market state
2. Side/type/input
3. Review amount and protected cash
4. Confirm
5. Result/reconciliation

Timeout UX must prioritize checking order status instead of encouraging a second submit.

## AI

Use an intelligence brief, not a chat-first layout:

- Observation
- Evidence
- Counter-signal
- Uncertainty
- Details

No execution CTA is placed adjacent to AI recommendations.

## Brand

The NUSA mark should abstract island + horizon + lighthouse. Avoid literal palm trees, coin symbols, candlesticks, brains, or generic gradient N marks.

## Reference use

Behance references are used for information hierarchy, spacing, interaction clarity, portfolio glanceability and modern fintech craft. No individual project is copied screen-for-screen.
