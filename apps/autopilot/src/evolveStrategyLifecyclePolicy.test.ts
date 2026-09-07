import assert from "node:assert/strict";
import test from "node:test";
import {
  decideStrategyEdgeDecayContainment,
  decideStrategyCalibrationContainment,
  validateStrategyLifecycleState,
  type StrategyCalibrationContainmentInput,
  type StrategyLifecycleState,
} from "./evolveStrategyLifecyclePolicy";
import type { PaperCalibrationObservation } from "./evolvePaperCalibrationEvidence";

const DATASET_HASH = "a".repeat(64);

function observations(prefix: string, count: number, startAt: number, probability: number): PaperCalibrationObservation[] {
  return Array.from({ length: count }, (_, index) => {
    const periodStartAt = startAt + index * 10;
    return {
      observationId: `${prefix}-${index}`,
      candidateId: "strategy-a",
      datasetId: "paper-dataset-a",
      datasetContentSha256: DATASET_HASH,
      regime: "regime-a",
      predictedAt: periodStartAt - 1,
      periodStartAt,
      periodEndAt: periodStartAt + 5,
      predictedPositiveNetReturnProbability: probability,
      realizedNetReturn: 0.01,
      status: "COMPLETED",
    };
  });
}

function calibration(
  baselineProbability: number,
  candidateProbability: number,
  count = 30,
): NonNullable<StrategyCalibrationContainmentInput["calibration"]> {
  const admission = {
    candidateId: "strategy-a",
    datasetId: "paper-dataset-a",
    datasetContentSha256: DATASET_HASH,
    strength: "VERIFIED" as const,
    periodCount: count,
    completedPeriodCount: count,
  };
  return {
    baseline: { admission, observations: observations("baseline", count, 1_000, baselineProbability) },
    candidate: { admission, observations: observations("candidate", count, 10_000, candidateProbability) },
    currentConfidence: 0.5,
    requestedConfidence: 0.5,
  };
}

const decide = (
  currentState: StrategyLifecycleState,
  evidence?: NonNullable<StrategyCalibrationContainmentInput["calibration"]>,
) => decideStrategyCalibrationContainment({ currentState, ...(evidence == null ? {} : { calibration: evidence }) });

const edgePolicy = Object.freeze({
  policyVersion: "edge-decay-v1",
  minimumRecentSamples: 100,
  yellowScore: 0.15,
  orangeScore: 0.35,
  redScore: 0.6,
  metricWeights: Object.freeze({
    sharpe: 2,
    winRate: 1,
    calibration: 1,
    profitFactor: 1,
    drawdown: 2,
    slippage: 1,
    capacity: 1,
  }),
});

const edgeInput = (overrides: Record<string, unknown> = {}) => ({
  edgeId: "strategy-a",
  edgeVersion: "1.0.0",
  generatedAt: "2026-04-01T00:00:00.000Z",
  baseline: {
    windowId: "baseline",
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-12-31T00:00:00.000Z",
    sampleSize: 1_000,
    sharpe: 2,
    winRate: 0.7,
    expectedCalibrationError: 0.04,
    profitFactor: 1.8,
    maximumDrawdown: 0.08,
    averageSlippageBps: 4,
    capacityUsd: 1_000_000,
  },
  recent: {
    windowId: "recent",
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2026-03-31T00:00:00.000Z",
    sampleSize: 150,
    sharpe: 1.9,
    winRate: 0.68,
    expectedCalibrationError: 0.05,
    profitFactor: 1.7,
    maximumDrawdown: 0.09,
    averageSlippageBps: 4.5,
    capacityUsd: 900_000,
  },
  ...overrides,
});

test("fails closed when canonical calibration evidence is missing or insufficient", () => {
  const missing = decide("PROMOTED");
  assert.equal(missing.nextState, "DEMOTED");
  assert.equal(missing.reason, "canonical-calibration-evidence-missing");

  const insufficient = decide("PROMOTED", calibration(0.5, 0.9, 1));
  assert.equal(insufficient.nextState, "DEMOTED");
  assert.equal(insufficient.reason, "canonical-calibration-insufficient");
  assert.equal(decide("CANDIDATE").nextState, "WATCH");
});

test("demotes promoted strategies on canonical PAPER calibration regression", () => {
  const result = decide("PROMOTED", calibration(0.9, 0.5));
  assert.equal(result.nextState, "DEMOTED");
  assert.equal(result.reason, "canonical-calibration-regression");
});

