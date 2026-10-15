# Design: provenance for continuous research experiments (Stage 2b-4)

Status: DECISIONS D1-D5 TAKEN AS PROPOSED (owner instruction 2026-10-02: stop asking and finish); see WO-RESEARCH-20261002-PROVENANCE-BUILDER. The builder, walk-forward window builder and holdout ledger implement this design.
Scope: PAPER/Research evidence only. LIVE NONE, productionMutation false, AI ZERO_AUTHORITY. No paid AI.

A wrong provenance manufactures false evidence, so this is reviewed before any builder is written. It maps
every field of `ResearchProvenance` (`packages/contracts/src/researchHardening.ts`) to a concrete, reproducible
source, lists what must fail closed, and names the decisions the owner has to make.

## 1. Two research styles exist; this design joins them
- The coordinator/automation path (`researchRuntimeCoordinator.ts`, `researchAutomationRuntime.ts`) evaluates one
  `ResearchInputSnapshot` per call: a champion and a challenger evaluator return signals and metrics, evidence is
  ledgered, and `ResearchCandidateGate` decides eligibility (30 days, 50 trades).
- The optimizer (`packages/core/src/optimizer`) runs deterministic parameter-grid walk-forward with
  Train/Validation windows and a reserved Holdout over candles and emits an owner-approval-gated promotion candidate.

Decision D1 (proposed): one experiment = one (market, window set, challenger parameter set) evaluated by evaluators
that call the backtest engine on stored closed candles, instead of one experiment per tick. A scheduler (not
`onMarketData`) submits experiments inside the daily budget. The per-tick `onMarketData` entry stays unused.

## 2. Field mapping
| Field(s) | Source | Rule |
|---|---|---|
| `datasetId` | `upbit-1m-closed:<market>:<intervalMs>` | stable id of the candle series |
| `datasetContentSha256` | `aggregator.candleChecksum` of the exact candle slice used | recomputed from the stored candles at run time, never copied |
| `datasetManifestSchemaVersion` | constant 1 | bumped only with a schema change |
| `market`, `interval` | experiment parameters | market `KRW-*`, interval `1m` |
| `startEventTime`, `endEventTime` | first and last candle close time of the full slice | integers |
| `featurePipelineVersion`, `featurePipelineHash` | version string plus SHA-256 of the aggregator configuration (interval, coverage rule, max internal gap, volume=0) | changes whenever aggregation rules change |
| `strategyId`, `strategyVersion` | champion: `sma-crossover` / `closed-candle-1m-v1`; challenger: optimizer candidate id and version | no free text |
| `strategyArtifactHash` | SHA-256 of the canonical strategy DSL JSON | |
| `strategyConfigHash` | SHA-256 of the canonical parameter set | |
| `sourceCommitSha` | build commit injected at deploy | 40 hex or the experiment is refused |
| `evaluatorVersion`, `modelVersion` | evaluator module version constants | |
| `fillModelVersion`, `feeModelVersion`, `slippageModelVersion` | backtest engine config ids with explicit fee rate and slippage bps | explicit values required; no defaults |
| `randomSeed` | SHA-256 of `evaluationId` | experiments contain no randomness, seed is recorded for completeness |
| `splitIdentity`, `splitHash` | name and SHA-256 of the canonical split definition (sizes, step, boundaries) | |
| `walkForwardConfigHash` | SHA-256 of canonical optimizer config (grid, split, gate) | |
| `trainingWindowHash`, `validationWindowHash`, `finalHoldoutWindowHash` | `candleChecksum` of each window slice | windows never overlap |
| `windowId`, `windowRole` | `TRAIN`, `VALIDATION` or `HOLDOUT` per window record | one provenance per window role |
| `experimentFamilyId`, `attempt`, `hypothesisLineage` | family = `<championId>:<market>`; attempt counts every challenger variant tried in the family; lineage = parent hypothesis chain | attempts are never reset, so multiple-testing is countable |
| `canonicalInputHash` | see D2 | |
| `finalHoldoutUntouched` | see section 3 | |

Decision D2: `hashResearchInput` hashes the whole input, which contains the provenance, which itself carries
`canonicalInputHash`. That is circular. Proposed: provenance `canonicalInputHash` is the SHA-256 of the input with the
`provenance` key removed (the data the evaluators actually see); the coordinator's own hash of the full input stays as
the evidence hash. This definition must be documented in the contract before use. No placeholder values are allowed.

## 3. Holdout discipline
- A challenger parameter set is selected only from data before a recorded selection cutoff.
- The Holdout window must start after that cutoff and may be evaluated at most once per challenger configuration.
  A second evaluation, or any overlap with selection data, sets `finalHoldoutUntouched = false`, which the existing
  validator turns into `HOLDOUT_CONTAMINATED`.
- The cutoff and the one-time holdout use are stored with the experiment so they survive restarts.

## 4. Fail closed (the experiment is not run and is reported)
Missing or malformed commit SHA; fewer candles than train + validation + holdout; any window containing incomplete
or missing buckets above a stated tolerance; non-monotonic times; clock invalid; fee or slippage not explicit; split
windows overlapping; holdout already used; recovery not ready; daily budget exhausted.

## 5. Honest limits
- Evaluations replay history; they do not prove future profit. Promotion still needs the existing 30-day / 50-trade
  gate and PAPER evidence.
- With capital 10,000 KRW and a 5,000 KRW minimum order, few trades happen in PAPER; backtests are the main source of
  trade counts, and they are labelled research evidence, never PAPER fills.
- Many challenger attempts inflate false positives; `attempt` must feed a multiple-testing adjustment in the gate
  before any promotion (open question D5).

## 6. Decisions needed from the owner
- D1 experiment style (batch windows, not per tick).
- D2 definition of provenance `canonicalInputHash`.
- D3 window sizes (proposal: train 7 days, validation 2 days, holdout 2 days of 1-minute candles) and markets.
- D4 explicit fee and slippage assumptions for the backtest (Upbit KRW fee tier and slippage bps).
- D5 whether the candidate gate gets a multiple-testing adjustment based on `attempt` before promotion.
- Challenger parameter grid (which parameters of the sma-crossover family may vary, and their bounds).

## 7. Order of work after approval
1. Contract note for D2 and a pure `buildResearchProvenance` with the field table above and golden tests.
2. Window/split builder with holdout bookkeeping (persisted).
3. Champion and challenger evaluators over the backtest engine.
4. Scheduler and production composition; owner-approved deploy last.
