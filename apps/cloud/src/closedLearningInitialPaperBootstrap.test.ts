import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClosedLearningInitialPaperBootstrap } from "./closedLearningInitialPaperBootstrap";
import type { ClosedLearningResearchReplayResult } from "./closedLearningResearchWorkerClient";

const ORIGINAL = "a".repeat(64);
const REPLAY = "b".repeat(64);
const VERSION = "c".repeat(64);
const DATASET = "d".repeat(64);

function snapshot(generatedAt = "2026-09-05T00:00:00.000Z", fingerprint = ORIGINAL) {
  return { originalRunFingerprintSha256: fingerprint, options: { generatedAt } } as never;
}

function result(deployable = true): ClosedLearningResearchReplayResult {
  const reference = `closed-learning-replay:${REPLAY}:candidate-a`;
  return {
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: ORIGINAL,
    replayRunFingerprintSha256: REPLAY,
    qualification: {
      schemaVersion: 1,
      candidates: [{ candidateId: "candidate-a", outcome: "QUALIFIED_FOR_LEAGUE", reasons: [], summary: "qualified" }],
      coverage: { candidateCount: 1, qualifiedCount: 1, insufficientCount: 0, rejectedCount: 0 },
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
    deployment: deployable ? {
      schemaVersion: 1,
      status: "DEPLOYABLE",
      reasons: ["SINGLE_CANONICAL_LEAGUE_ALLOCATION"],
      artifact: {
        schemaVersion: 1,
        candidateId: "candidate-a",
        candidateVersion: VERSION,
        market: "KRW-BTC",
        advisory: { schemaVersion: 1, generatedAt: "2026-09-04T23:59:00.000Z", entries: [{ id: "candidate-a", researchWeight: 1 }] } as never,
        candidateProvenance: [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: DATASET }],
        researchDecisionReference: reference,
        researchLineage: {
          schemaVersion: 1,
          candidateId: "candidate-a",
          candidateVersion: VERSION,
          originalRunFingerprintSha256: ORIGINAL,
          replayRunFingerprintSha256: REPLAY,
          researchDecisionReference: reference,
          authority: "PAPER_RESEARCH_ONLY",
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        },
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      },
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    } : {
      schemaVersion: 1,
      status: "NOT_DEPLOYABLE",
      reasons: ["ALLOCATION_NOT_SINGLE_CANDIDATE"],
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

function options(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const replay = result(true);
  const base = {
    snapshots: { list: () => [snapshot()], read: () => undefined },
    worker: { replayInitialResearch: () => { events.push("worker"); return replay; } },
    history: { persist: () => { events.push("history"); return {} as never; } },
    artifacts: { save: (artifact: never) => { events.push("artifact"); return artifact; } },
    deployment: { deploy: (input: { decision: { candidateId: string; candidateVersion: string } }) => { events.push("deploy"); return { deploymentId: "initial-period", candidateId: input.decision.candidateId, candidateVersion: input.decision.candidateVersion, authority: "PAPER_RESEARCH_ONLY" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const }; } },
    listOpenPeriods: () => [],
    listRealizedPeriods: () => [],
    now: () => 1_725_494_400_000,
    ...overrides,
  };
  return { base: base as never, events };
}

describe("initial PAPER bootstrap", () => {
  it("persists the complete denominator before artifact visibility and PAPER deployment", () => {
    const { base, events } = options();
    const output = new ClosedLearningInitialPaperBootstrap(base).runOnce();
    assert.equal(output.status, "DEPLOYED");
    assert.deepEqual(events, ["worker", "history", "artifact", "deploy"]);
    assert.equal(output.deployment?.candidateId, "candidate-a");
  });

  it("waits for Research and never bootstraps over existing PAPER state", () => {
    const waiting = options({ snapshots: { list: () => [], read: () => undefined } });
    assert.equal(new ClosedLearningInitialPaperBootstrap(waiting.base).runOnce().status, "WAITING_RESEARCH_SNAPSHOT");
    assert.deepEqual(waiting.events, []);

    const existing = options({ listOpenPeriods: () => [{}], listRealizedPeriods: () => [] });
    assert.equal(new ClosedLearningInitialPaperBootstrap(existing.base).runOnce().status, "EXISTING_PAPER_STATE");
    assert.deepEqual(existing.events, []);
  });

  it("persists non-deployable Research denominator but creates no artifact or period", () => {
    const { base, events } = options({ worker: { replayInitialResearch: () => { events.push("worker"); return result(false); } } });
    const output = new ClosedLearningInitialPaperBootstrap(base).runOnce();
    assert.equal(output.status, "RESEARCH_NOT_DEPLOYABLE");
    assert.deepEqual(events, ["worker", "history"]);
  });

  it("fails closed when the newest Research snapshot is timestamp-ambiguous", () => {
    const same = "2026-09-05T00:00:00.000Z";
    const { base } = options({ snapshots: { list: () => [snapshot(same, ORIGINAL), snapshot(same, "e".repeat(64))], read: () => undefined } });
    assert.throws(() => new ClosedLearningInitialPaperBootstrap(base).runOnce(), /ambiguous/);
  });

  it("does not materialize an artifact when denominator persistence fails", () => {
    const { base, events } = options({ history: { persist: () => { events.push("history"); throw new Error("history unavailable"); } } });
    assert.throws(() => new ClosedLearningInitialPaperBootstrap(base).runOnce(), /history unavailable/);
    assert.deepEqual(events, ["worker", "history"]);
  });
});
