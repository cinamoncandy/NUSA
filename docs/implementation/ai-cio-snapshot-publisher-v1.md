# AI CIO Snapshot Publisher v1

## Purpose

The publisher is the only path from completed AI CIO dashboard sections to the Electron read-only snapshot source.

It does not invent missing values. Portfolio, opportunities, strategy health, committee, execution, research, and risk sections must all be present and fresh before a dashboard envelope is published.

## Flow

```text
validated section producers
  -> completeness and freshness gate
  -> dashboard aggregator
  -> PAPER/DRY_RUN envelope
  -> in-memory read-only IPC source
  -> renderer request
```

## Fail-closed behavior

The current snapshot is cleared and the renderer receives `null` when:

- any required section is missing;
- any section is stale;
- any section is dated in the future;
- dashboard validation fails;
- capital, ratio, timestamp, or section invariants fail.

A prior healthy snapshot is never retained after incomplete or stale replacement input.

## Desktop lifecycle

The in-memory AI CIO source is cleared during desktop runtime initialization and shutdown. Restart therefore cannot expose a previous process snapshot as current truth.

## Safety boundary

- PAPER/DRY_RUN only;
- no order submission;
- no strategy mutation;
- no live-adapter activation;
- no credential or Node capability exposed to the renderer;
- no partial-data fallback presented as healthy.
