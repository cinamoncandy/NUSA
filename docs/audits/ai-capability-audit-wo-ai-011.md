# AI Capability Audit: WO-AI-011

Date: 2026-08-11
Base: `e1fb37250d6348e8bd65f0c3d16cdf509d07c51a`

## Evidence Reviewed

- `.aipos/state.yaml`
- `.aipos/evidence/WO-AI-001-completion.json` through `WO-AI-010-completion.json`
- `.aipos/work-orders/WO-AI-001-*` through `WO-AI-010-*`
- `packages/ai/src/**`, `apps/cloud/src/ai/**`, and related `tests/ai-*.test.js`

## Findings

Existing work orders provide bounded inference, calibration, scenario provenance, outcome attribution, replay identity, and explanation faithfulness. Those controls are primarily per-run, adversarial, replay, or outcome-lineage controls.

No existing runtime contract was found that combines all of the following into one immutable, longitudinal, read-only evaluation record:

- prediction-time temporal holdout and walk-forward partition identity;
- a strict prohibition on post-prediction information in evaluation inputs;
- exact prediction -> evidence -> provider/model -> prompt -> calibration -> realized outcome lineage over an observation window;
- minimum sample and observation-window abstention;
- provider/model/prompt/calibration version-separated metrics;
- regime-specific degradation detection over repeated realized outcomes.

This is a real evaluation gap, not a missing implementation claim: existing replay and attribution evidence must remain separate from longitudinal realized-market evaluation.

## Classification

| Capability | Status | Evidence |
|---|---|---|
| Synthetic/adversarial correctness | COMPLETE_RUNTIME | WO-AI-010 evidence and AI tests |
| Outcome attribution and immutable learning memory | COMPLETE_RUNTIME | WO-AI-009 evidence and attribution tests |
| Calibration persistence and resolution | COMPLETE_RUNTIME | WO-AI-004/005 evidence |
| Temporal holdout / walk-forward longitudinal evaluation | NOT_IMPLEMENTED | No matching runtime contract, work order, or test suite found |
| Future-data/leakage guard for longitudinal evaluation | PARTIAL_RUNTIME | Existing provenance/replay guards, no longitudinal partition contract |
| Version-separated long-run provider/model/prompt/calibration metrics | NOT_IMPLEMENTED | No matching aggregate runtime found |
| Regime degradation detection | NOT_IMPLEMENTED | No longitudinal realized-outcome detector found |

## Safety

The proposed work is evaluation-only. It cannot modify model/provider weights, prompts, strategies, risk, sizing, promotion, broker state, credentials, kill switch, HALT, or LIVE authority. Existing `WO-0051 HUMAN_ENVIRONMENT_ONLY` remains unchanged.
