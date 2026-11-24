# Cross-market study: eligibility risk and the NEAR holes (read 2026-11-24, 09:21 KST)

Evidence note, written before any study result (the cross-market study runs only after 2026-12-10T00:30Z). It changes no rule, threshold, window or authority. Sources: the read-only host diagnosis of 2026-11-24 00:21Z (counts only) and `scripts/run-crossmarket-study.js`.

## 1. What decides eligibility (from the script)
A market takes part only if, over the **168 training hours 2026-11-21T00:00Z .. 2026-11-28T00:00Z**, at least **90 percent (152 hours)** have both (a) a **usable order-book sample** (last sample within 2 minutes before the full hour, bid and ask above 0, bid below ask) and (b) a **complete bar** (all 60 one-minute closes of that hour present or proven exchange-absent), and the **median spread** of those hours is at most **20 basis points**. The study needs **at least 3 eligible markets** (otherwise INSUFFICIENT_DATA) and at least 50 holdout trades.

## 2. What the 2026-11-24 diagnosis shows
- Collection is healthy; the service has run since 2026-11-23 09:00Z without restart.
- **Candles since 2026-11-20T00:00Z** (study counter, minutes holding a close or an absence proof, about 5,780 possible): BTC 5,776, XRP 5,775, ETH 5,750, SOL 5,701, **NEAR 5,513** (about 4.6 percent unaccounted, against 0.0 to 1.4 percent for the others).
- **Whole candle store** (counts only): NEAR 61,666 rows over 45.6 days with 872 minutes proven absent and **3,163 unaccounted** (4.8 percent); BTC 318 (0.5), SOL 1,329 (1.9), XRP 304 (0.3). The NEAR gap-fill runs but records only a few dozen minutes per pass (2026-11-24 00:12Z: 822 missing, 30 recorded), so the unaccounted minutes will not disappear quickly.
- **Order-book coverage** (all markets, last 192 hours): 171 of 192 hours covered (89.1 percent; the readout of 2026-11-24 00:12Z says 89.6 percent), below the 90 percent bar of the order-book study; the six longest gaps (8, 5, 1, 1, 1, 1 hours) lie on 2026-11-16 .. 2026-11-18, before the training week.
- Not available from the diagnosis: per-market counts of **complete bars** or **usable books** inside the training week, and whether the NEAR missing minutes are clustered in a few hours or scattered (scattered minutes would break many bars: one missing minute spoils the whole hour).

## 3. Risks, ranked
1. **Common-mode outage (all markets).** More than 16 hours without usable books or complete bars in the training week would push every market under 90 percent and give INSUFFICIENT_DATA. The usual causes are restarts and release backups (each took 1 to 2 hours; the release of 2026-11-23 09:00Z already fell inside the week). The freeze of 2026-11-24T06:00Z .. 2026-11-28T06:00Z exists to prevent exactly this. **Margin: about 16 hours minus the 2026-11-23 restart.**
2. **NEAR only.** If its holes are scattered, NEAR falls under 90 percent complete bars and the study runs on BTC, ETH, SOL and XRP (4 is at least 3, so it does run). This is a **bounded loss**, not a failure; the output lists the eligible markets.
3. **Median spread above 20 bp** for NEAR: unlikely at its price level, unverified.

## 4. What this note decides
- **Nothing is changed during the freeze** (no release, no restart, no config). Releasing before 2026-12-10 is discouraged even after 2026-11-28T06:00Z: the holdout 2026-11-30 .. 2026-12-10 needs continuous books and bars at the trade hours.
- **No data is edited or "repaired" for the study.** The gap-fill is the normal public-exchange fill that already runs; its speed is not changed here.
- The eligibility result is read from the study output after 2026-12-10T00:30Z (`eligibleMarkets`); a NEAR exclusion is then recorded as such, not as a failure of the rule.

## 5. After 2026-12-10 (proposals for the owner, not decisions)
- Raise the NEAR gap-fill throughput (a config or code change with a release outside any study window) so the unaccounted minutes of the whole 45-day history drop; review the gap-fill's per-pass limit and the reason only about 30 minutes are recorded per pass.
- Add a counts-only per-market preview of "complete bars and usable books per day" to the daily diagnosis, so the next study can be watched during its training week instead of only at the run.
- If NEAR keeps more than 2 percent unaccounted minutes, replace it with a more liquid market through a new pre-result amendment (as for DOGE on 2026-11-22), before the next study's training week.
