import assert from "node:assert/strict";
import test from "node:test";
import {
  decideStrategyCalibrationContainment,
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