test("verified calibration improvement never promotes candidate or watch states", () => {
  const candidate = decide("CANDIDATE", calibration(0.5, 0.9));
  assert.equal(candidate.nextState, "CANDIDATE");
  assert.equal(candidate.reason, "canonical-calibration-improved-no-promotion");

  const watch = decide("WATCH", calibration(0.5, 0.9));
  assert.equal(watch.nextState, "WATCH");
});

test("uses the canonical comparator instead of accepting caller-asserted status", () => {
  const invalid = calibration(0.5, 0.9);
  const first = invalid.candidate.observations[0]!;
  const malformed = {
    ...invalid,
    candidate: {
      ...invalid.candidate,
      observations: [
        { ...first, predictedAt: first.periodStartAt },
        ...invalid.candidate.observations.slice(1),
      ],
    },
  };
  assert.throws(
    () => decide("PROMOTED", malformed),
    /EVOLVE_PAPER_CALIBRATION_LOOKAHEAD/,
  );
});

test("retirement is absorbing and does not re-evaluate evidence", () => {
  const first = decide("RETIRED", calibration(0.9, 0.5));
  const second = decide("RETIRED", calibration(0.5, 0.9));
  assert.equal(first.nextState, "RETIRED");
  assert.equal(second.nextState, "RETIRED");
  assert.equal(first.reason, "retired-is-absorbing");
});

test("never grants live, production mutation or AI authority", () => {
  const result = decide("PROMOTED", calibration(0.9, 0.5));
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
  assert.equal(Object.isFrozen(result), true);
});

test("rejects unknown lifecycle states at the runtime boundary", () => {
  assert.throws(
    () => validateStrategyLifecycleState("PROMOTED_BY_AI"),
    /STRATEGY_LIFECYCLE_STATE_INVALID/,
  );
  assert.throws(
    () => decideStrategyCalibrationContainment({ currentState: "PROMOTED_BY_AI" as StrategyLifecycleState }),
    /STRATEGY_LIFECYCLE_STATE_INVALID/,
  );
});

test("contains a critically decayed promoted strategy without granting authority", () => {
  const result = decideStrategyEdgeDecayContainment({
    currentState: "PROMOTED",
    edgeDecay: {
      input: edgeInput({
        recent: {
          ...edgeInput().recent,
          sharpe: 0.1,
          winRate: 0.2,
          expectedCalibrationError: 0.25,
          profitFactor: 0.4,
          maximumDrawdown: 0.35,
          averageSlippageBps: 18,
          capacityUsd: 100_000,
        },
      }),
      policy: edgePolicy,
    },
  });
  assert.equal(result.nextState, "QUARANTINED");
  assert.equal(result.reason, "canonical-edge-decay-suspend");
  assert.equal(result.edgeDecay?.action, "SUSPEND");
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});

test("demotes promoted strategies on canonical edge-decay reduction", () => {
  const result = decideStrategyEdgeDecayContainment({
    currentState: "PROMOTED",
    edgeDecay: {
      input: edgeInput({
        recent: {
          ...edgeInput().recent,
          sharpe: 1.1,
          winRate: 0.55,
          expectedCalibrationError: 0.09,
          profitFactor: 1.2,
          maximumDrawdown: 0.14,
          averageSlippageBps: 7,
          capacityUsd: 600_000,
        },
      }),
      policy: edgePolicy,
    },
  });
  assert.equal(result.nextState, "DEMOTED");
  assert.equal(result.reason, "canonical-edge-decay-reduce");
});

test("fails closed when edge-decay evidence is missing or malformed", () => {
  const missing = decideStrategyEdgeDecayContainment({ currentState: "PROMOTED" });
  assert.equal(missing.nextState, "DEMOTED");
  assert.equal(missing.reason, "canonical-edge-decay-evidence-missing");

  assert.throws(() => decideStrategyEdgeDecayContainment({
    currentState: "PROMOTED",
    edgeDecay: {
      input: edgeInput({ recent: { ...edgeInput().recent, endAt: "2027-01-01T00:00:00.000Z" } }),
      policy: edgePolicy,
    },
  }), /cannot end in the future/);
});

test("does not re-evaluate or revive retired strategies", () => {
  const result = decideStrategyEdgeDecayContainment({
    currentState: "RETIRED",
    edgeDecay: {
      input: edgeInput({ recent: { ...edgeInput().recent, endAt: "not-a-date" } }),
      policy: edgePolicy,
    },
  });
  assert.equal(result.nextState, "RETIRED");
  assert.equal(result.reason, "retired-is-absorbing");
});
