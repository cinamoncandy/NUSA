# Portfolio Orchestration v0.1

This slice connects deterministic AI CIO decisions to a bounded portfolio plan and a mobile briefing model.

## Safety boundaries

- Only `deployableCapital` may be allocated.
- Reserved withdrawal and vault capital is reported separately and never enters allocation math.
- Gross portfolio share and futures share are independently capped.
- Duplicate symbol/instrument candidates and future-dated decisions fail closed.
- WAIT, EXIT, SELL, and zero-allocation decisions do not create exposure.
- Spot leverage is always one.
- This module creates plans only. It does not submit exchange orders or enable live trading.

## Mobile contract

The briefing exposes deployed, cash, reserved, spot, and futures capital plus a calm status headline. It contains no profitability promise and preserves the server decision timestamp.
