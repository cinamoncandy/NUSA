# Alpha Lab cross-section recorder handoff — 2026-11-28

## Scope

Work order: `WO-RESEARCH-20261128-CODEX-CROSS-SECTION-RECORDER`
Branch: `codex/cross-section-recorder-20261128`
Base: `092eb7e92958b0a16fd2268752a823ffc7f63604`
Draft PR: [#3361](https://github.com/cinamoncandy/NUSA/pull/3361)
Implementation commit at PR creation: `b8466ada98fa51f85a009576a9cfdbe28f9cf225`

This branch implements only the forward cross-section recorder, its hosted workflow, focused tests, and this task’s AIPOS evidence. It does not change host, application, order, release, risk, authority, or safety-gate code.

## Contract decisions

- Read-only E1 integration uses `research/alpha-lab/registry/events.jsonl`. When `scripts/alpha-lab/registry.js` exists, E3 uses its `readRegistry()` semantic validator; on the current main base, E3’s compatibility reader validates the same `schemaVersion`/`sequence` envelope and `REGISTERED`/`VERDICT`/`RETIRED` transitions. `hypothesisSha256` is SHA-256 of canonical sorted-key hypothesis JSON plus one LF; the registry row hash is SHA-256 of canonical sorted-key row JSON excluding `rowSha256`, without a trailing LF.
- Registration payload fields are `hypothesisSha256`, `kContribution`, `alphaSpent`, `hold`, sorted `universe`, `firstEvaluableDate`, `shortNameKo`, `signal`, and ordered `looks`. No writer, registration command, or production hypothesis is added.
- The absent `scripts/offline-lab-f2b-adaptive-evalue.js` reference is represented by the existing merged synthetic script `scripts/alpha-lab/f2b-evalue-power.js`.
- Signal ranks use only closes through date `t` for supported momentum hypotheses over 3–56 sorted KRW markets. Lookback history is paged from Upbit’s public daily endpoint as needed (up to 3,650 days) using explicit UTC cursors. Each observation requires the completed close for `t+1`; the basket targets the highest-ranked `round(N/3)` markets at equal weights on each registered `hold`-day rebalance. Between rebalances, weights drift according to realized relative close-to-close returns. Turnover at a rebalance compares its new target weights with the prior close's drifted weights and costs are `0.0015 * sum(abs(newWeight - oldWeight))`. The observation payload schema is version 2 and persists both start-of-day and closing weights. Missed dates fail closed without backfill. The last outcome close must be no later than the final declared look; terminal verdicts, retirement, and the look boundary prevent further market-data fetches.
- The e-process is a 50/50 mixture of the existing baseline fixed-lambda mixture and predictable adaptive bet, using prior-only 4-sd clipping, a 20-day burn-in, and `1 / alphaSpent` threshold. PASS is latched at its first crossing and the status retains the crossing day and value.
- The public Upbit fetcher is disabled before `2026-12-10T00:00:00Z`, until 15 minutes after the UTC daily close, without a matching active registered hypothesis, before its `firstEvaluableDate`, or while the earliest required lookback date is before `2026-12-06`. It requests only the exact required candle count/date range (pages capped at Upbit’s 200-row limit) and fails closed on missing/out-of-range rows without extending the range. Workflow schedule is 00:17 UTC and workflow_dispatch is guarded to `main`; it runs on `ubuntu-latest` with job-scoped `contents: write` only and persists cumulative state to the fixed `alpha-lab-cross-section-data` branch. `.github/workflow-authority-map.json` records only that job’s `contents` write, `secrets: false`, and `environment: null`.

## Data and test disposition

- No production hypotheses or registry rows were created.
- No market-data requests were made and no results artifact was produced.
- Tests build only temporary synthetic registry rows and candle responses; F2b comparison uses the checked-in synthetic generator and does not fetch.
- An additional compatibility smoke test used a temporary copy of the reader alongside the actual E1 `registry.js` at PR #3355 head `7f8aaf0d749b6bab8d82a49b23633dbc0ee31767`; synthetic registration and retirement were read correctly without network access. The E1 PR was inspected only and was not merged or copied into this branch.
- The design link in the work order cites Section 7, but the referenced v3 design on the implementation base has Sections 1–6 only. Implementation used available Section 2, the F2b script, and the owner-approved E3 decisions.

## Validation / next action

Local gates after the weight-drift correction: recorder tests 14/14 (synthetic/no network), combined recorder and workflow regression tests 46/46, `node --check` PASS, ESLint PASS, workflow authority map PASS (53 workflows), workflow action pins and input validation PASS, YAML parse PASS, AIPOS YAML PASS (843 files), work-order index PASS, `pnpm run preflight` PASS, and `git diff --check` PASS. Observation rows now use schema version 2 and store close-to-close drifted holdings; the dedicated data branch did not exist at the read-only remote-head check, so no record migration was needed. The prior GitHub CI result applies only to head `0417445d60e405eccc0b527c7cde092cbcf2f841`; it is stale for this correction. The live checks on Draft PR #3361 are the source of truth for exact-head CI; no result is recorded here because doing so would itself change the tested head. Independent review is pending. No merge, release, host operation, hypothesis registration, or market-data fetch was authorized by this task.
