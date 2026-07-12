# Operational Readiness Gate

This PAPER/DRY_RUN-only gate blocks new entries until runtime evidence is ready. It does not submit orders and cannot override Strategy Governance, Risk, Probability/Edge, Kelly, Capital Allocation, or Kill Switch decisions.

## Policy

- Warm-up must contain the configured number of completed samples. No entry is allowed during warm-up.
- Market data must be fresh and its feature fingerprint must match the approved strategy evidence.
- A disconnect halts operation. A reconnect permits exits only until a deterministic cooldown expires.
- Strategy suspension and active protection locks permit exits only.
- Kill Switch, unresolved recovery, active disconnect, STOPPED, or FAULTED state halt the gate.
- Missing or malformed timestamps fail closed. Results are immutable and deterministic.

These boundaries adapt operational patterns documented by Freqtrade's dry-run, lookahead-analysis, and protection/cooldown features, and QuantConnect LEAN's warm-up and disconnect handling. They are safety patterns, not evidence that any bot or strategy is profitable.

References:

- https://www.freqtrade.io/en/stable/strategy-101/
- https://www.freqtrade.io/en/stable/lookahead-analysis/
- https://docs.freqtrade.io/en/stable/plugins/
- https://www.quantconnect.com/docs/v2/writing-algorithms/historical-data/warm-up-periods
- https://www.quantconnect.com/docs/v2/writing-algorithms/reality-modeling/brokerage-message-handler
