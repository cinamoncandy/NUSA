# A5F Operations Control Center

## Purpose

A5F provides a read-only operations projection for Paper, Shadow, Read-only, and the explicitly disabled Live mode. It aggregates application/build identity, exchange and market health, recovery/reconciliation/risk state, resource observations, session state, alerts, incidents, Evidence, diagnostics, and append-only audit records.

## Components

- `OperationsSnapshot`: dashboard and diagnostics projection.
- `HealthEntry`: component health with explicit `HEALTHY`, `WARNING`, `CRITICAL`, or `UNKNOWN` state.
- `SessionManager`: validated operational session transitions with audit events.
- `AlertCenter`: persistent-integration-ready alert model; acknowledgement is recorded and alerts are never deleted.
- `IncidentTimeline`: ordered recovery, reconnect, risk, kill-switch, reconciliation, restart, shutdown, crash, database, and exchange events.
- `EvidenceBrowser`: read-only filters plus JSON/CSV exports.
- `AuditLog`: append-only sanitized operator activity.

## Security boundary

The capability descriptor is `operationsCenterPresent=true`, `auditLogPresent=true`, `healthMonitorPresent=true`, and `productionMutationAllowed=false`. This module exposes no submit, cancel, credential, raw exchange response, or production-enable operation. Secret-like audit values are redacted before storage.

## Recovery and reconciliation

The console displays recovery and reconciliation state but does not auto-retry or resolve either. A future Electron read-only IPC adapter should expose these projections only and route all changes through the existing fail-closed operator procedures.

## Limitations and next steps

This increment provides the operations domain and projection contracts. Durable alert/audit persistence, Electron IPC wiring, and a dedicated renderer screen should be connected to the existing SQLite and sandbox bridge in the next integration increment. Live operation remains disabled until separate risk-limit and operations approval work is complete.
