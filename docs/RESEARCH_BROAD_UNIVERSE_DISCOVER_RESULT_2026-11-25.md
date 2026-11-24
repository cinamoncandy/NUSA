# Broad-universe discovery: result (2026-11-25 KST) — NO_CANDIDATE

Status: result record. Docs and one data file only. No gate, threshold, limit, capital, host, release or authority change. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

## What was run

One run of `.github/workflows/broad-universe-discover.yml` (run 45505624947, 2026-11-25 07:57 KST, GitHub-hosted runner, about 30 seconds) at main commit `d9a056c7` with the pins file hash `5841d2be...f13c`. Owner go: "발견도 해" (2026-11-24). The run read the two reproduced fetch artifacts (manifest hashes `139a92c3...` and `40bf0d0e...`, both reproduced twice before use), verified every file against the committed manifests, loaded the **discovery window only** (2021-12-20 to 2023-07-02; the hold-back files were hashed for the manifest check and never parsed) and ran `scripts/run-broad-mining.js discover` as reviewed in #3277. It sent no Upbit request. It was **run once and not repeated**.

## Result

| item | value |
| --- | --- |
| status | **NO_CANDIDATE** |
| markets loaded | 56 of 56 (the committed 20 bp discovery pool) |
| usable decision hours (pooled) | 686,063 |
| rules evaluated | 64 (HIGH side of the unchanged grid) |
| rules passing every level condition (`eligibleRules`) | **0** |
| rules with at least 100 trades and positive mean net (`positiveMeanRules`) | 1 |
| shortlist | empty |
| freeze record fingerprint | `6dc40f09f31af53e93a3ea37c8b231691cde82bfe0ee73e973eb91eab376f55d` |

The one rule with a positive mean net after costs failed at least one of the other level conditions (time-matched excess above zero, both halves positive on net and excess with at least 20 trades each, base and stress net above zero); the printed result does not say which, and no re-run or re-cut was made to find out. The p-values are descriptive and unadjusted for the choice among 64 rules, as stated in the design.

## What it means

- The pre-registered broad-universe discovery, with the time-matched leave-one-out baseline over 56 tradable KRW markets and per-market spread-floor costs, produced **no rule worth taking to a hold-back look**. `NO_CANDIDATE` is a valid answer fixed in the design before any data was read.
- Because there is no candidate, the descriptive hold-back veto, the effective-sample estimate and a broad forward pre-registration have nothing to act on. **The hold-back files of this route were never read.** The broad route ends here unless the owner decides on a new, separately pre-registered question.
- Nothing about this result changes the RET48 forward confirmation (BTC, ETH, SOL, NEAR; span from 2026-12-11 09:00 KST), which uses different markets and one pre-registered rule.

## Not concluded

- No claim that nothing can work on small KRW markets: the study answers one pre-registered question (64 HIGH-side rules: 8 signals, quantile thresholds, holds of 1, 4, 12 and 24 hours, hourly bars, these costs) on 2021-12-20 to 2023-07-02.
- The 56-market pool carries survivorship (markets listed and still tradable on 2026-11-24); the design states this and the result is not read as a forecast.

## Files

- `docs/research-data/broad-universe-discover-result-2026-11-25.json`: the counts, the per-market usable hours and the freeze record, copied from the job log; the freeze fingerprint is recomputed by `tests/broad-universe-discover-result.test.js`.
- Inputs: `docs/research-data/broad-universe-fetch-manifests-2026-11-24.json`, `docs/research-data/broad-universe-discover-pins-2026-11-24.json`.
- Artifacts of the two fetch runs expire 2026-11-27 21:41 KST (group 1) and 22:50 KST (group 2); they are not needed any more.
