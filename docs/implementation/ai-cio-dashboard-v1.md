# AI CIO Dashboard v1

AI CIO Dashboard is a read-only command-center projection for Paper/DRY_RUN operations.

## Inputs

- portfolio capital and exposure
- Opportunity OS allocation state
- Daily AI Audit and strategy health
- investment committee decision
- execution quality
- research promotion gates
- risk and kill-switch state

## Fail-closed behavior

The dashboard becomes `BLOCKED` when any section is stale or blocked, the kill switch is active, or the research promotion gate is not passed. A committee `REJECT` or `EMERGENCY_EXIT` also disables the trading-permitted display flag.

Capital fields, ratios, timestamps, counts, and section status values are validated. Deployable plus reserved capital may not exceed total equity.

## Mobile projection

The mobile view model provides immutable metric cards for equity, deployable capital, exposure, PnL, edge capture, committee decision, confidence, execution quality, slippage, drawdown, portfolio heat, and active opportunities.

## Safety boundaries

- no order submission
- no strategy mutation
- no champion promotion
- no live exchange adapter
- no credentials or private API
- read-only display data only
