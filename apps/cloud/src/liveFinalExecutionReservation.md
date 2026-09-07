# LIVE final execution reservation

The final durable reservation is the linearization point for a broker-bound LIVE attempt.

It atomically verifies the authoritative owner/session identity, exact session revision, ACTIVE state, kill switch, revocation, time window, and duplicate fingerprint before recording the reservation.

A STOP, revoke, kill-switch, capital change, or session replacement that commits before this reservation makes the attempt fail closed. A state change that commits after the reservation cannot retroactively erase an already-reserved external side effect; therefore callers must not describe this boundary as distributed atomicity with the broker. Production mutation remains disabled until a separately governed broker protocol defines cancellation/idempotency semantics for that post-reservation interval.

Safety invariants remain `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI `ZERO_AUTHORITY`.
