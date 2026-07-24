# Cloud Control Plane v0.2

## Scope

This slice connects the mobile control contract to a deterministic cloud-side command processor.

Supported commands:

- `PAUSE`
- `EMERGENCY_STOP`
- `RESUME_PAPER`

Live activation is intentionally unsupported.

## Safety rules

- commands expire and future-issued commands fail closed
- duplicate command IDs are idempotent
- accepted command timestamps must increase monotonically
- Paper resume requires strong authentication
- unhealthy, faulted, or kill-switched runtimes cannot resume
- emergency stop activates the kill switch and requests cancellation of open orders
- every decision emits an immutable audit event

## Boundary

This module does not expose HTTP, persist credentials, call exchanges, or place orders. A future transport adapter may serialize the shared contract, but it must not bypass this processor.
