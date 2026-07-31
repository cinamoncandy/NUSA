# Dokkaebi Operator Manual

Before each session, verify API read-only connectivity, balance, open orders,
Shadow comparison, reconciliation, Risk, and Kill Switch status. Start only
when the startup check is clear. A failed check blocks the session.

During operation, monitor Health, Alerts, Evidence, and the session state.
Treat disconnects, reconciliation differences, unknown submissions, and restart
requirements as fail-closed conditions. Acknowledge alerts only after recording
the operational reason; acknowledgement never deletes an alert.

At shutdown, stop the session normally, confirm open orders are resolved or
explicitly reported, and export the daily report and Evidence bundle.
