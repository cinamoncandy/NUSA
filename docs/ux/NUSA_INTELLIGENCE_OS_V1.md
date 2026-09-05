# NUSA Intelligence OS v1 — Mobile UX architecture

Status: implementation contract
Date: 2026-09-05
Scope: Android-first mobile monitoring/control UX

## Product intent

NUSA mobile is not the trading engine. It is the owner-facing operating console for a 24h PAPER runtime. The interface must answer three questions in order:

1. What is NUSA doing now?
2. Why is it doing that, and what blocks action?
3. What happened to capital as a result?

Success is not visual novelty. Success is verified comprehension on the installed Galaxy build.

## Human comprehension targets

- 3 seconds: owner can identify PAPER/LIVE authority, runtime health, and current operating posture.
- 10 seconds: owner can identify the dominant reason and risk gate.
- 30 seconds: owner can identify PAPER equity, exposure, recent execution state, and learning status.
- UNKNOWN is never rendered as zero.
- AI interpretation is visually and semantically separated from verified facts.
- AI has zero execution authority.

## Information architecture

Primary destinations are conceptually:

- HOME — current operating state
- MARKETS — public read-only observation
- PAPER — supervised execution and fill/accounting context
- PORTFOLIO — capital, exposure, PnL and contribution
- SYSTEM — runtime, data, reconciliation, deployment and authority status

The current application shell may expose SYSTEM through the existing utility/settings surface until the navigation migration is completed. SYSTEM information must not be hidden from the owner.

## Global hierarchy

Every primary screen follows the same vertical grammar:

1. Context / authority rail
2. One dominant statement
3. Verified facts
4. Interpretation / explanation
5. Risk or degraded-state notice
6. Detailed controls / history

Cards are not used as decoration. A bordered surface exists only when it groups one decision or one data domain.

## Global state vocabulary

- ACTIVE — runtime is operating normally
- WAITING — intentionally idle
- STALE — data exists but is outside freshness contract
- DEGRADED — usable with a known impairment
- ERROR — operation failed
- BLOCKED — action intentionally prevented by risk/authority/recovery gate
- UNAVAILABLE — source absent
- NO SIGNAL — verified observation exists but no qualified strategy signal exists
- NOT CONFIGURED — owner setup is required

State is always conveyed by text plus color, never color alone.

## HOME wireframe

```text
NUSA / PAPER ONLY / LIVE NONE / AI ZERO AUTHORITY
MARKET FRESH | SYSTEM READY | RISK NORMAL

NOW
"신규 진입 없이 PAPER 포지션을 감독 중"
why line, one sentence

CAPITAL
Equity | Total PnL | Cash | Exposure

WHY / RISK
verified reason | blocking gate / risk state

SIGNALS
qualified public observations only
NO QUALIFIED SIGNAL when none

PAPER EXECUTION
position / open orders / source

LEARNING
runtime learning state + entry to evidence
```

## MARKETS wireframe

```text
MARKETS / PUBLIC READ ONLY
Selected market + price + verified change + freshness
[CHART] [WATCHLIST]
Observation detail
PAPER context link
```

No market row is implied to be a strategy signal.

## PAPER wireframe

```text
PAPER / SIMULATED EXECUTION
Authority: PAPER ONLY
Public market context
Execution workspace
strategy -> risk gate -> order -> fill -> accounting
```

Real trading affordances are never present.

## PORTFOLIO wireframe

```text
PORTFOLIO / PAPER CAPITAL
Equity | PnL | Cash | Exposure
Capital allocation rail
Position contribution
Open orders
REAL_READ_ONLY reference (separate, never aggregated)
Learning/evidence entry
```

## SYSTEM contract

SYSTEM must expose, either on its dedicated destination or the existing utility/settings surface:

- Cloud runtime state
- public data freshness
- PAPER connection state
- reconciliation / recovery status when available
- build/deployment identity
- PAPER ONLY / LIVE NONE / AI ZERO AUTHORITY
- degraded/error reason before any optimistic summary

## Visual system

- Background: near-black/charcoal from theme tokens
- Primary accent: cyan/teal from theme primary/success tokens
- Secondary accent: existing info token, used sparingly
- Red/yellow reserved for risk/error/warning semantics
- No neon glow as decoration
- Border radius: 16–20 for major surfaces, 10–12 for compact facts
- Numeric facts use tabular numerals where React Native supports it
- 48dp minimum interactive height
- max content width preserved for tablet/foldable layouts

## Accessibility

- 200% font scaling must not make critical facts unreachable.
- No fixed-height text containers for descriptive copy.
- status semantics are readable without color.
- all segmented controls and navigation use accessibility roles/states.
- safe-area and gesture navigation remain shell responsibilities.

## Data integrity

- No fabricated tickers, prices, confidence, PnL, signals or runtime states.
- Placeholder values use `—`, `UNAVAILABLE`, `NO QUALIFIED SIGNAL`, or explicit setup/error copy.
- Public market observation is read-only and never auto-promoted to a strategy signal in the UI.
- REAL_READ_ONLY account data is never summed into PAPER performance.

## Implementation sequence mapped to the 30-point execution plan

1–4 problem, KPI, IA, scenarios: this document.
5 HOME: `homeView.tsx` Intelligence OS hierarchy.
6 MARKETS: `marketsView.tsx` observation-first hierarchy.
7 PAPER: `tradingView.tsx` supervised-execution hierarchy.
8 PORTFOLIO: `portfolioView.tsx` capital-first hierarchy.
9 SYSTEM: authority/runtime contract integrated with current utility surface; dedicated nav migration tracked separately if shell risk is non-zero.
10–14 state model/design system/responsive/accessibility: `intelligenceOs.tsx` + screen contracts.
15–18 wireframe/review/high-fidelity/prototype: screen hierarchy encoded directly in production components and semantic test IDs.
19 real-data mapping: each fact binds only existing verified view-model/source fields.
20–23 implementation priorities and shared components: this change set.
24–25 automated UX/static regression contracts: `tests/mobile-intelligence-os-v1.test.js` plus existing mobile suites.
26–30 physical-device and release gates: CI -> protected main -> exact-main Android Stable -> Galaxy screenshot/build identity -> PRODUCT VERIFIED.

## Release acceptance

Code complete is not product complete. PRODUCT VERIFIED requires all of:

- UX contract implemented
- protected main merge
- Android Stable target SHA equals protected main
- installed Galaxy build identity equals that SHA
- physical Galaxy screenshot visibly matches the new hierarchy

Until all five are true, report PRODUCT VERIFIED = NO.
