# AI Capability Audit: WO-AI-011

Date: 2026-08-11
Base: `2cf1939afd029d5ce11e517d3f3b0bb6423ecd4b`

## Evidence reviewed

- `.aipos/state.yaml`
- `.aipos/evidence/WO-AI-001-completion.json` through `WO-AI-010-completion.json`
- `.aipos/work-orders/WO-AI-001-*` through `WO-AI-010-*`
- `packages/ai/src/**`, `apps/cloud/src/ai/**`, and related `tests/ai-*.test.js`
- current protected `main` history through `2cf1939afd029d5ce11e517d3f3b0bb6423ecd4b`
- open PR serialization state for Issue #349 / PR #371

## Findings

Existing work orders provide bounded inference, grounding, calibration, provider comparison, scenario/counterfactual provenance, outcome attribution, immutable advisory learning memory, replay identity, and explanation faithfulness. Those controls are primarily per-run, adversarial, replay, or outcome-lineage controls.

No merged runtime contract was found that combines all of the following into one immutable longitudinal evaluation record:

- prediction-time temporal holdout and walk-forward partition identity;
- a strict prohibition on post-prediction information in evaluation inputs;
- exact prediction -> evidence -> provider/model -> prompt -> schema -> calibration -> realized outcome lineage over an observation window;
- minimum sample and observation-window abstention;
- provider/model/prompt/calibration version-separated metrics;
- regime-specific degradation detection over repeated realized outcomes;
- predictive metrics separated from realized economic usefulness after declared fees, spread/slippage, turnover, drawdown, and baseline opportunity cost.

This is an evaluation gap, not a missing-implementation claim: existing replay and attribution evidence must remain separate from longitudinal realized-market evaluation.

## Capability classification

| Capability | Status | Evidence |
|---|---|---|
| Grounded bounded real-model inference | COMPLETE_RUNTIME | WO-AI-001/002/003 |
| Outcome-linked calibration + durable calibration memory | COMPLETE_RUNTIME | WO-AI-004/005 |
| Shared inference resource governance | COMPLETE_RUNTIME | WO-AI-006 |
| Independent provider/model comparison | COMPLETE_RUNTIME | WO-AI-007 |
| Scenario/counterfactual reasoning | COMPLETE_RUNTIME | WO-AI-008 |
| Outcome attribution + immutable learning memory | COMPLETE_RUNTIME | WO-AI-009 |
| Claim/evidence explanation faithfulness | COMPLETE_RUNTIME | WO-AI-010 |
| Temporal holdout / walk-forward longitudinal evaluation | NOT_IMPLEMENTED | No merged matching runtime contract/test suite |
| Future-data/leakage guard for longitudinal evaluation | PARTIAL_RUNTIME | Existing provenance/replay guards; no longitudinal partition contract |
| Version-separated long-run provider/model/prompt/calibration metrics | NOT_IMPLEMENTED | No merged matching aggregate runtime |
| Regime degradation detection | NOT_IMPLEMENTED | No merged longitudinal realized-outcome detector |
| Long-run predictive-vs-economic usefulness separation | PARTIAL_RUNTIME | WO-AI-009 net-benefit evidence exists; no longitudinal holdout aggregation |

## Grill findings

### G-AI-001 — AIPOS execution-state drift

`.aipos/state.yaml` on current main still contains historical branch/commit references that do not match current protected main. This is a continuity defect because repository recovery is required to be deterministic. It must be reconciled in a serialized bookkeeping change without claiming human/environment completion.

### G-AI-002 — Longitudinal evaluation gap

The AI stack can explain, compare, calibrate and attribute outcomes, but it still lacks a durable time-separated scorecard proving whether those capabilities remain useful across future observations and regimes. WO-AI-011 is therefore the highest-value next AI intelligence gate.

### G-AI-003 — Runtime implementation is serialized

Issue #349 / PR #371 physical Android acceptance remains `HUMAN_ENVIRONMENT_ONLY`. WO-AI-011 planning can be reconciled and validated now, but runtime implementation must not bypass that gate.

## Priority after serialization clears

1. Implement WO-AI-011 temporal partition + leakage guard + lineage schema.
2. Add deterministic realized-outcome aggregation with minimum-sample abstention.
3. Add version/regime-separated predictive metrics and economic-usefulness metrics.
4. Add degradation reporting with zero automatic mutation authority.
5. Re-run a fresh capability audit before selecting any model/prompt/strategy optimization work.

## Safety

The proposed work is evaluation-only. It cannot modify model/provider weights, prompts, strategies, risk, sizing, promotion, broker state, credentials, kill switch, HALT, or LIVE authority. Existing `WO-0051 HUMAN_ENVIRONMENT_ONLY` remains unchanged.
