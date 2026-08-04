# Decision 0003 — Runtime Composition Root

Status: Accepted

Date: 2026-08-04

## Context

Desktop assembled the Paper command engine and started it separately from the monitor lifecycle. That made runtime ownership and shutdown paths implicit.

## Decision

`RuntimeCompositionRoot` in `packages/core` is the sole production entry point that creates `NusaRuntime`. Host-specific roots compose its engines and own their host resources. `DesktopCompositionRoot` owns the Desktop Paper engine and read-only monitor.

### Runtime creation ownership

`RuntimeCompositionRoot` owns `NusaRuntime`, `EngineRegistry`, and engine registration. Desktop code must not construct `NusaRuntime` or `EngineRegistry` directly.

### Lifecycle

Creation registers dependencies only. `start()` starts runtime engines once, and `stop()` safely stops them once. Desktop starts and stops its monitor through the same root, and stopping the Paper engine marks Paper commands unavailable.

### Dependency injection

Hosts construct concrete dependencies at the composition boundary and pass engines into the shared root. Engines receive runtime services through the existing service container; they do not create host dependencies or rely on globals.

### Why create and start are separate

Separating composition from execution keeps construction free of network, monitor, and engine-start side effects. It permits startup ordering, failure handling, and tests to inspect the composed runtime before execution.

### Desktop and Oracle reuse

The shared core root has no Electron dependency. Desktop supplies its Paper engine and monitor; a future headless Oracle can supply its own engines without a second runtime lifecycle implementation.

### Testability

The root accepts explicit engines and the Desktop adapter accepts a monitor starter. Tests can verify one-time start and stop behavior, no pre-start effects, and command rejection after shutdown without an Electron process or network listener.

## Consequences

No order, fill, ledger, risk, or Live Trading behavior changes. The read-only mobile monitor retains its existing configuration and responses; only its start and stop are owned by the Desktop composition root.
