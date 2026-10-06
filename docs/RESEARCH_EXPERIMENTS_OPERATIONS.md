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

## What it does
1. Every tick it turns stored public ticker observations into closed 1-minute candles and stores them durably
   (incomplete minutes are dropped; the oldest retained minute is skipped).
2. Once enough history exists (train + validation + holdout, 11 days by default) it runs, per challenger variant
   (four SMA parameter sets against an SMA 5/20 research proxy of the PAPER baseline), a VALIDATION experiment and,
   only if the challenger wins and the holdout was never used for that configuration, one HOLDOUT experiment.
3. Each experiment carries full provenance, is ledgered, and feeds the `research` status the app's LEARNING line shows.
4. A new session per variant starts each KST trading day; the previous day's sessions are stopped.

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
1. `[research-experiments] enabled: markets=... variants=4 tickMinutes=...` right after start. A
   `disabled: <reason>` line means a setting is invalid; fix it and restart (nothing ran).
2. `[research-experiments] tick ...` lines every tick. `started=0 experiments=0` during the first ~11 days is expected
   (not enough candles yet), not a fault.
3. After the history window fills: `tick ... experiments=N completed=M`. `candidate gate eligible (not registered ...)`
   is informational only; nothing is registered or promoted.
Any `ERROR`/`SKIPPED` experiment carries a stable reason and is never retried or forced; report it instead of
changing thresholds. If the log shows nothing at all, the flag is not exactly `1`.
