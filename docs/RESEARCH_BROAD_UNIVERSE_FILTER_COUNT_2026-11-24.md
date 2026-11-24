# Broad-universe step 2b: tradability filter count and go/no-go gate (2026-11-24)

Part of `docs/RESEARCH_BROAD_UNIVERSE_DISCOVERY_DESIGN_2026-11-24.md` section 6, step (2). Counts and market codes only; no price, volume or return value is printed or committed.

## What was run
`scripts/broad-universe-filter-count.js` (public GET, no key) on the committed metadata (SHA-256 `7dc7dc18...5525`): daily candles of each of the 300 markets for the discovery window 2021-12-20 .. 2023-06-30; median daily close and median daily quote traded value (`candle_acc_trade_price`) only. Result file: `docs/research-data/broad-universe-filter-count-2026-11-24.json` (SHA-256 `bfeca784...5a7`).

Rules (as fixed in the design and the metadata note): median tick / median close at most 10 bp; median daily traded value at least 1 billion KRW; a market listed inside the window enters 30 days after its first candle; at least 30 usable days; pegged assets excluded. Tick tiers are read from the committed file's tick sizes against current prices (boundary: lowest current price seen with the higher tick; the alternative boundary is reported as a sensitivity).

## Counts
| Step | Markets |
|---|---|
| in file | 300 |
| at least 30 usable days in the window | 92 |
| pass tick bar | 37 |
| pass traded-value bar | 91 |
| pass both | 36 |
| after pegged assets | 36 (discovery pool) |
| after the six study markets and current warning flags | **29 (forward pool)** |
| same, alternative tick boundary | 26 |

## Gate
The design requires a forward pool of **at least 40** markets. It is **29** (26 with the alternative boundary): **the gate is not passed. Broad route not viable at this tradability bar.** Nothing is fetched and no tooling PR starts.

## Limits
- Only 92 of 300 markets existed with enough data in the window; delisted markets are not in the list (survivorship).
- The tick bar is the binding filter (91 pass the value bar, 37 the tick bar); tick tiers are a proxy (current tiers, not 2021-2023 tiers).
- **Scope of the gate:** the count answers for the discovery-window filter pool (36 before the exclusions, already below 40). The design's forward list is a separate snapshot rule at pre-registration, and markets listed after 2023-06 could enter it; they have no usable window days here and are not counted. The verdict is not shown for that snapshot pool. The owner stopped the route on this count; a snapshot count was not made.
- **Not reproducible to the digit:** the tier boundaries come from live ticker prices at run time, and neither the tier table nor the ticker snapshot is committed. The two boundary rules (29 and 26) bracket the choice.
- Upbit omits days without trades, so the daily medians run over trading days only (lenient on the value bar). The tick is applied at the median close, not as a median of daily ticks.
- Independent review (read-only): no P1; the points above are its P2/P3 findings.
- The forward pool is finally decided at the pre-registration snapshot, so 29 is an estimate of it, not the pool.

## Owner decision (2026-11-24: "1")
The owner chose option 1: **the broad route stops here.** No looser filter, no fetch, no tooling PR for it. The RET48 forward test and the cross-market study stay the confirmation paths. Reopening the broad route needs a new owner decision and a new pre-registration.

## Options that were offered
1. Stop the broad route; the RET48 forward test and the cross-market study stay the confirmation paths.
2. Pre-register a looser filter **from these counts** before any candle is fetched (the design allows it), with the cost consequence and the lowered trade floor written down. The counts are only a basis: the choice must be fixed before use and must not be tuned on returns.
