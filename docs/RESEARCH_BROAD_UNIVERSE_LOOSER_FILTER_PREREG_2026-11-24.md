# Broad-universe route reopened: one looser tradability bar, pre-registered before it is counted (2026-11-24)

Status: **binding once merged**; written before the looser bar is applied to anything. Owner decision 2026-11-24 ("넓은 경로 재개(더 느슨한 필터)"), which reopens the route that the owner stopped the same day after `docs/RESEARCH_BROAD_UNIVERSE_FILTER_COUNT_2026-11-24.md` (forward pool 29, gate of 40 not passed). The earlier result stands unedited.

## 1. In plain words
- The first bar left 29 markets (26 with the other tick boundary). The gate needs 40.
- We try **exactly one** looser bar, fixed now, and count once. If the pool is still below 40 the broad route **stops for good**: no third bar, no further loosening.
- The bar is not chosen to reach 40: it is the same 20 bp number the cross-market study already uses as its spread limit.

## 2. The one alternative bar (frozen now)
| item | first bar (#3266) | looser bar (this document) |
|---|---|---|
| median tick / median close | at most 10 bp | **at most 20 bp** |
| median daily quote traded value | at least 1 billion KRW | unchanged |
| listing wait, minimum days, window, pegged and study exclusions, warning flags, tick-tier source and both boundary rules | as in #3265 and #3266 | unchanged |
| gate | forward pool at least 40 | **unchanged: at least 40**, counted with the lenient boundary and also reported with the strict one; the gate uses the **strict** count |

The gate uses the strict boundary on purpose: if only the lenient boundary reaches 40, the route does not pass.

## 3. What loosening costs (stated before the count)
The cost model of the design is the 0.10 percent round-trip fee plus one tick as a spread floor. At 20 bp the floor of one side can be up to 0.20 percent, so the base round trip can reach about 0.30 percent and the stress case (fee 0.30 percent plus twice the floor) about 0.70 percent. A rule found on this pool must clear a higher bar than on the first pool, and small low-priced markets are over-represented. The discovery and the forward test stay descriptive and a pass only makes a rule a candidate for a spread-adjusted tradability test (design section 6).

## 4. What is committed and counted
1. This document (merged first).
2. A count PR: `scripts/broad-universe-filter-count.js` gets a `--tick-bp` option (default 10, so the committed first count reproduces) and records the **tier table and a hash of the ticker snapshot** in its output (the review of #3266 found them missing). The count is made **once** at 20 bp with the committed metadata (SHA-256 `7dc7dc18...5525`); counts and passing market codes only, no price, volume or return value.
3. If the strict forward pool is at least 40: the later steps of the design (tooling PRs, hosted-runner fetch with manifests, discover and freeze record, descriptive hold-back veto, forward pre-registration on a snapshot list) each need their own reviewed PR and the owner's go. If it is below 40: the route stops, recorded in a short note; no other bar is tried.

## 5. What this does not do
It does not loosen any gate, threshold, risk limit or capital, touch the H2 or RET48 results, read any return, fetch hourly data, or use the host. The forward market list stays a separate snapshot rule at its own pre-registration; the count here is only the gate of the design.
