# NUSA Decision Context Dock v1

## Purpose
Keep the user's selected instrument, market context, position, risk, AI evidence, and permitted PAPER action in one stable decision surface.

## Decision order
1. Instrument and current market state
2. Position and exposure
3. Risk impact
4. AI conclusion and evidence
5. Permitted action and resulting state

## UX rules
- The selected instrument remains visually anchored while related context changes.
- PAPER, SHADOW, and LIVE state must be explicit text, not color-only.
- LIVE capability must never be implied by a generic enabled action style.
- Risk information precedes the action control.
- AI evidence shows uncertainty and invalidation conditions when available.
- Loading, stale, empty, and error states retain the same information hierarchy.
- Keyboard focus order follows the decision order.
- Mobile collapses secondary evidence before removing core decision context.

## Proposed anatomy
- Context header: symbol, market status, mode, freshness
- Market block: price, change, liquidity/market-quality indicators available in existing data
- Position block: size, average price, unrealized P/L, exposure
- Risk block: exposure delta, concentration, and relevant warnings
- AI block: conclusion, confidence, evidence, counter-evidence, invalidation
- Action block: permitted PAPER action with explicit mode and confirmation context

## Guardrails
This document defines presentation and interaction structure only. It does not grant trading authority, alter execution logic, or infer LIVE permissions.

## Validation criteria
- User can identify mode within one glance.
- User can identify current exposure before an action.
- Risk is visible before action selection.
- AI reasoning is distinguishable from executable action.
- No critical state relies solely on color.
- Layout remains usable at narrow viewport widths and with keyboard navigation.
