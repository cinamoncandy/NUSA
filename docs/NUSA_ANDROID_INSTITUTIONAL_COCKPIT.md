# NUSA Android Institutional Cockpit

## Objective

NUSA Android is a mobile-first supervision and PAPER trading cockpit. The target is not a decorative fintech dashboard. It is a high-trust operational instrument that lets the owner understand state, opportunity, risk, and the next safe action in seconds.

## Scope

Android only. iOS presentation is intentionally unchanged by this work order.

This redesign is presentation-only:

- PAPER execution semantics are unchanged.
- LIVE authority remains NONE.
- production mutation remains disabled.
- AI remains ZERO_AUTHORITY and read-only.
- market/freshness/risk/PnL truth is never synthesized by the presentation layer.
- credentials, broker transport, runtime state machines, and risk policy are out of scope.

## Visual identity

### Base

- graphite black background
- low-contrast green-black surfaces
- restrained 1px boundaries
- minimal shadow/elevation
- compact geometry with small radii
- high-density, strict alignment

### Semantic accents

- NUSA teal: primary action, ready/positive state, selected navigation
- cold blue: analysis and AI evidence context
- amber: warning, attention, incomplete readiness
- red: danger, rejection, negative PnL
- neutral gray: unavailable, secondary metadata, non-authoritative context

Decorative neon and glow are intentionally suppressed. Accent color is a semantic signal, not decoration.

## Information hierarchy

1. authority / PAPER boundary
2. connection / freshness / readiness
3. capital and PnL
4. market state
5. AI evidence and judgment
6. position / orders / risk
7. secondary diagnostics

The user should be able to identify the current safety boundary and actionable state within roughly three seconds without opening a secondary screen.

## Android interaction contract

- minimum interactive target stays 48dp
- primary order actions stay visually dominant
- selected state must not rely on color alone
- financial numerics should use tabular or monospace presentation where the component supports it
- error/warning text remains explicit; icons or color are supplementary
- scrolling screens use compact vertical rhythm rather than card inflation
- cards are panels, not floating decorative objects

## Home

Home is the command surface. The Android `master` visual profile is denser than the cross-platform default:

- 12dp horizontal rail
- 10dp primary section rhythm
- tighter hero and terminal panels
- reduced radius
- compact metadata typography
- verified values remain dominant over decorative graphics

Home keeps existing canonical runtime and PAPER truth sources. The Android visual profile only changes geometry.

## Markets

Markets remains public-observation first. A selected market does not become an AI recommendation or order target merely because the user opened it. The desired visual treatment is chart-first, compact, and read-only in tone.

## PAPER

PAPER is the execution workspace. It must always distinguish observation data from PAPER execution state. Public Upbit charts remain read-only context. The Android accent may emphasize action boundaries but cannot imply LIVE capability.

## Portfolio

Portfolio leads with PAPER operating result and keeps REAL_READ_ONLY data as a separate reference baseline. The visual design must never blend these balances or PnL values.

## AI

AI surfaces are evidence-first. Teal/blue indicate analysis context, not execution authority. ZERO AUTHORITY remains explicit anywhere an AI judgment might otherwise be mistaken for an executable instruction.

## System chrome

Android launch background, status bar, navigation bar, and native accent align with the graphite/teal cockpit palette to avoid a white launch flash or visually detached system chrome.

## Accessibility

- retains 48dp interaction minimums
- preserves system light/dark status-bar legibility
- preserves reduced-motion behavior in shared primitives
- maintains text labels for semantic status
- focus/selection contrast is higher than passive panel borders

## Validation

Required before PR creation/merge under repository policy:

- `pnpm run validate`
- `pnpm run lint:mobile`
- relevant Android/mobile tests including `tests/android-institutional-cockpit.vitest.js`
- Android build/type checks required by the repository
- `git diff --check`
- physical-device visual QA when available

Until those checks run, no validation PASS is claimed.
