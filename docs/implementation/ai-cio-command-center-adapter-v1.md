# AI CIO Command Center Adapter v1

## Purpose

This adapter defines the versioned, read-only transport boundary between the AI CIO dashboard aggregator and Electron renderer/mobile presentation layers.

## Contract

The envelope contains:

- schema version `1`
- operating mode: `PAPER` or `DRY_RUN`
- dashboard generation time
- explicit expiry time
- immutable AI CIO dashboard snapshot

## Safety behavior

The adapter fails closed when:

- the source snapshot is from the future
- the snapshot is older than the configured maximum age
- the maximum age is zero or invalid
- the transport version is unsupported
- the envelope is expired
- envelope and snapshot timestamps differ
- the payload cannot be serialized as plain data

The source object is cloned before freezing so later producer-side mutation cannot change data already exposed to the renderer.

## Explicit exclusions

This module does not:

- place, cancel, or modify orders
- enable live trading
- change strategy or governance state
- expose credentials, Node.js APIs, or exchange adapters
- bypass kill switches or risk controls

A future Electron IPC handler may expose only this envelope through a dedicated read-only channel after a real dashboard snapshot provider is wired. No command channel is part of this contract.
