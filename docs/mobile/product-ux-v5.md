# NUSA Mobile Product UX v5

## Product job
NUSA Mobile is an autonomous PAPER-system supervision product, not an exchange terminal. The primary job is to answer within 2–3 seconds:

1. Is PAPER running normally?
2. What happened to PAPER capital and PnL?
3. Is risk normal or blocked?
4. What is NUSA observing or learning now?

The mobile client never grants trading authority. Production remains `PAPER ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.

## Canonical information architecture
The primary navigation has exactly four jobs:

- **HOME** — current system state and the next thing worth inspecting.
- **MARKETS** — public market context observed by NUSA; read-only and separate from strategy authority.
- **PAPER** — autonomous PAPER operation, virtual execution/accounting, risk and learning evidence.
- **PORTFOLIO** — PAPER equity, cumulative result, allocation and exposure; real-account data remains a separate read-only reference.

AI, risk evidence, learning provenance, diagnostics, notifications and settings are drill-down utilities, not first-class bottom tabs.

## HOME hierarchy
1. System status: `PAPER ACTIVE`, `OBSERVING`, `DEGRADED`, or `SETUP REQUIRED`.
2. PAPER equity hero and cumulative total PnL.
3. Current activity: market/context, current decision posture, or current exposure.
4. Risk state. Normal risk stays compact; blocked/degraded risk expands with cause.
5. Learning state and last verified evaluation outcome.
6. Quick access to MARKETS, PORTFOLIO and learning evidence.

HOME must not become a diagnostics dump. Hashes, gate IDs and provenance belong behind disclosure.

## MARKETS hierarchy
1. Selected public market and current price/change.
2. Chart and data freshness.
3. Market environment/watchlist.
4. Explicit read-only boundary: market observations do not become strategy or order authority.

No BUY/SELL affordance belongs on the production MARKETS surface.

## PAPER hierarchy
1. Runtime/authority rail.
2. Equity, total PnL, risk and learning glance strip.
3. Current cycle: market, signal, decision and risk.
4. Virtual execution/accounting only when evidence exists.
5. Learning/evaluation outcome.
6. Cumulative PAPER result.
7. Progressive disclosure for recent cycles, timeline, hashes, gates and provenance.

PAPER result and learning verdict are distinct concepts and must never be visually conflated.

## PORTFOLIO hierarchy
1. Total PAPER equity and total PnL.
2. Cash allocation and protected reserve.
3. Current exposure/position.
4. PAPER accounting facts.
5. `REAL_READ_ONLY` account reference in a visually separate section that is never summed into PAPER results.

## SETTINGS hierarchy
Settings is a configuration utility, not an operations dashboard. Group by job:

1. **Connections** — Cloud PAPER and Upbit read-only.
2. **PAPER** — local PAPER and capital allocation.
3. **Appearance** — theme and notification preferences.
4. **Advanced** — privacy, user access, diagnostics, reset and local session controls.

Cloud PAPER connection uses a three-step mental model: `SERVER → SECURE SESSION → VERIFIED`. Failure states must say what failed and offer retry; an actual connection error must never be presented as merely “optional”.

## Visual system
- Content-first financial product, not crypto-exchange chrome.
- One strong balance/status surface per screen; secondary sections are flatter and separated by rhythm/dividers instead of identical rounded cards.
- 20dp mobile horizontal inset.
- 48dp minimum interactive target; compact interactive controls must remain at least 44dp.
- 30–36sp financial hero values when space permits; stable tabular numerals for financial values.
- Section titles 18–22sp, body 13–14sp, compact metadata 10–12sp.
- Color never carries state alone: pair color with explicit state text and, where appropriate, shape/icon/border.
- Red/green reserved for actual loss/risk/error and positive outcome semantics; ordinary emphasis uses neutral/primary tones.
- Tablet breakpoint: 768dp. Use two-column supervision layouts where it shortens scanning without mixing authority domains.

## State contract
Every primary screen must deliberately handle:

- loading
- empty/no evidence
- local fallback
- disconnected/not configured
- stale/degraded
- hard error
- healthy/active

Unknown values render as `—`, never fabricated zeroes.

## Android acceptance
Target first: Galaxy S23 FE-class portrait viewport, then Android 15 Pixel 6 emulator and tablet breakpoint.

Acceptance sequence:

1. Fresh launch/local entry.
2. HOME 3-second glance.
3. MARKETS navigation and chart/watchlist touch targets.
4. PAPER top-level glance, scroll and evidence disclosure.
5. PORTFOLIO allocation/exposure/accounting and read-only real-account separation.
6. Settings connection steps, scroll reachability and close path.
7. Return to HOME and verify bottom navigation state.
8. Capture screenshots and native UI hierarchy for each step.

The final Android sign-off requires both automated native navigation/touch assertions and human visual inspection of the captured frames for clipping, overlap, hierarchy, contrast, touch affordance and one-hand reachability.