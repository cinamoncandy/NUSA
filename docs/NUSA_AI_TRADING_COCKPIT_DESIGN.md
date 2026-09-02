# NUSA AI Trading Cockpit Design

## Status

Normative UX direction for the canonical NUSA Electron Paper Trading client. This document refines, but does not replace, `docs/NUSA_USER_EXPERIENCE_PRINCIPLE.md`.

## North star

NUSA is not a decorative market dashboard. It is an evidence-first trading cockpit that helps the OWNER understand current truth, decide what deserves attention, and take the next safe action with minimal cognitive switching.

The default experience must answer six questions in roughly one visual scan:

1. What is my current account outcome?
2. Is market/runtime data healthy enough to act?
3. What is NUSA currently doing or saying?
4. What exposure and Paper positions exist?
5. Is an action available, blocked, or unnecessary?
6. What changed most recently?

## Design principles

### 1. Three-second truth

The top of the application always prioritizes execution mode, connectivity, assets, PnL, exposure, automation state, and freshness. Decorative content never outranks these truths.

### 2. Action adjacency

Evidence and the action it informs should be physically close. Market context sits beside the Paper order station. NUSA state sits beside its Paper controls. Position outcome sits beside portfolio composition and the risk-evidence boundary.

### 3. Evidence before confidence

NUSA may show a conclusion only to the depth supported by canonical runtime evidence. If confidence, invalidation, horizon, drawdown, concentration, benchmark, or similar evidence is not exposed by the runtime, the UI says that it is unavailable. It never fills the gap with plausible-looking values.

### 4. Safety is structure, not decoration

PAPER/live-disabled state is repeated in the global header, order safety notice, confirmation sheet, and authority settings. Color reinforces state but never carries the meaning alone.

### 5. Progressive disclosure

Default surfaces communicate task-level meaning. Technical identifiers, raw events, and future evidence/provenance belong deeper in the activity and diagnostic layers.

### 6. Dense, not crowded

Density comes from alignment, shared baselines, compact labels, tabular numerics, and deliberate grouping. It does not come from shrinking type until information becomes difficult to scan.

### 7. One semantic system across desktop and mobile

Desktop uses a persistent left navigation and wide command canvas. Mobile uses five primary destinations and a separate Settings entry, but PAPER/LIVE, risk, health, and action semantics remain identical.

## Canonical information architecture

The renderer keeps the existing six route boundaries to preserve runtime and deep-link contracts while changing their product meaning.

| Canonical route | Cockpit product meaning | Primary task |
| --- | --- | --- |
| `dashboard` | Command Home | scan account, market health, automation, exposure, NUSA state |
| `orders` | Markets + Order Station | inspect current market truth and place an explicit Paper order |
| `positions` | Portfolio + Risk | understand capital, positions, composition, PnL, and available risk evidence |
| `strategy` | AI Decision / NUSA | inspect runtime-backed NUSA state, latest signal, and Paper controls |
| `logs` | Analytics + Activity | review realized/unrealized outcome and chronological operating/trading events |
| `settings` | Settings + Authority | change presentation only and inspect the current Paper-only authority boundary |

Top-level Markets, Risk Center, and Analytics concepts therefore exist without creating parallel runtime owners or pretending that unavailable backend contracts already exist.

## Desktop wireframe

```text
┌───────────────┬─────────────────────────────────────────────────────────────┐
│ NUSA          │ NUSA COMMAND                           MARKET ●   PAPER ONLY │
│               ├─────────────────────────────────────────────────────────────┤
│ Home          │ Market health │ Automation │ NUSA state │ Freshness        │
│ Trade         ├─────────────────────────────────────────────────────────────┤
│ Portfolio     │ COMMAND HOME                                                │
│ NUSA          │ ┌────────┬────────┬────────┬────────┬────────┐              │
│ Activity      │ │ Equity │ PnL    │Exposure│Position│ Price  │              │
│               │ └────────┴────────┴────────┴────────┴────────┘              │
│               │ ┌────────────────────────────┬───────────────────────────┐  │
│               │ │ Equity / market canvas     │ NUSA current decision     │  │
│               │ │                            │ state / last signal       │  │
│               │ └────────────────────────────┴───────────────────────────┘  │
│               │ ┌─────────────────────────────────────────────────────────┐ │
│ Settings      │ │ Current positions / immediate activity                 │ │
│               │ └─────────────────────────────────────────────────────────┘ │
└───────────────┴─────────────────────────────────────────────────────────────┘
```

