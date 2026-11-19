# Canonical permit producer and durable permit store: design for Stage B

Date: 2026-11-16. Status: DESIGN for owner decisions, not an approval; nothing here changes code, the host or the order switch.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, Release=HOLD.
Context: PR #3150 (merged) makes every strategy order require an unexpired canonical PERMIT. Production has no producer, so every strategy order is refused (`PAPER_TRADE_PERMISSION_ABSENT`). This document describes what a producer must be so that orders can ever be turned on, and what it honestly will say today.

## 1. What the producer is

A separate module, not part of the execution boundary and not callable by it, that for one intent builds a `TradePermissionInput` from evidence and writes the resulting record to a durable, append-only store. The boundary reads it only through the `PaperTradePermissionAuthority` contract (read-only). The producer has no way to place an order, move capital or change a threshold, and it must not import the boundary.

## 2. The 14 gates and where each input comes from (read from main, 2026-11-16; corrected after review)

One row per gate of `tradePermissionEngine.evaluateTradePermission`. "Status" is what the code shows; whether a runtime fact holds (samples, models) needs an inventory (section 2.2), which this document does not claim to have.

| # | Gate | Input the engine reads | Candidate source on main | Status |
| --- | --- | --- | --- | --- |
| 1 | DATA_QUALITY | `dataQuality` (0..1) | no producer; would derive from signal completeness and age | missing |
| 2 | FRESHNESS | age = `generatedAt` minus the OLDER of `sourceGeneratedAt` and `probability.generatedAt` | the producer must set `sourceGeneratedAt` to the oldest input it used (every market-state signal, feature and quote), not the newest | missing; binding rule defined here |
| 3 | REGIME_COMPATIBILITY | `regime` in `policy.compatibleRegimes` | `marketStateEngine.createMarketState().regime` | needs all 8 required signals |
| 4 | PROBABILITY | `probability.calibratedProbability` and `abstain` | `probabilityEngine.estimateProbability` | abstains without enough labelled samples (`INSUFFICIENT_CALIBRATION_SAMPLES`); the sample type does not itself bind a sample to a model, market and outcome definition, so the producer must filter and prove that |
| 5 | EXPECTED_VALUE | `netExpectedValue` | none | missing: needs a cost model tied to the same outcome definition |
| 6 | REWARD_TO_RISK | `expectedReward / expectedLoss` | none | missing |
| 7 | LIQUIDITY | `liquidityScore` | market state `liquidityScore` | derivable once the signals exist |
| 8 | CAPACITY | `capacityUsd` | none | missing: needs a stated rule (for example depth within a slippage budget) |
| 9 | SLIPPAGE | `estimatedSlippageBps` | none usable | missing: see 2.1 |
| 10 | UNCERTAINTY | `probability.uncertainty` | `probabilityEngine` | follows gate 4 |
| 11 | MODEL_AGREEMENT | dispersion of `modelProbabilities` (fewer than 2 models gives 1) | one model only | missing: at least two independent models; the real limit is `policy.maximumModelDispersion`, which is set by the reviewed policy file |
| 12 | RISK_BUDGET | `riskBudgetUsage` | canonical risk gate state | read-only snapshot at decision time |
| 13 | KILL_SWITCH | `killSwitchActive` | runtime flag | read-only |
| 14 | GOVERNANCE | `governanceApproved` | open item (Coordinator removal, S1) | see section 5, decision 3 |

`marketStateEngine.createMarketState` requires ALL eight signals and throws if one is missing: `RETURN_5M`, `REALIZED_VOLATILITY`, `SPREAD_BPS`, `ORDER_BOOK_IMBALANCE`, `DEPTH_USD`, `FUNDING_RATE`, `OPEN_INTEREST_CHANGE`, `LIQUIDATION_INTENSITY`. The last three are futures-market signals; the PAPER spot runtime may not hold them. A missing signal must reject, never default.

### 2.1 Cost evidence is not slippage evidence

`paperRuntimeExecutionCostEvidence` reports `completeness: "INCOMPLETE"` with `spreadAmount: null` and `slippageAmount: null` for the observed quote. Observed quotes, depth and after-the-fact cost attribution are inputs a producer may use, but they do not replace a forecast of slippage and capacity before the order. Gates 5, 6, 8 and 9 therefore need a producer-owned estimator with its own evidence and version.

### 2.2 What is claimed and what needs an inventory

Claimed from code: the engines behave as described above. NOT claimed from code: that no current candidate has enough labelled samples, or that only one model exists. Those are runtime facts and need an inventory (list of models, calibration samples per model, market and outcome definition) before the conclusion below is used for planning.

Conditional conclusion: if the inventory confirms no calibrated samples, no net-EV model and a single model, an honest producer rejects every intent (`PROBABILITY`, `EXPECTED_VALUE`, `MODEL_AGREEMENT` fail) and Stage B needs a candidate that has passed research first. No gate may be relaxed to avoid that.

## 3. The durable store (what `isLatest` and `evidenceExists` read)

- One SQLite table `trade_permission_records` in a store separate from the PAPER ledger, append-only by construction (no update, no delete; enforced by triggers and tested): `sequence` (autoincrement), `decision_id` (intent identity), `strategy_id`, `market`, `policy_version`, `model_version`, `permit_json` and `input_json` (canonical JSON), `permit_sha256`, `created_at`.
- `isLatest(record, query)`: true only when the row with the highest `sequence` for `decision_id` has the same `permit_sha256`. A newer REJECT supersedes an older PERMIT.
- `evidenceExists(references, query)`: every reference is a row in an `evidence_items` table (content hash, kind, source, observed_at) linked to the same `decision_id`. A reference that is only a label is not evidence.
- The authority adapter opens the store read-only. The producer's writer is a different connection and process path; a source test pins that the boundary module cannot import the writer.
- Failure of the store (missing file, corrupt, locked) means the adapter throws, which the guard turns into `UNVERIFIABLE` and a refusal.

