# Atomic Hedge Submission Resilience v0.1

The PAPER/DRY_RUN hedge coordinator now treats spot and perpetual order submission as two independent outcomes.

## Safety behavior

- Both submissions are awaited with `Promise.allSettled`.
- A rejected adapter promise is converted into an immutable failed receipt.
- Two accepted receipts move the coordinator to `SUBMITTING`; this still does not mean either leg is filled.
- One accepted leg and one failed leg move the coordinator to `FAULTED`, append a kill-switch recommendation, and require cancellation or rollback handling by the operator workflow.
- Two failed legs move the coordinator to `FAULTED` without claiming market exposure.
- No live exchange integration, credentials, or private API calls are introduced.

This layer only records submission outcomes. Actual hedge completion remains dependent on reconciled fill quantities and delta checks.
