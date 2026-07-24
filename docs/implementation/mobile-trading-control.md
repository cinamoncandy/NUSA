# Mobile Trading Control Contract

## Scope

This module defines the deterministic command contract used by a future mobile client and cloud API for owner controls. It does not send network requests, cancel exchange orders, enable live trading, or persist credentials.

Supported commands:

- `PAUSE`: stop new Paper activity without forcing order cancellation.
- `EMERGENCY_STOP`: stop trading and request cancellation of open orders.
- `RESUME_PAPER`: resume Paper mode only after strong authentication and runtime safety checks.

## Safety rules

- Expired, future-dated, excessive-lifetime, duplicate, and non-monotonic commands fail closed.
- `RESUME_PAPER` requires strong authentication.
- Resume is blocked when the runtime is unhealthy, the kill switch is latched, or the control state is faulted.
- No command in this contract can enable Live trading.
- Every accepted command produces an immutable audit record.

## Integration boundary

The cloud command handler will authenticate the owner, supply trusted server time and runtime health, call `applyTradingControlCommand`, persist the audit record, and only then dispatch approved effects to the trading worker.
