# Pre-registration: forward confirmation of the RET48 rule (2026-11-24, revised after independent review)

Status: **binding once merged**; written before any forward data is read. Owner decision 2026-11-24 ("만들어 / 승인"). It follows the H2 look (`docs/RESEARCH_HISTORY_MINING_H2_LOOK_RESULT_2026-11-24.md`, LOOK_FAIL: the excess over the always-in baseline was positive for all five rules but its p-value was 0.027 to 0.088 against the pre-registered 0.01). Nothing here reinterprets that result, reopens the 2023-2024 hold-back, or promotes anything.

## 0. In plain words
- We test **one rule again on data that does not exist yet**, and we read the result **once, on a fixed date (2028-03-31)**. Before that date nobody reads any price from the test span.
- The rule: buy after a strong 48-hour rise (top 10 percent of hours), hold 24 hours. It looked good in the 2023-2024 look but not good enough to pass the strict bar, and it was chosen from 128 rules, so it needs a fresh test.
- Most likely outcomes: a clear PASS only if the effect is real and about as large as it looked (roughly 6 chances in 10 then); otherwise FAIL or INCONCLUSIVE. A pass changes nothing by itself: no orders, no Stage B, no limits or capital.

## 1. What is tested (frozen now)
One **primary** rule and one **secondary** rule, both long-only, with the signal thresholds **taken unchanged from the discovery record** (`docs/research-data/history-mining-h2-freeze-record-2026-11-23.json`, fingerprint `dc65065c...fdaa5`); the thresholds are never re-estimated on the hold-back or on forward data:
| role | rule | signal | threshold (limit) | hold |
|---|---|---|---|---|
| primary | `RET48_HIGH_Q90_H24` | 48-hour return at or above the limit | 0.06434783 | 24 h |
| secondary | `RET48_HIGH_Q80_H24` | 48-hour return at or above the limit | 0.03293838 | 24 h |

Markets: KRW-BTC, KRW-ETH, KRW-SOL, KRW-NEAR (XRP stays discovery-only). Data: the host store's one-minute bars, using only the bar that closes on the full hour (the hourly close), exactly as `scripts/run-history-mining.js` reads them; no filling of holes. Entry: decision at the hourly close t, entry at the next hourly close t+1h, exit after 24 hours. The next decision of the same market may be taken from t+24h on (its entry close equals the previous exit close; the frozen code sets `free = exit - H`). Costs as frozen: round trip 0.10 percent base, 0.30 percent stress.

## 2. Span, blindness and the decision date
- The span starts at the later of **2026-12-11T00:00Z** and the UTC midnight after this document is merged (it must be merged before the first span data is read). It begins after the pre-registered cross-market holdout (2026-11-30 .. 2026-12-10).
- It ends at the **single decision date 2028-03-31T00:00Z** (about 15.7 months). **No count-triggered stop and no early look.**
- **Blindness:** no candle value, signal, trade count or statistic of the span may be computed or read before the decision date. This also respects the signal screen V2's convention (nobody reads candle values from 2026-12-11T00:00Z before its run, which may not start before 2027-01-17T00:30Z). Allowed before the date: only counts of hourly rows present per market (to watch the data-integrity bar) and the quarterly row-hash job of section 6, which prints the hash and counts only and is the single permitted exception to V2's reading convention (its first run, 2027-03-31, falls after the earliest V2 run).
- The data from 2024-11-01 to 2026-11-19 **cannot** serve as the fresh span: the committed hourly files (2025-01-16 .. 2026-10-12) and the daily candles (2021-2026) were read by earlier studies, so that span is not unseen.
- Expected size: the primary rule produced 340 trades in 16 months (about 21 a month; the secondary about 42), so about 330 primary trades by 2028-03-31. The trade rate depends on the regime and may differ.

