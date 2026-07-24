# Strategy Health Briefing v0.1

## Purpose

Convert the read-only Daily AI Audit into a deterministic mobile/desktop briefing model. This layer is presentation-only: it cannot place orders, change strategy lifecycle state, enable live trading, or bypass governance.

## Status mapping

- `HEALTHY` -> `NORMAL`
- `WATCH` -> `CAUTION`
- `THROTTLE_RECOMMENDED` -> `WARNING`
- `PAPER_ONLY_RECOMMENDED` -> `BLOCKED`

The overall briefing is `BLOCKED` when any card is blocked, `CAUTION` when any non-normal card exists, otherwise `HEALTHY`.

## Displayed metrics

- total trades and net PnL
- portfolio edge-capture percentage
- confidence calibration error percentage
- execution drag
- per-strategy trade count, net PnL, capture, calibration, execution cost and reasons

## Safety and validation

- future or stale audit snapshots fail closed
- invalid periods, timestamps, numeric values and trade counts fail closed
- duplicate strategy summaries fail closed
- cards sort by explicit severity rank, then strategy ID
- all outputs and nested collections are immutable
- recommendations remain informational until Strategy Governance approves a state change

## Out of scope

- automatic throttling or suspension
- strategy promotion or demotion
- exchange connectivity
- order execution
- API keys or credentials
- live trading
