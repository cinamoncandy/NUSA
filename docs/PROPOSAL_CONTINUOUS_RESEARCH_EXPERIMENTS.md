# Proposal: continuous walk-forward research experiments (PAPER/Research only)

Status: OWNER DECISIONS RECEIVED 2026-10-02 (see "Owner decisions"). Implementation is staged; any server deploy still needs explicit owner approval.
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

## Finding (code reading, 2026-10-02)
`ResearchAutomationRuntime` already runs one experiment per accepted market tick while a RUNNING session exists
(`onMarketData`), and `startCloudRuntime` accepts `researchRuntime`, `researchRecoveryCoordinator` and
`researchAutomation`. Both production entrypoints pass `undefined` for all three
(`closedLearningProductionRuntime.ts` and `runtime.ts` `main()`), and nothing outside tests calls
`startSession`. So in production no research session exists and no experiment runs from market data. This is
the likely reason the Research projection shows no experiments. It is a reading of the code, not an
observation of the live server; the app's LEARNING line shows the real state.

## Owner decisions (2026-10-02)
1. PAPER capital stays at the current amount. No capital, minimum-order or risk change is part of this work.
2. Continuous research experiments: proceed (staged below).
3. No paid AI calls. Improvement must come from NUSA's own deterministic, compute-only learning. This work
   uses no model/provider credits.

## Staged plan
- Stage 1 (this PR): findings, owner decisions and this plan (documentation and work order only).
- Stage 2: compose the research runtime in production: durable session repository, recovery coordinator,
  deterministic `buildInput` from stored market data, one RUNNING session with a daily experiment budget, and
  automatic restart of a COMPLETED session on the next day. Fail closed on recovery failure.
- Stage 3: tests (budget exhaustion, restart, recovery failure, no promotion path), full local validation,
  then an explicit owner approval before any Worker/Cloud deploy.
- Default budget proposed for Stage 2 (owner may change): one session per KST day, at most 288 experiments
  (about one per 5 minutes), PAPER/Research evidence only.

## Stage 2b requirements found while designing the input builder
The research coordinator validates every experiment input strictly (`researchRuntimeCoordinator.ts`,
`researchHardening.ts`), so the production input builder is not a thin mapper:

- Market points must be finite, positive, unique per market/time and newer than `staleWindowMs`; an empty
  window is rejected. (`ResearchMarketWindow` already refuses partial windows.)
- Evidence that can qualify a candidate needs full provenance: dataset id and content SHA-256, feature
  pipeline version/hash, strategy artifact and config hashes, source commit, split hash, walk-forward config
  hash, train/validation/final-holdout window hashes, attempt number and experiment lineage. A HOLDOUT window
  must be untouched. This must be derived from the optimizer's actual Train/Validation/Holdout split, not
  filled with placeholders.
- A champion evaluator and challenger evaluators (real strategy evaluations over the window, with fee and
  slippage models) must be registered with the coordinator. None exists in production composition today; the
  challenger variants should come from the deterministic optimizer parameter grid (now in
  `packages/core/src/optimizer`).
- Historical candles must be collected and stored first (public Upbit 1-minute candles, rate limited).

Because a wrong provenance would manufacture false evidence, Stage 2b starts with a design review of the
provenance derivation before any code is wired.

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