## 3. Decision rule (frozen)
Evaluated once with a new script that imports the **unchanged** pure functions of `run-history-mining.js` (`tradesFor`, `signalTable`, `baselineFor`, `excessOf`, `timeBlockBootstrapP`, `passDecision`) and the frozen constants: time-block bootstrap, block 24, 10,000 resamples, seed 20261121; the primary rule uses seed offsets 0 (net) and 1000 (excess), the secondary 1 and 1001; tests are one-sided.
- **Baseline** (defined for a span that has ended): per market, the mean net of entering at every usable decision hour t in [span start, decision date - 25 h] whose entry (t+1h) and exit (t+25h) closes are both present, with the same 24 hour hold and costs. The bootstrap time range is [span start, decision date). Closes from 72 hours before the span start may be read as lookback.
- **Trade window:** trades use the same decision-hour window as the baseline, [span start, decision date - 25 h]; entry and exit both fall on or before the decision date. A decision whose exit would fall after it is not made.
- **Primary PASSES** only if all hold: at least **200 resolved trades**; mean net above 0; mean stress above 0; excess above 0; one-sided p(excess) below **0.05**. A resolved trade has entry and exit closes present; unresolved ones are dropped and counted.
- **Secondary** (gatekeeping, family alpha stays 0.05): tested at 0.05 **only if the primary passes**; if the primary does not pass the secondary is reported descriptively and counts for nothing. The study passes if and only if the primary passes.
- **INCONCLUSIVE**: fewer than 200 resolved primary trades at the decision date. Not a fail, not a pass; the span is not extended.
- **FAIL**: at least 200 trades and no pass. Final for this rule and this span definition.
- **DATA_INTEGRITY_FAIL** (void; a repeat needs a new pre-registration): any market with more than 10 percent of hours without a top-of-hour bar in the span, or the quarterly row-hash of section 6 failing.
- If a market is delisted or halted during the span it is dropped and the others stay; the span is not extended.
- A PASS only makes the rule a **candidate for a later, separately pre-registered tradability test (spread-adjusted)**. It grants no authority: PAPER orders, Stage B, risk limits and capital remain governed by their own written approvals.

## 4. Power, stated honestly
From the published look: one-sided p(excess) 0.0265 at 340 trades means z about 1.94 and a standard error of about 0.33 percentage points. At about 330 trades the standard error is about 0.33. If the true excess equals the observed 0.64 percent (probably an overestimate after choosing 1 of 128 rules), the chance to pass at alpha 0.05 is roughly 60 percent; if it is 0.3 percent, roughly 25 percent; if it is zero, 5 percent by construction. At the expected rate the 200-trade floor is almost surely met (even at 70 percent of the look's trade rate), so INCONCLUSIVE is unlikely unless the market regime changes sharply. **A FAIL is therefore likely even for a real but smaller effect.** The test is cheap (the host already collects the data) and fully pre-registered; it is a quiet check, not a plan to find a winner quickly.

## 5. Descriptive items (never part of the decision)
Per-market and per-quarter sign tables, block 72 and 168 sensitivity, break-even cost, entry-rate drift against the nominal rate (the Q80 rule drifted to 1.11 in the look), a spread-adjusted view using the host's order-book samples of the same hours (the old costs are probably optimistic), and a sensitivity run that counts the unresolved trades as zero and as a loss.

## 6. Data identity
At the decision, the script computes a SHA-256 over the ordered rows (market, close time, close) of the span and prints it with counts and range. The collector may gap-fill from the exchange until that read; rows changed after it are void. To detect a rebuilt or migrated store, at each calendar quarter end from 2027-03-31 on a job commits two hashes and counts (hash and counts only): **(a)** over (market, close time) of every hourly row **older than 7 days** at that moment, and **(b)** over (market, close time, close) of the same rows. Adding a previously missing bar older than 7 days changes (a) and is **tolerated** (it is a normal late gap-fill: the later hash of the same quarter must contain every earlier row); changing or deleting any existing row's close, or deleting any row, changes (b) for that row and is **not tolerated**. At the decision the script checks that every row of the last committed hash still exists with the same close; otherwise DATA_INTEGRITY_FAIL. The script implements exactly this and is unit-tested on synthetic data (added bar tolerated; changed close, deleted row and rebuilt store rejected).

## 7. Implementation steps (separate reviewed PRs, none reads a span value)
1. `scripts/run-history-mining-forward.js` (new; the existing script and its constants stay untouched because `GRID_FINGERPRINT` includes `CUT`): its own loader with explicit bounds, hard-coded thresholds checked against the freeze record, the seed offsets above, the 200 rule and alpha 0.05; unit tests on synthetic data only.
2. A dispatch-only host workflow with a spent-once guard and the owner's confirmation sentence (like `history-look-freeze.yml`), refusing to run before 2028-03-31, plus the quarterly hash workflow.
3. A commit of the file hashes of these scripts before the first span data is read. If this document is merged after 2026-12-11, the span start moves as stated in section 2.

## 8. What this does not do
It does not reopen H2, tune the rules, add markets, change the costs or the 2023-2024 pass bar, or touch the freeze window of 2026-11-24 .. 2026-11-28 (documents and scripts only).

## Words explained
- *Always-in baseline*: the average result of entering at every hour with the same 24 hour hold, so a rising market does not count as skill.
- *Excess*: the rule's average result minus that baseline.
- *Bootstrap / one-sided p*: a resampling test of how often chance alone would give an excess at least this large; smaller is stronger.
- *Gatekeeping*: the second rule is only tested if the first passes, so the overall error budget stays at 5 percent.
- *Resolved trade*: a trade whose entry and exit hourly closes both exist.
