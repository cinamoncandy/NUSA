# Control Audit Ledger v0.2

## Scope

This module provides a deterministic, append-only, hash-chained audit ledger for mobile control-plane decisions.

It does not persist records to a database, expose a network endpoint, activate Live trading, or submit exchange orders.

## Guarantees

- every record has a strict sequence number
- every record commits to the previous record hash
- every event is validated before append and replay
- accepted emergency stop events must request open-order cancellation
- only emergency stop events may request open-order cancellation
- duplicate audit events require a prior original decision
- a command cannot receive two non-duplicate decisions
- event timestamps cannot move backwards
- accepted state transitions must match the recorded resulting mode
- an active kill switch cannot be cleared by replaying a Paper resume event
- replay output is deterministic and immutable

## Replay output

The ledger rebuilds:

- runtime mode: `PAPER`, `STOPPED`, or `FAULTED`
- kill-switch state
- processed command identifiers
- latest audit decision timestamp
- current ledger head hash

## Safety boundary

The ledger proves internal ordering and tamper detection for the stored event chain. It does not prove the identity of the remote user, database durability, clock authenticity, or successful cancellation at an exchange. Those controls belong to later authenticated API, persistence, and execution layers.
