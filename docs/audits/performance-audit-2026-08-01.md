# Runtime Performance Audit

Audited commit: 5b486dd

## Measurement

Workload: 200,000 unique KRW-BTC ticks through `StrategyEngine` with a 500-entry history and SMA periods 5/20. Node process benchmark; no network, Electron window, or live exchange mutation.

Before optimization:

- elapsed: 143.5161 ms
- throughput: 1,393,571.87 ticks/sec
- history: 500 entries

After optimization:

- elapsed: 57.2973 ms
- throughput: 3,490,565.87 ticks/sec
- history: 500 entries

Observed improvement: approximately 60.1% lower benchmark time and 2.50x throughput. This is a single-process microbenchmark, not a one-hour runtime or production performance claim.

## Change

SMA rolling averages no longer allocate a combined array and sliced window for every tick. The summation order remains deterministic, history remains bounded, and signal-equivalence tests pass.

Unverified: CPU trend, GC frequency, Electron render latency, IPC throughput, disk writes, and long-duration memory growth.
