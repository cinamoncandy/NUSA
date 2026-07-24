# AI CIO Electron IPC v1

## Purpose

Expose the validated AI CIO Command Center envelope to the sandboxed Electron renderer through one read-only IPC request.

## Channel

```text
ai-cio:snapshot
```

The preload API exposes:

```text
getAiCioSnapshot(): Promise<AiCioCommandCenterEnvelopeV1 | null>
```

`null` means no validated dashboard snapshot has been published yet. It must not be interpreted as a healthy operating state.

## Safety boundaries

- no order, cancel, strategy mutation, promotion, or live-trading command is added;
- the renderer receives no Node.js, credential, exchange, or persistence access;
- unsupported, future-dated, or expired envelopes fail closed;
- the in-memory source can be cleared after faults or producer shutdown;
- the source stores only an immutable validated envelope;
- the PR remains PAPER/DRY_RUN only.

## Producer boundary

This change wires the transport but does not invent dashboard data. A later aggregator service may publish a validated envelope into `InMemoryAiCioEnvelopeSource`. Until then the renderer receives `null`.

## Validation

Regression tests cover channel registration, empty state, valid immutable delivery, expiry rejection, and explicit clearing.
