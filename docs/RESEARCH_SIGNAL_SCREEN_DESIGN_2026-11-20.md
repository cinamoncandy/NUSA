# Design (not a pre-registration): a pooled signal screen for L1 candidate supply (PAPER research)

Status: **design for review, written 2026-11-20 (KST). Nothing here is built, run or binding.** A pre-registration would be a separate document after the owner's decision. Learning loop level: L1 candidate supply (`docs/LEARNING_LOOP_LEVELS_20261112.md`). Related: `docs/RESEARCH_MARKET_EXPANSION_DESIGN_2026-11-19.md`, `docs/RESEARCH_PREREG_2026-11-19_CROSSMARKET_MOMENTUM_60M.md`.

## 1. Problem
L1 has produced no candidate in 811+ experiment records, and every pre-registered study so far tests **one** hypothesis on one span and can detect only a **large** edge (the cross-market study: about 240 trades, 80 percent power only for a net edge near 0.16 percent per trade). One hypothesis per span is slow: each study costs about three weeks of calendar time, and a clean negative says little. The bottleneck is not ideas but how much information one span can give.

## 2. Idea: screen many candidate signals at once with the statistic that has the most power
Use the **hourly rank information coefficient** (Spearman correlation between a signal and the next-hour return across the five collected markets), which the cross-market study already defines as its stage 1 and which is more sensitive than a top-1 trade test. Compute it for a **fixed list of signals**, all from data that is already collected (candles, order-book top, trade ticks), on one pooled panel, and control the family-wise error. A signal that passes the screen is only **eligible for its own pre-registered tradability test** (costs, spreads, a later span); the screen never promotes anything.

## 3. Proposed fixed family (to be frozen in a pre-registration, not here)
- About 10 to 12 signals, each defined by a formula fixed in advance: trailing return over 1, 6, 24, 72 h; realized volatility over 24 h; volume surge (last hour over the 24 h mean); range position (close within the 24 h high-low range); order-book imbalance at the decision time (top levels); spread in bp; trade-flow imbalance of the last hour; the market's return relative to the five-market mean.
- Target: next-hour close-to-close return per market (and, separately labelled, the next 4 h).
- Statistic per signal: mean hourly rank IC over the screening span; test by the circular block bootstrap with block 24 (as in the cross-market study); **Holm adjustment over the whole family** (K = family size x 2 targets); a signal needs a positive IC and an adjusted p below 0.05.
- Spans: fixed in the future, a train part that fixes any standardisation only, a validation part reported, and a holdout opened once, as in the other studies. Two parts are enough because nothing is selected on validation.

## 4. What it can and cannot say
- It can show **whether any** of the listed signals has hourly predictive information on these markets. With about 240 holdout hours and five markets, an IC near 0.05 is the order of what can be seen; smaller ones are invisible. This is stated up front like the power statement of the cross-market study.
- It cannot show profit: an IC above zero says nothing about fees, spread or capacity. A pass leads only to a pre-registered tradability study.
- Overlap with other studies: the 24 h momentum signal duplicates the cross-market study's stage 1 on the same markets. To avoid counting one hypothesis twice, the screen either excludes that signal or uses a later span than the cross-market holdout and says so.

## 5. Risks and honest prior
- Low prior: a signal that survives Holm adjustment on liquid KRW spot at hour scale is unlikely; the value of the screen is information per calendar week, not a high chance of success.
- Order-book signals carry the coverage problem seen in the order-book study (coverage 68 percent against a 90 percent bar). Signals that need a book are dropped for any hour without a usable book and the usable share is reported.
- Data reuse: XRP candle values are not blind (earlier experiments read them). The screen should use the four new markets plus XRP and say that XRP is not blind.

## 6. Decision needed from the owner before anything is written as a pre-registration
1. Do you want a screen of this kind (information per week) rather than more single-hypothesis studies? Recommended: yes, one screen after the cross-market holdout so that the span does not overlap.
2. Allowed signal sources: candles and order-book top only, or also trade ticks (collected, v2 study uses them)?

## 7. What this document does not do
No code, no run, no experiment, gate, threshold, limit, capital, order switch or authority change. `experimentMarkets` stays KRW-XRP.
