# Strategy Research Promotion Gate Contract (WO-0031)

> **Canonical authority:** `scripts/lib/strategy-research-evidence-manifest.js` owns evidence ordering, integrity, provenance, linkage, and trust classification. `scripts/lib/strategy-research-promotion-gate-runner.js` plus its independent verifier own the **only canonical research promotion decision**. The older `strategy-research-scorecard.js` path is retained solely as a compatibility/provenance facade: it reports evidence readiness, names the canonical gate, and cannot emit `decision` or `researchDecision`.

## Purpose

Consolidates the WO-0025..WO-0030 research evidence into one auditable judgement about one frozen strategy: does the accumulated evidence justify moving to an extended Paper review, or does it not? It is deterministic research infrastructure. It is not a profitability claim, not a promotion, and not Live Trading approval. It approves nothing by itself — `ownerReview.status` starts and stays `PENDING`.

## Authority boundary

There is exactly one WO-0031 decision path. The evidence manifest validates the declared evidence set; the promotion-gate runner derives the ten dimensions and final `researchDecision`; the independent promotion-gate verifier re-derives the safety and promotion rules without calling the runner's decision helper. The compatibility scorecard may summarize linkage/trust/readiness for older tooling but cannot answer the promotion question.

`tests/strategy-research-promotion-authority-architecture.test.js` guards this ownership boundary so a second promotion decision cannot silently return through the compatibility facade.

## Scope decision

Same reuse decision as WO-0027/0028/0029/0030 (see `docs/research/walk-forward-contract.md`). This layer sits strictly *above* the research runners: it **reads declared evidence and never recomputes, re-runs, or rewrites any research result**. If a metric is absent from the manifest it is reported as `null` or as a shortfall — never as a value the scorecard invented.

## Three rules that make this honest

1. **No single numeric total score.** A weighted total lets a data-integrity failure be averaged away by a good return figure. Dimensions carry a `status` and a `confidence`; blocking conditions always outrank everything else. The independent verifier explicitly rejects a result carrying `totalScore` or `score`.
2. **Technical execution is not strategy performance.** `executionStatus` says whether the scorecard could be computed; `researchDecision` says what to do about the strategy. A clean run over weak evidence is `executionStatus: PASS` with a negative decision, and the two fields are never merged.
3. **Synthetic evidence cannot promote.** Evidence built from invented candles supports implementation-correctness dimensions only. It can never raise confidence to `HIGH` and can never satisfy a promotion gate.

## Evidence manifest and trust levels

Eight evidence types are consumed in a fixed canonical order regardless of input order: `DATASET_QUALITY`, `BACKTEST_BASELINE`, `COST_STRESS`, `WALK_FORWARD`, `PARAMETER_ROBUSTNESS`, `REGIME_ANALYSIS`, `CROSS_MARKET_VALIDATION`, `PAPER_OPERATIONAL_SAFETY`.

| Trust | Meaning |
| --- | --- |
| `VERIFIED_REAL` | real market data, independent verification `PASS` |
| `VERIFIED_SYNTHETIC` | synthetic fixture, independent verification `PASS` |
| `UNVERIFIED_REAL` | real market data, verification not run |
| `MISSING` | no entry declared |
| `INVALID` | verification `FAIL`, schema mismatch, or undeclared provenance |

Duplicate evidence for one analysis is rejected. Mixed strategy fingerprints or mixed source commits are rejected. A failed independent verification is `INVALID`, never a warning. When an evidence root is supplied, declared result files are re-hashed and mismatches block execution.

## Ten dimensions

| ID | Dimension | Evidence source |
| --- | --- | --- |
| D-001 | Data Integrity | `DATASET_QUALITY` |
| D-002 | Backtest Integrity | `BACKTEST_BASELINE` |
| D-003 | Cost Resilience | `COST_STRESS` |
| D-004 | Out-of-Sample Performance | `WALK_FORWARD` |
| D-005 | Parameter Robustness | `PARAMETER_ROBUSTNESS` |
| D-006 | Regime Robustness | `REGIME_ANALYSIS` |
| D-007 | Cross-Market Generalization | `CROSS_MARKET_VALIDATION` |
| D-008 | Sample Sufficiency | derived |
| D-009 | Benchmark Competitiveness | derived |
| D-010 | Operational Paper Safety | `PAPER_OPERATIONAL_SAFETY` |

Statuses are `STRONG`, `ACCEPTABLE`, `WEAK`, `INCONCLUSIVE`, `FAIL`, `INVALID`, `NOT_RUN`. All thresholds are fixed in code before any run; none is tuned after seeing a result.

Derived dimensions inherit the worst trust among the evidence they consume, and confidence is a function of evidence quality and quantity only — never of how good the numbers look. Synthetic, unverified, or invalid evidence caps confidence at `LOW`.

## The provenance gate

When a dimension's evidence is `VERIFIED_SYNTHETIC`, promotable market-performance statuses are downgraded to `INCONCLUSIVE`. Backtest-integrity and operational code-safety properties may still be evaluated as implementation properties, but synthetic evidence can never satisfy the final promotion gate.

## Gate decisions, in evaluation order

1. `INVALID` — any evidence source is invalid or failed independent verification.
2. `INVALID` — D-002 is `FAIL`.
3. `INVALID` — D-010 is `FAIL`; a breached safety boundary is a hard stop.
4. `INSUFFICIENT_EVIDENCE` — evidence is missing or declared minimum sample thresholds are unmet.
5. `REJECT_STRATEGY` — structural research failure.
6. `REVISE_STRATEGY` — a material research weakness requires revision.
7. `CONTINUE_RESEARCH` — blockers and/or inconclusive dimensions remain.
8. `HOLD` — blockers remain although every dimension is otherwise adequate.
9. `PROMOTE_TO_EXTENDED_PAPER_REVIEW` — every required real-evidence condition passes with no blockers or synthetic evidence.

`PROMOTE_TO_EXTENDED_PAPER_REVIEW` is a request for owner review, not an action. Its permitted next actions are review preparation only.

## Prohibited actions

Enable Live Trading; place real orders; use the Upbit private API; store credentials; change production strategy parameters or symbols automatically; start automatic Paper trading automatically; bypass owner review; or grant production mutation authority.

## Independent verification

`scripts/lib/strategy-research-promotion-gate-verifier.js` independently re-derives the blocking conditions and gate outcome from the recorded manifest and dimensions. The compatibility scorecard verifier separately enforces that the old facade cannot emit a promotion decision and must identify the canonical gate.

## Determinism and safety

Every output is a pure function of the request. No wall-clock value creates a hidden decision input. Nothing in this layer is evidence for Live Trading, and no canonical promotion result self-approves owner review.