## Markets + Order Station wireframe

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ KRW-BTC        Current price        Change        Market health      PAPER   │
├──────────────────────────────────────────────┬──────────────────────────────┤
│ Market / equity canvas                       │ NUSA state                   │
│                                              ├──────────────────────────────┤
│                                              │ Paper order station          │
│                                              │ Quantity                     │
│                                              │ Price / notional / fee       │
│                                              │ [Paper Buy] [Paper Sell]     │
├──────────────────────────────────────────────┴──────────────────────────────┤
│ Recent Paper fills                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Portfolio + Risk wireframe

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Equity │ Unrealized │ Realized │ Cash │ Exposure                           │
├───────────────────────────────────────┬─────────────────────────────────────┤
│ Equity curve                          │ Allocation                          │
├───────────────────────────────────────┼─────────────────────────────────────┤
│ Risk evidence boundary               │ Runtime health                      │
│ Available facts only                 │ Market / Automation / NUSA          │
│ Missing limits are marked unavailable│                                     │
├───────────────────────────────────────┴─────────────────────────────────────┤
│ Holdings                                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Mobile wireframe

```text
┌──────────────────────────────┐
│ NUSA       MARKET ●   PAPER  │
├──────────────────────────────┤
│ Equity              PnL      │
│ Exposure            Position │
├──────────────────────────────┤
│ NUSA current state           │
│ latest runtime signal        │
├──────────────────────────────┤
│ Primary panel / cards        │
│ essential columns only       │
├──────────────────────────────┤
│ Home Trade Portfolio NUSA Log│
└──────────────────────────────┘
```

On mobile, financial tables keep keyboard/scroll semantics but secondary columns are hidden so the essential outcome does not require horizontal panning. Paper order confirmation becomes a bottom sheet.

## Visual language

- Dark, low-glare operating ground.
- One primary interaction accent.
- Success, warning, and danger remain semantic status colors.
- Borders, spacing, and typography do more hierarchy work than shadows.
- Financial values use tabular numerics and stronger visual weight than labels.
- Panels align to a shared grid with restrained radius.
- Repeated status strips use compact uppercase or short task labels.

## State semantics

### Healthy

Show the authoritative state and allow only actions already permitted by runtime gates.

### Loading

Preserve layout and indicate that truth is pending. Do not substitute zero.

### Disconnected / stale / error

Make the degraded condition visible near the affected action. Paper order controls remain governed by existing runtime fail-closed logic.

### Unavailable evidence

Use explicit text such as `현재 canonical runtime에서 제공되지 않음`. Unavailable is not zero, safe, healthy, or neutral.

### Empty

Explain the absence of positions, orders, or history without implying an error.

## Interaction contract

- Frequent navigation and inspection: one deliberate action.
- Paper order: input -> explicit side selection -> confirmation sheet -> submit.
- Authority-changing LIVE interactions: not present in this work order.
- Settings: presentation/diagnostic only.
- Focus indicators remain visible.
- Touch targets remain at least 44px; primary mobile order targets should be at least 52px.

## Content hierarchy

1. Mode / health / freshness.
2. Account outcome and exposure.
3. NUSA state and market context.
4. Position and Paper action surfaces.
5. Activity and advanced diagnostics.

## Deferred data contracts

The cockpit design reserves semantic space for the following but must not synthesize them:

- AI confidence and detailed rationale;
- invalidation and horizon;
- explicit risk limits and breach reasons;
- drawdown and concentration;
- benchmark comparison;
- realized-vs-MTM attribution beyond existing canonical values;
- richer order lifecycle states.

These become active only when a canonical backend/runtime contract supplies authoritative values.

## Definition of done

The redesign is successful when the OWNER can scan current truth quickly, the next safe action is obvious, PAPER/live-disabled status is unmistakable, mobile preserves essential outcomes, and no polished surface creates evidence that the runtime does not actually possess.
