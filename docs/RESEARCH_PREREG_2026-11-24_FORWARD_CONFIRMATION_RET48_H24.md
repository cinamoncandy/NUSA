# Pre-registration: forward confirmation of the two RET48 rules (2026-11-24)

Status: **binding once merged**; written before any data of the forward span is analysed. Owner decision 2026-11-24 ("만들어 / 승인"). It follows the H2 look (`docs/RESEARCH_HISTORY_MINING_H2_LOOK_RESULT_2026-11-24.md`, LOOK_FAIL: excess over the always-in baseline was positive for all five rules but p(excess) 0.027 to 0.088 against the pre-registered 0.01). Nothing here reinterprets that result, reopens the 2023-2024 hold-back, or promotes anything.

## 1. What is tested (frozen now)
Two long-only rules from the frozen H2 shortlist, with the signal thresholds **taken unchanged from the discovery record** (`docs/research-data/history-mining-h2-freeze-record-2026-11-23.json`, fingerprint `dc65065c...fdaa5`); the thresholds are never re-estimated on the hold-back or on forward data:
| rule | signal | threshold (limit) | hold |
|---|---|---|---|
| `RET48_HIGH_Q90_H24` (primary) | 48-hour return at or above the limit | 0.06434783 | 24 h |
| `RET48_HIGH_Q80_H24` (secondary) | 48-hour return at or above the limit | 0.03293838 | 24 h |

Markets: KRW-BTC, KRW-ETH, KRW-SOL, KRW-NEAR (the hold-back set; XRP stays discovery-only). Entry: decision at hourly close t, entry at the next hourly close t+1h, exit after 24 h, next decision not before the exit (the frozen entry rule `NEXT_HOURLY_CLOSE`). Costs as frozen: round trip 0.10 percent base, 0.30 percent stress. Data: the host store's hourly close rows (`interval_ms` 60000, `close_time_ms` on the hour), exactly as `scripts/run-history-mining.js` reads them; no filling of holes.

## 2. Forward span and when the test is run
- The span starts **2026-12-11T00:00Z**, after the pre-registered cross-market holdout (2026-11-30 .. 2026-12-10). It shares data with later pre-registered studies (for example the signal screen V2) but each tests its own frozen hypothesis; no result feeds back into another.
- The test runs **once**, when the **primary rule has 300 resolved trades pooled over the four markets**, or on **2027-12-31T00:00Z**, whichever comes first. Between the start and that moment only the trade counts may be looked at (a count is not a result); no interim p-value, mean or sign table is computed or read.
- Expected duration: the primary rule produced 340 trades in 16 months in the hold-back (about 21 per month), so 300 trades take about 14 months (about February 2028 at that rate, so the 2027-12-31 stop is likely to arrive first with fewer than 300 trades).

## 3. Decision rule (frozen)
For each rule the span is evaluated with the unchanged code path of the look: net mean, stress mean, excess over the unconditional always-in baseline of the same span (same markets, same hold, same costs), time-block bootstrap with block 24, 10,000 resamples, seed 20261121 (the constants of `run-history-mining.js`).
- A rule **PASSES** only if all hold: at least 300 resolved trades; mean net above 0; mean stress above 0; excess above 0; and p(excess) below **0.025** (family alpha 0.05, Bonferroni over the two rules).
- With **fewer than 300 trades** at the stop date the result is **INCONCLUSIVE** (not a fail, not a pass); the span is not extended and no look is repeated.
- With at least 300 trades and no pass the result is **FAIL**; it is final for these rules and this span definition.
- **DATA_INTEGRITY_FAIL** (result void, to be repeated only by a new pre-registration): any market with more than 10 percent missing hourly closes in the span, or a span read from rows that were changed after the fact.
- One pass is not a launch: a PASS makes the rule a **candidate for the permit-producer and qualification work** only. PAPER orders, Stage B, risk limits and capital remain governed by their own written approvals; nothing in this document grants authority.

## 4. Power, stated honestly
From the published look statistics the standard error of the excess is about 0.33 percentage points at 340 trades. If the true excess equals the observed 0.64 percent (likely an overestimate after selection from 128 rules), the chance to pass at alpha 0.025 with about 300 trades is roughly 40 percent; if the true excess is 0.3 percent it is about 15 percent. **INCONCLUSIVE and FAIL are therefore the likely outcomes even if the rule is real.** The test is cheap (the host already collects the data) and fully pre-registered; it is not a plan to find a winner quickly.

## 5. Descriptive items (never part of the decision)
Per-market and per-quarter sign tables, block 72 and 168 sensitivity, break-even cost, entry-rate drift against the nominal rate, and a spread-adjusted view using the host's order-book samples of the same hours (the old costs are probably optimistic).

## 6. Implementation steps (separate reviewed PRs, before the span's data are analysed)
1. A forward-confirmation script that fixes this document's rules and constants and reads only the host store's closes from the span start; unit tests on synthetic data; pinned by SHA-256 in the manifest of the next step.
2. A dispatch-only host workflow (like `history-look-freeze.yml`) with a spent-once guard, the owner's confirmation sentence, a pre-check that prints only the trade count of the primary rule, and output of aggregates only.
3. A commit of this pre-registration's file hashes (scripts and thresholds) before 2026-12-11T00:00Z.
No step reads a forward value before the decision moment of section 2.

## 7. What this does not do
It does not reopen H2, tune the rules, add markets, change `COST` or the pass bar of the 2023-2024 look, or touch the freeze window of 2026-11-24..2026-11-28 (documents and scripts only).
