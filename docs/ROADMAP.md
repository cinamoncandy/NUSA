# Roadmap

This roadmap separates verified baseline behavior from proposed work. A roadmap item is not an implementation guarantee.

## Completed Baseline

### Exact accounting contracts

- Immutable ledger and snapshot models
- Raw `bigint` accounting
- Wallet and strategy scopes
- Deterministic ledger ordering

### Durable projection storage

- SQLite schema and repositories
- Idempotent ledger insertion
- Applied-marker runtime
- Atomic ledger append and snapshot projection
- Commit and rollback semantics with error identity preservation
- File-backed restart recovery
- Explicit deterministic rebuild
- Read-only audit access

### Pure pre-trade risk

- Oversell block
- Raw order quote limit
- Raw resulting position limit
- Raw realized-loss limit
- No storage or network dependency

### Verification baseline

- Real TypeScript `tsc --noEmit`
- TypeScript build
- Independent behavioral tests using Node's test runner

## Next: Control Plane Foundation

Define a process-neutral control-plane contract before adding operator interfaces.

- Read-only status, position, PnL, and risk queries
- Command authorization and audit records
- Explicit PAPER-only runtime mode
- Event model for fills, risk blocks, strategy faults, and connectivity changes
- No direct exchange calls from operator adapters

Exit criteria: adapters can invoke only the control plane, every command is auditable, and an unconfigured adapter is inert.

## Next: Paper Execution Runtime

Introduce a deterministic paper-order lifecycle without live credentials.

- Order intent and lifecycle contracts
- Simulated fills and fees
- Projection integration
- Idempotent event processing
- Restart-safe pending-order recovery
- Kill switch and conservative startup defaults

Exit criteria: deterministic replay and recovery tests cover submit, fill, cancel, rejection, and restart.

## Next: Market Data and Connectivity

Add provider interfaces with health reporting.

- WebSocket lifecycle state
- Reconnect and backoff policy
- Sequence-gap detection
- Stale-data risk block
- Provider-independent normalized market events

Exit criteria: disconnect, reconnect, stale feed, and sequence-gap behavior is observable and tested.

## Next: Strategy Runtime

Run strategies behind risk and execution boundaries.

- Strategy lifecycle and fault isolation
- Deterministic scheduling inputs
- Position and risk context injection
- Fault and pause events
- Per-strategy exposure accounting

Exit criteria: a strategy cannot bypass pre-trade risk or submit directly to an exchange adapter.

## Next: Operator Surfaces

Build operator interfaces only after the control plane is stable.

- Telegram remote center for allowlisted users and chats
- Desktop operator shell
- Read-only audit views
- Alert routing and delivery retries

Secrets must be supplied through environment or an external secret provider and must never be committed.

## Deferred: Live Trading

Live trading is explicitly out of scope. Before it can be considered, the project requires a separate threat model, credential boundary, exchange-adapter contract, staged rollout plan, reconciliation design, and operator approval flow. PAPER mode remains the default and only supported mode until those gates are reviewed.
