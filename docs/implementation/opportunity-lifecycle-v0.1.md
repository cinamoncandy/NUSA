# Opportunity Lifecycle and Edge Decay v0.1

This module manages an investment opportunity as a lifecycle rather than a one-shot BUY/SELL signal.

States:

`DETECTED -> VALIDATED -> BUILDING -> ACTIVE -> REDUCING -> EXITING -> CLOSED`

Terminal fail-closed states are `REJECTED` and `EXPIRED`.

Each signal declares an observation time, half-life, edge estimate, and confidence. The engine applies exponential half-life decay, subtracts modeled execution cost, and produces a deterministic action: `REJECT`, `WAIT`, `BUILD`, `HOLD`, `REDUCE`, or `EXIT`.

Safety boundaries:

- future-dated or zero-half-life signals are rejected;
- negative net edge exits existing exposure or rejects new entry;
- below-threshold edge reduces active exposure instead of adding risk;
- expired opportunities cannot open new exposure;
- Kill Switch forces exit for any open lifecycle;
- outputs are immutable and deterministic;
- no exchange adapter, private API, credential, withdrawal path, or live order flow is included.
