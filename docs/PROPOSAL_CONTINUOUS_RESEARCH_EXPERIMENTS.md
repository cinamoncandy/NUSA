# Proposal: continuous walk-forward research experiments (PAPER/Research only)

Status: PROPOSAL, owner approval required before any implementation or Worker deploy.
Authority impact if implemented: research evidence only. LIVE NONE, productionMutation false, AI ZERO_AUTHORITY.

## Why
Observed bottlenecks for learning speed:

1. Promotion needs >= 30 observation days and >= 50 trades (`researchCandidateGate.ts`,
   `championChallengerManager.ts`). PAPER produced 8 fills (capital 10,000 KRW, 5,000 KRW minimum order,
   60% max-equity ratio).
2. The closed-learning loop (`closedLearningProductionRuntime.ts`) polls every 30 s but evaluates once per KST
   day rollover and only with a realized fill.
3. A research session ends at `maxExperiments` (`researchAutomationRuntime.ts`). No server-side timer that
   starts new sessions or experiments was found in `apps/cloud/src`; other launchers (autopilot, scripts,
   deploy config) were not inspected, so this must be confirmed first.

## Proposal
A bounded scheduler that submits walk-forward experiments on stored historical candles:

- Out-of-sample splits only; fees, slippage, latency assumptions and missing-data behavior are explicit inputs.
- Fixed budget per day (experiments and CPU), reusing WO-AI-006 resource governance; fail closed on any
  uncertainty (missing data, persistence, clock).
- Output is Research evidence consumed by the EXISTING gate and ADR-0018 policy approval. It never lowers the
  30-day / 50-trade thresholds and never promotes by itself.
- Counterfactual records for unexecuted signals are Research-only evidence and never count toward promotion.

## Explicitly not proposed
- Lowering promotion thresholds, changing capital, minimum order, risk limits or execution.
- Any AI authority, LIVE, credential or production mutation change.

## Open decisions (owner)
1. Experiment budget per day and which markets/intervals.
2. Whether to confirm first that no launcher already exists elsewhere.
3. Whether the capital / minimum-order question ("5000") is to be addressed separately.

## Validation required before implementation
Work order with authority_impact, tests for budget exhaustion/fail-closed paths, leakage checks, full local
validation, then owner-approved deploy.
