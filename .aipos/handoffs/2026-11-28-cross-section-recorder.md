# Alpha Lab cross-section recorder handoff — 2026-11-28

## Scope

Work order: `WO-RESEARCH-20261128-CODEX-CROSS-SECTION-RECORDER`
Branch: `codex/cross-section-recorder-20261128`
Base: `092eb7e92958b0a16fd2268752a823ffc7f63604`

This branch implements only the forward cross-section recorder, its hosted workflow, focused tests, and this task’s AIPOS evidence. It does not change host, application, order, release, risk, authority, or safety-gate code.

## Contract decisions

- Read-only E1 integration uses `research/alpha-lab/registry/events.jsonl`. When `scripts/alpha-lab/registry.js` exists, E3 uses its `readRegistry()` semantic validator; on the current main base, E3’s compatibility reader validates the same `schemaVersion`/`sequence` envelope and `REGISTERED`/`VERDICT`/`RETIRED` transitions. `hypothesisSha256` is SHA-256 of canonical sorted-key hypothesis JSON plus one LF; the registry row hash is SHA-256 of canonical sorted-key row JSON excluding `rowSha256`, without a trailing LF.
- Registration payload fields are `hypothesisSha256`, `kContribution`, `alphaSpent`, `hold`, sorted `universe`, `firstEvaluableDate`, `shortNameKo`, `signal`, and ordered `looks`. No writer, registration command, or production hypothesis is added.
- The absent `scripts/offline-lab-f2b-adaptive-evalue.js` reference is represented by the existing merged synthetic script `scripts/alpha-lab/f2b-evalue-power.js`.
- Signal ranks use only closes through date `t` for supported momentum hypotheses over 3–56 sorted KRW markets. Lookback history is paged from Upbit’s public daily endpoint as needed (up to 3,650 days) using explicit UTC cursors. Each observation requires the completed close for `t+1`; the basket holds the highest-ranked `round(N/3)` markets with equal weights and rebalances at the registered `hold` interval. Costs are `0.0015 * sum(abs(newWeight - oldWeight))` at rebalance. Missed dates fail closed without backfill. The last outcome close must be no later than the final declared look; terminal verdicts, retirement, and the look boundary prevent further market-data fetches.
- The e-process is a 50/50 mixture of the existing baseline fixed-lambda mixture and predictable adaptive bet, using prior-only 4-sd clipping, a 20-day burn-in, and `1 / alphaSpent` threshold. PASS is latched at its first crossing and the status retains the crossing day and value.
- The public Upbit fetcher is disabled before `2026-12-10T00:00:00Z`, until 15 minutes after the UTC daily close, without a matching registered hypothesis, or before its `firstEvaluableDate`. Workflow schedule is 00:17 UTC and workflow_dispatch is guarded to `main`; it runs on `ubuntu-latest` with job-scoped `contents: write` only and persists cumulative state to the fixed `alpha-lab-cross-section-data` branch. `.github/workflow-authority-map.json` records only that job’s `contents` write, `secrets: false`, and `environment: null`.

## Data and test disposition

- No production hypotheses or registry rows were created.
- No market-data requests were made and no results artifact was produced.
- Tests build only temporary synthetic registry rows and candle responses; F2b comparison uses the checked-in synthetic generator and does not fetch.
- An additional compatibility smoke test used a temporary copy of the reader alongside the actual E1 `registry.js` at PR #3355 head `7f8aaf0d749b6bab8d82a49b23633dbc0ee31767`; synthetic registration and retirement were read correctly without network access. The E1 PR was inspected only and was not merged or copied into this branch.
- The design link in the work order cites Section 7, but the referenced v3 design on the implementation base has Sections 1–6 only. Implementation used available Section 2, the F2b script, and the owner-approved E3 decisions.

## Validation / next action

Local gates before commit and push: recorder tests 11/11 (synthetic/no network), workflow regression tests 32/32, `node --check` PASS, ESLint PASS, workflow authority map PASS (53 workflows), workflow action pins and input validation PASS, YAML parse PASS, AIPOS YAML PASS (842 files), work-order index PASS, `pnpm run preflight` PASS, and `git diff --check` PASS. Exact-head GitHub CI and independent review remain pending until the draft PR is published. No merge, release, host operation, hypothesis registration, or market-data fetch is authorized by this task.
