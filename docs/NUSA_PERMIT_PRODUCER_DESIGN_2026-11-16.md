# Canonical permit producer and durable permit store: design for Stage B

Date: 2026-11-16. Status: DESIGN for owner decisions, not an approval; nothing here changes code, the host or the order switch.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, Release=HOLD.
Context: PR #3150 (merged) makes every strategy order require an unexpired canonical PERMIT. Production has no producer, so every strategy order is refused (`PAPER_TRADE_PERMISSION_ABSENT`). This document describes what a producer must be so that orders can ever be turned on, and what it honestly will say today.

## 1. What the producer is

A separate module, not part of the execution boundary and not callable by it, that for one intent builds a `TradePermissionInput` from evidence and writes the resulting record to a durable, append-only store. The boundary reads it only through the `PaperTradePermissionAuthority` contract (read-only). The producer has no way to place an order, move capital or change a threshold, and it must not import the boundary.

## 2. The 14 gates and where each input comes from (read from main, 2026-11-16)

| Gate / input | Source today | Gap |
| --- | --- | --- |
| Market state, regime, liquidity, uncertainty | `marketStateEngine.createMarketState` needs a fixed set of observations (return, realized volatility, spread, order-book imbalance, depth, funding rate, ...) | The runtime must supply every required signal with a fresh timestamp; funding rate is a futures signal that the PAPER spot runtime may not hold. A missing signal must reject, never default. |
| Calibrated probability, uncertainty, abstention | `probabilityEngine.estimateProbability` | It abstains with `INSUFFICIENT_CALIBRATION_SAMPLES` unless labelled outcome samples exist for the model and outcome definition. No such samples exist for the PAPER candidates. |
| Net expected value, reward and loss | not produced anywhere | Needs a cost model (fees, expected slippage) tied to the same outcome definition. |
| Liquidity, capacity, slippage | observed quote and depth (`paperRuntimeExecutionCostEvidence`) | Usable as is; capacity needs a stated rule. |
| Model agreement | needs at least two independent probability models (dispersion of one model is defined as 1, which rejects) | A second model does not exist. |
| Risk budget usage | canonical risk gate state | Read-only snapshot at decision time. |
| Kill switch | runtime flag | Read-only. |
| Governance approval | strategy governance / Release HOLD source | The source is the open #3108 item (Coordinator removal, S1). |

Consequence, stated plainly: with today's candidates (no calibration samples, one model, no net-EV model), an honest producer rejects every intent (`PROBABILITY`, `EXPECTED_VALUE`, `MODEL_AGREEMENT` fail). Stage B therefore cannot start by writing a producer alone; it needs at least one candidate that has passed research with enough labelled outcomes. Relaxing a gate to make it pass is not allowed.

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
| 2 | Which candidate is the first to be permitted, and what evidence (labelled outcome samples, cost model) must exist first? | Take it from the strategy review (C7) and the 2026-12-13 forward-test verdict; do not build the producer before a candidate qualifies. |
| 3 | Where does governance approval come from after the Coordinator is gone (S1)? | A reviewed file in the repository changed only through the normal PR path, read by the producer at decision time. |
| 4 | Order of work | (a) store and adapter with tests (no production wiring), (b) producer for the gates that have honest data, (c) wire the adapter in a release with orders still OFF so the rejections show up as evidence, (d) only then Stage B with a fresh written owner approval. |

## 6. What is not done

No code. No store is created, nothing is wired in the runtime, no release, no host change, orders stay OFF. Each step above is a separate draft PR with an independent review.
