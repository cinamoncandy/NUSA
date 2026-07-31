# Reliability and Recovery

NUSA remains PAPER-only. Recovery never enables automatic trading, bypasses a risk check, deletes user data, or turns a failed session into a live session.

## Failure flow

- The renderer can be recreated after `render-process-gone`; the main process retains its in-memory Paper and Control state and republishes read-only snapshots after the new renderer loads.
- IPC requests use a 3-second timeout and at most three attempts. A renderer-facing failure uses the safe message `데이터를 가져오지 못했습니다.` rather than an internal stack trace.
- Upbit public WebSocket reconnects use exponential backoff and stop after eight attempts. Exhaustion faults the Paper control plane and leaves automatic trading unavailable.
- Health checks inspect IPC, renderer, storage, WebSocket freshness, market-data age, and heap usage every 30 seconds. Non-healthy observations are recorded in the in-memory recovery ledger for the current process.

## Session backup strategy

Paper and Control JSON saves remain atomic. Before a successful replacement, the prior primary file is copied to a `.bak` sibling. When the primary file is corrupt, the store may restore a validated backup, but it also returns a diagnostic. Startup treats that diagnostic as recovery ambiguity: automatic trading remains disabled until an operator repairs and verifies the session.

If both primary and backup are invalid, the application starts from a default Paper state, preserves both files for inspection, faults the control plane, and does not overwrite either file.

SQLite remains the authoritative runtime persistence path and performs `quick_check` on startup. A SQLite integrity or migration failure is fail-closed.

## Boundaries

This layer contains no live order adapter, credential handling, private exchange API, or risk-policy change. It only contains bounded retries, recovery diagnostics, and safe state restoration.
