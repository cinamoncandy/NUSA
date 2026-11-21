# Continuous research experiments: operations

Research evidence only. LIVE NONE, no orders, no capital, minimum-order, risk or execution change, no paid AI.
Nothing is promoted or registered by this path.

## Default: OFF
The feature does nothing unless `NUSA_CLOUD_RESEARCH_EXPERIMENTS` is exactly `1`. Deploying a build that contains
it changes no behaviour except one additive SQLite migration pair (026 closed candles, 027 holdout usage), which
run on the first start of that build.

## Enabling (owner action on the PAPER host)
Set in the service environment, then restart: `NUSA_CLOUD_RESEARCH_EXPERIMENTS=1` and `NUSA_SOURCE_COMMIT_SHA=<40-hex
commit of the deployed build>` (the build commit is required; a missing or malformed value keeps it disabled and logs
`[research-experiments] disabled: <reason>`).

Optional tuning (invalid values keep it disabled): `NUSA_RESEARCH_MARKETS` (default `KRW-BTC`, at most 5),
`NUSA_RESEARCH_TRAIN_DAYS` (7), `NUSA_RESEARCH_VALIDATION_DAYS` (2), `NUSA_RESEARCH_HOLDOUT_DAYS` (2),
`NUSA_RESEARCH_TICK_MINUTES` (30, 5-360), `NUSA_RESEARCH_DAILY_BUDGET` (48 per variant, at most 288).

## History backfill (on by default when research is on)

At start (after 20 s, retried up to 3 times 10 minutes apart if a request fails or is rate limited) the runtime
fills the candle store for each research market from Upbit's public 1-minute candle endpoint
(`GET https://api.upbit.com/v1/candles/minutes/1`, no credentials), so the first experiment does not wait the
full train + validation + holdout days (plus one day of margin) for live collection.

- It only writes candles older than anything already stored, decided at the moment of each append, so it cannot
  conflict with or replace live-collected candles. Only fully closed minutes are accepted and every candle is
  validated; invalid ones are dropped and counted.
- Requests are sequential (150 ms apart), 10 s timeout each, bounded in number. A 429 stops the attempt.
- Provenance: history is the exchange's own candles; candles collected afterwards are ticker-derived. They can
  differ slightly at the seam and a market with minutes without trades has gaps in the exchange data.
- Log lines: `[research-backfill] KRW-XRP COMPLETE recorded=... rejected=... pages=...`.
- Turn it off with `NUSA_RESEARCH_BACKFILL=DISABLED` (any value other than `ENABLED` also disables it) and restart.

### Deeper history only: `NUSA_RESEARCH_BACKFILL_DAYS` (optional, unset = unchanged)
The backfill normally reaches back `train + validation + holdout + 1 day` (12 days with the 7/2/2 defaults). The
history-mining tool and the learning loop need more candles than that. `NUSA_RESEARCH_BACKFILL_DAYS` deepens ONLY the
historical backfill walk to `max(that span, N days)`. The experiment windows, dataset manifests, the gap-fill window,
experiment identity, hashes and fingerprints still use the 12-day span and are not changed.

- A plain integer 1 to 45 (no sign, no leading zero, no exponent, no hex): 45 days = 64,800 one-minute rows, which leaves about
  24 days of live growth inside the 100,000-row cap of the candle store. **Recommended: 45.** Anything else (0, 46, `abc`,
  `1.5`, `045`) is IGNORED with the log line `NUSA_RESEARCH_BACKFILL_DAYS ignored: expected a plain integer 1..45`
  (default depth, research stays on: a typo in the paste must not switch research off). Blank or unset: no change.
- Owner step on the host (not part of any release; applied by a restart). Append one line, do not print the file
  (it holds secrets):
  `grep -q '^NUSA_RESEARCH_BACKFILL_DAYS=' /etc/nusa/cloud-runtime.env || echo 'NUSA_RESEARCH_BACKFILL_DAYS=45' | sudo tee -a /etc/nusa/cloud-runtime.env >/dev/null`
  then restart the service. Only a build that contains this setting reads it; on an older build it is ignored.
