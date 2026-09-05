# Public-history horizon evidence (#1701)

Implementation source: `83ef38b94a9a3e8acca68845f3ff124beb7fbcbb`.
Observed 2026-09-05, using the canonical real-market runner with snapshot preload,
`NUSA_RESEARCH_COST_MODEL_VERSION=nusa-paper-cost-v1` and an isolated durable
snapshot path. No production ledger was changed.

- Upbit public KRW-BTC: 1,000 completed daily candles, 2023-12-10 UTC through
  2026-09-05 UTC (exclusive end); five requests, fresh at execution.
- Dataset SHA-256: `537353026aa9a8bf711585d83a444c07ee04f86024acf54fbbad64ac0a4cd298`.
- Existing 120/20 walk-forward plan: 44 windows. Costs and qualification
  thresholds unchanged. Request provenance is in the manifest and output.
- Canonical qualification: 6 REJECTED, 0 INSUFFICIENT, 0 QUALIFIED.
- Reasons include `REGIME_FRAGILE_EDGE`, `LEAGUE_BASELINE_INSUFFICIENT`,
  `LEAGUE_BASELINE_REJECTED`, `DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD`.
- Snapshot SHA-256: `9e81b1242ec40ab9298b001633e3dd0b54c7bd6b94699a3d0b8e816f96186842`.
- Original run fingerprint: `1daa63235f4df731163ea04c0e5d46398efa9e5ba820a95d6db43aba0744a8f2`.
- A newly constructed canonical snapshot store restored the one snapshot;
  replay qualification was deeply equal. No PAPER evidence was injected.

This is historical research evidence, **not** production forward PAPER evidence.
It removes the fixed 200-candle ingestion ceiling, not the requirement for a
genuinely qualified challenger. #1605 remains open: autonomous production
order/fill/accounting and 24-hour closed-loop evidence are not established here.
LIVE NONE, production mutation false and AI ZERO_AUTHORITY remain unchanged.

The API pagination contract is documented by
[Upbit](https://docs.upbit.com/kr/reference/list-candles-days): maximum 200 per
request, exclusive `to` cursor. Missing daily candles are not synthesized.

Local validation before publication: 296 Research/closed-learning focused and
regression tests passed; typecheck, build, lint (one pre-existing unused-variable
warning), preflight, validate:full and security gate passed (secrets 0).
Remote exact-head CI and deployment acceptance must be checked separately.

Full canonical isolated suite: 939/939 files passed on the implementation source
(subsequent changes before publication are evidence/metadata only).
