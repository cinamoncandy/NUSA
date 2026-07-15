# AI CIO Electron Dashboard v1

## Boundary

The dashboard is a PAPER/DRY_RUN read-only operating view. `window.aiCioDashboard` exposes one input-free method, `getAiCioDashboard`. It has no order, control, promotion, Champion, Kill Switch release, filesystem, database, or Node.js method. The existing trading controls remain outside this namespace. Internal exceptions, paths, stack traces, and secrets are converted to a fixed unavailable response.

## Data flow

Operational evidence flows through capital and withdrawal protection, opportunity scheduling, strategy health, committee, execution, research, and risk sections into the dashboard aggregator. The main process validates a serializable expiring envelope before crossing preload isolation. The renderer receives only that validated read model.

Each section declares `AVAILABLE`, `STALE`, `UNAVAILABLE`, or `INVALID`. Explicit severity is `HEALTHY < CAUTION < BLOCKED`; when every section is unavailable the result is `NO_DATA`. One unavailable or invalid required section blocks. Stale evidence produces at least caution. Kill Switch, research failure, blocked strategy evidence, and capital mismatch block regardless of healthier sections.

Section timestamps cannot be later than the aggregation timestamp or current time. Expired envelopes are unavailable. Capital must reconcile as total equity equals deployable plus reserved within tolerance. Ratios use 0..1 internally and are formatted as percentages only in the renderer.

## Renderer

The responsive command center displays system, portfolio, opportunity, strategy, committee, execution, risk, research, freshness, and warning sections. Missing values are rendered as `?곗씠???놁쓬`, never invented zeroes. PAPER/DRY_RUN and LIVE TRADING DISABLED are permanently visible. Polling starts at five seconds, prevents overlapping requests, uses bounded backoff, invalidates stale prior health on failure, and clears its timer on unload.

This view does not guarantee investment returns. Responsive web layout supports narrow iPhone and Galaxy widths without introducing Flutter or another UI framework. LIVE activation remains unimplemented and requires separate owner, security, regulatory, and operational review.


## Paper runtime projection

The Electron main process republishes the read-only envelope after a market tick, Paper order, or Control Plane state change.

Only values derived directly from the local Paper account are marked `AVAILABLE`. Engines that are not connected to this runtime projection remain `UNAVAILABLE`; their numeric placeholders must not be interpreted as observations. A partially populated projection is therefore `BLOCKED` with `tradingPermitted=false`, while still allowing the operator to inspect verified Paper equity and exposure.

Any projection, validation, freshness, or serialization failure clears the previous envelope. The renderer then shows `NO_DATA` or `UNAVAILABLE` instead of retaining prior health. This projection cannot submit orders, change controls, release a kill switch, or enable LIVE trading.

## Persisted research projection

The research section reads only persisted Desktop SQLite research manifests and validation reports. A report is accepted only when its run ID, run type, and result checksum match one immutable manifest. The three persisted report types are Walk-Forward, Cost Stress, and Integrity Check. Missing evidence remains explicitly `UNAVAILABLE`; failed evidence remains visible as `AVAILABLE/BLOCKED` and never becomes a positive gate by omission. The current persisted report contract has no Monte Carlo result, so it is explicitly reported as `MONTE_CARLO_EVIDENCE_NOT_RECORDED` and cannot make the promotion gate pass. This projection creates no research record, changes no strategy lifecycle, and cannot promote a strategy or permit trading.


## Paper risk scope

The Electron projection exposes only risk values that can be derived from the local spot Paper account:

- drawdown relative to configured initial Paper equity;
- gross/net spot exposure and portfolio heat from marked position value;
- liquidation buffer fixed to `1` because this runtime is unleveraged spot Paper trading;
- a local safety lock when persistence or the Paper runtime is unavailable.

The local safety lock is not a substitute for the cloud/global Kill Switch. Committee, execution-quality, research, and cloud runtime-health risk remain `UNAVAILABLE` until their real sources are instantiated and connected. Their absence keeps the aggregate dashboard `BLOCKED`.


## Paper execution scope

The current PaperBroker fills an accepted order immediately, completely, and at the supplied ticker price. The dashboard therefore reports the execution model assumptions as `PAPER_SYNTHETIC_EXECUTION`: fill quality `100%`, slippage `0 bps`, and latency `0 ms`.

These values describe the simulator, not real exchange execution quality. They provide no evidence about queue position, spread crossing, network latency, partial fills, market impact, or LIVE readiness. A Paper runtime or persistence fault changes the execution section to `INVALID/BLOCKED`.


## Stable warning identity

Availability and freshness warnings use stable source names rather than positional indexes, for example `SECTION_COMMITTEE_UNAVAILABLE` and `SECTION_RESEARCH_STALE`. This makes operator evidence and regression logs understandable even if the internal section array is refactored. Warning codes are deterministic, de-duplicated, and lexically sorted.


## Aggregate validation boundary

The aggregate rejects zero freshness windows, negative allocation/reserve/slippage values, fractional strategy counts, scores outside `0..1`, blank committee labels, and other non-finite operational metrics. Invalid source data is never normalized into a plausible dashboard value; publication clears the previous envelope and fails closed.