## 4. Policy and model versions

`policyVersion` and `probabilityModelVersion` are immutable identifiers owned by the owner-approved policy file in the repository (thresholds live in a reviewed file, never in the producer or the runtime environment). Changing a threshold is a reviewed PR and a new policy version; an old permit never validates under a new version.

## 5. Decisions needed from the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Is a statistical permit (calibrated probability, positive net expected value, model agreement) the intended meaning of PERMIT for every automatic order? | Yes. It is what the permit engine and the Stage B rule already say; weakening it needs a new written rule, not a code change. |
| 2 | Which candidate is the first to be permitted, and what evidence (labelled outcome samples, cost model, the inventory of section 2.2) must exist first? | Take it from the strategy review (C7) and the 2026-12-13 forward-test verdict; do not build the producer before a candidate qualifies. |
| 3 | Where does governance approval come from after the Coordinator is gone (S1)? | A reviewed file in the repository is the record, but a file alone grants no authority. Before it is used the owner must fix: who may approve (the approving identity), how an approval is revoked and how fast the producer sees it (it must be read at decision time, with a freshness limit, and absent or unreadable means not approved), and when a policy or model version is retired (an old permit never validates under a retired version). |
| 4 | Order of work | (a) store and adapter with tests (no production wiring), (b) producer for the gates that have honest data, (c) wire the adapter in a release with orders still OFF so the rejections show up as evidence, (d) only then Stage B with a fresh written owner approval. |

### 5.1 Owner decisions recorded (2026-11-16)

The owner answered in chat (Korean, translated): "B" for the parked store PR (#3152 closed, branch kept) and "I will take the recommended side for the others; I approve the rest". This is recorded as follows, and nothing more is inferred from it:

- Decision 1: ACCEPTED as recommended. PERMIT means the statistical permit (calibrated probability, positive net expected value, model agreement). Weakening it needs a new written rule.
- Decision 2: ACCEPTED as recommended. No producer is built before a candidate qualifies (strategy review C7 and the 2026-12-13 forward-test verdict).
- Decision 3: the recommendation (a reviewed file as the record, never authority by itself) is ACCEPTED in principle. The three specifics are STILL OPEN because a blanket "yes" does not name them: who the approving identity is, how an approval is revoked and how fast the producer sees it, and when a policy or model version is retired. Until the owner names them, governance stays "not approved" and no producer may read a governance file.
- Decision 4: ACCEPTED as the order of work, with one change already made: the store and adapter (step a) are parked (#3152) and come back together with their first real caller, because the reachability gate refuses an unwired module.
- NOT covered by this approval: Stage B (orders ON). It still needs a qualified candidate, a permit producer with a durable store, a release and a fresh written owner approval that names Stage B. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY` and Release=HOLD are unchanged.

## 6. What is not done

No code. No store is created, nothing is wired in the runtime, no release, no host change, orders stay OFF. Each step above is a separate draft PR with an independent review.

## 7. Inventory result, 2026-11-19 (read-only counts on the host)

`scripts/permit-inventory.js` was run by the owner on the host as the service user against the real state database `/var/lib/nusa/state.sqlite` (the path in `NUSA_CLOUD_STATE_DB_PATH` of both env files; the 0-byte `nusa-cloud.sqlite` and `cloud-runtime.sqlite` in the same directory are not the state). Counts only, no row content; the first two attempts read the empty files and are discarded.

| Group | Table | Rows |
| --- | --- | --- |
| models and samples | `ai_calibration_durability_events` | 0 |
| | `ai_outcome_attribution_memory_events` | 0 |
| | `evaluation_traces` | 0 |
| | `ai_evaluation_records` | table absent |
| research | `research_candidates` | 0 |
| | `research_experiment_records` / `research_evaluation_ledger` | 811 / 811 |
| | `research_holdout_usage` | 113 |
| | `research_promotion_audit`, `research_champion_pointer`, `champion_assignments` | 0 |
| market data | `research_closed_candles` | 81206 |
| | `research_orderbook_samples` | 5153403 |
| | `research_trade_ticks_v2` | 2000000 (an exact round number: most likely a retention cap, not confirmed) |
| | `paper_public_market_observations` | 209166 |
| futures data | `research_futures_klines` / `research_futures_funding` / `research_futures_marks` | 380 / 290 / 28194 |
| permits and governance | `trade_permission_records`, `evidence_items` | table absent |
| | `decision_certifications`, `strategy_governance_state` | 0 |
| | `risk_paper_approvals` | 9035 |

### What it shows

- No permit store exists (`trade_permission_records` is absent), as designed: nothing is built before a candidate qualifies (decision 2 stands).
- The probability engine has no labelled samples (calibration 0, outcome attribution 0). A calibrated probability, the first term of the statistical permit, cannot be produced honestly today; the design's rule that a missing input rejects stays the only safe behaviour.
- `research_candidates` is 0 while 811 experiment records exist: consistent with the closed-loop verdict (no candidate passes).
- Correction to the earlier assumption that futures data is empty: 380 klines, 290 funding and 28194 mark rows exist (collected before the exchange started refusing the host's region with HTTP 451). They are far too few for the regime signals (380 klines), and their time range and freshness were NOT read; the futures collector itself still fails with HTTP 451.
- `risk_paper_approvals` has 9035 rows: PAPER risk approvals exist; what they approve was not read.

### Not shown by counts

Whether samples are bound to a model, market and outcome definition, the time span of each table, and whether `trade_ticks_v2` is capped. None of this changes a gate, a limit or the order switch.
