# Mobile Dashboard API v1

## Purpose

This contract connects the cloud decision pipeline to the mobile control surface without exposing exchange credentials or live-order capabilities.

## Flow

```text
Market intelligence
  -> AI CIO decisions
  -> Portfolio plan
  -> Operational health
  -> MobileDashboardResponse v1
  -> fail-closed mobile decoder
```

## Safety rules

- the API version must match exactly;
- future or stale snapshots are rejected;
- deployed plus cash capital must reconcile to deployable capital;
- instrument totals cannot exceed deployed capital;
- unhealthy or kill-switched states cannot report trading as allowed;
- positions, decisions, reasons, and issue arrays are immutable after decoding.

## Boundary

This is a read-only dashboard contract. It does not add authentication, exchange API keys, withdrawals, live orders, or background deployment.
