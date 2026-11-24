# Broad-universe step 2a: market list and tick sizes (metadata only, 2026-11-24)

Part of `docs/RESEARCH_BROAD_UNIVERSE_DISCOVERY_DESIGN_2026-11-24.md` section 6, step (2). This file commits the **inputs** of the tradability filter before the filter is applied. It contains no candle, price or volume value, and no filter result.

## Committed data
`docs/research-data/broad-universe-market-metadata-2026-11-24.json` (SHA-256 `7dc7dc1869e180cc5af2038059c6ee1bea9a6735195b6d8396e9ceca73295525`): the **300 KRW markets** listed on Upbit on 2026-11-24 with their market-warning and caution flags (8 warnings, 21 cautions) and their **current tick size**.
Sources (public GET, no key): `https://api.upbit.com/v1/market/all?is_details=true` and `https://api.upbit.com/v1/orderbook/instruments?markets=<up to 50 markets>`.

## Rules fixed here (before any filter is applied)
- **Tick source:** the per-market `tick_size` of the `orderbook/instruments` endpoint above (Upbit's own current value; no hand-copied table). It is the **current** tick size: Upbit changed tick tiers over time, so the filter applies the current tick tier of a market to the window median price (a stated proxy, because the 2021-2023 tick sizes are not in the file). Where a market's current tick would put it in a different tier at the window price, the tier of the **current price table implied by this file** is used (tier boundaries are read from the file's tick sizes against today's prices at the time of the count, not typed in by hand).
- **Pegged assets excluded** from every pool: USDT, USDC, USD1, PYUSD (dollar stable coins), EURC (euro), XAUT (gold).
- **Study markets** KRW-BTC, KRW-ETH, KRW-SOL, KRW-NEAR, KRW-XRP, KRW-DOGE are excluded from the **forward** pool (design section 7); in the discovery pool they stay only if they pass the filter.
- **Markets with a warning flag** on the snapshot date are excluded from the forward pool at the pre-registration snapshot (a new snapshot is taken then); the flags in this file are for the count only.

## Next (separate PRs, after the design is merged and this file is on main)
1. The **filter count**: the number of markets passing (a) tick over median close at most 10 bp and (b) median daily traded value at least 1 billion KRW, over the discovery window 2021-12-20 .. 2023-06-30, from **daily** candles (price level and quote traded value only; no return is computed, and daily values of these markets were already read by the earlier all-KRW studies). Output: counts and the list of passing market codes, no value.
2. The **go/no-go gate** of the design: a forward pool of at least 40 markets after the exclusions, otherwise the plan stops and reports "broad route not viable at this tradability bar".