- Effect: about 45 x 1440 / 200 = 324 requests per market (about 4 x 324 = 1,300 requests for the four new markets, plus the
  58-day market re-verifying its stored pages), 150 ms apart plus latency: roughly 1 to 3 minutes per market, run once after
  start. A rerun (every restart) walks again from the newest page and re-requests every page: idempotent (stored rows are
  not replaced) but not free. A rate limit or an error is retried at most twice, 10 minutes apart; **an INCOMPLETE result
  (a hole in the older part of the walk, for example an exchange maintenance minute) is final for the run and is not
  retried** (a retry would re-request and re-hash the whole window without ever healing it; the candle_extent probe shows
  the missing minutes). Gap-fill only heals the recent experiment window, so holes older than that stay. While the backfill
  runs, the experiment tick and gap fill wait their turn and the thread is handed back after every page.
- The candle store keeps the newest 100,000 rows per market: after about 24 days of live growth the oldest rows are trimmed
  and a restart re-requests the trimmed days (bounded, but wasted). Remove the line once the history is in, or keep it.
- Log: `[research-backfill] KRW-BTC COMPLETE recorded=... pages=...`.

## What it does
1. Every tick it turns stored public ticker observations into closed 1-minute candles and stores them durably
   (incomplete minutes are dropped; the oldest retained minute is skipped).
2. Once enough history exists (train + validation + holdout, 11 days by default) it runs, per challenger variant
   (four SMA parameter sets, three RSI mean-reversion sets and three Donchian breakout sets, all against an SMA 5/20
   research proxy of the PAPER baseline), a VALIDATION experiment and,
   only if the challenger wins and the holdout was never used for that configuration, one HOLDOUT experiment.
3. Each experiment carries full provenance, is ledgered, and feeds the `research` status the app's LEARNING line shows.
4. A new session per variant starts each KST trading day; the previous day's sessions are stopped.
5. Strategy families: SMA crossover variants (`sma_<fast>_<slow>`, experiment family `sma-research[-Nm]`) and RSI
   oversold mean-reversion variants (`rsi_<period>_<threshold>`: RSI 14<30, 14<25, 7<20, take-profit 3%, stop-loss 2%,
   12-bar time limit; experiment family `rsi-research[-Nm]`). The grids are fixed in code before any result is seen;
   nothing is tuned on validation or holdout evidence. Donchian breakout variants (`donchian_<period>`: buy when the close
   breaks above the highest high of the previous 10, 20 or 30 bars, take-profit 3%, stop-loss 2%, 12-bar time limit;
   experiment family `donchian-research[-Nm]`) are the momentum / breakout family. Each bar length (1m/15m/60m) runs all
   ten variants.

## Expectations and limits
- No experiment can run before about 11 days of candles exist, so the LEARNING line shows candles-driven progress only
  after that. This is by design: nothing is trained on thin data.
- Results come from a research proxy backtest (the DSL cannot express every behaviour of the live strategy) with explicit
  costs (fee 0.05%, slippage 5 bps); they are research evidence, never PAPER fills, and they do not lower the 30-day /
  50-trade candidate gate.
- Memory: reads at most 11 days of one-minute candles per market per experiment; the host has 1 GB, so keep the market
  list short.

## Disable / rollback
Unset the flag and restart. Stored candles, holdout records and ledgered evidence stay (append-only); nothing else is
affected. To undo the schema, revert the build; the two extra empty tables are harmless.

## Verifying after enabling
Check the service log, in this order:
1. `[research-experiments] enabled: markets=... variants=10 tickMinutes=...` right after start (4 SMA + 3 RSI + 3 Donchian). A
   `disabled: <reason>` line means a setting is invalid; fix it and restart (nothing ran).
2. `[research-experiments] tick ...` lines every tick. `started=0 experiments=0` during the first ~11 days is expected
   (not enough candles yet), not a fault.
3. After the history window fills: `tick ... experiments=N completed=M`. `candidate gate eligible (not registered ...)`
   is informational only; nothing is registered or promoted.
Any `ERROR`/`SKIPPED` experiment carries a stable reason and is never retried or forced; report it instead of
changing thresholds. If the log shows nothing at all, the flag is not exactly `1`.
