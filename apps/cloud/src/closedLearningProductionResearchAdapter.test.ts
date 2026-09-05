import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import { ClosedLearningProductionResearchAdapter } from "./closedLearningProductionResearchAdapter";
import type { ClosedLearningResearchReplayResult } from "./closedLearningResearchWorkerClient";
import type { QualifiedPaperChallengerArtifact } from "./paperChallengerDeploymentRuntime";

const ORIGINAL = "a".repeat(64);
const REPLAY = "b".repeat(64);
const VERSION = "c".repeat(64);
const DATASET_HASH = "d".repeat(64);

const identity: ClosedLearningEvidenceIdentity & { readonly cycleId: string } = Object.freeze({
  cycleId: `closed-learning:${"e".repeat(64)}`,
  evidenceId: "paper-forward:evidence",
  evidenceFingerprintSha256: "f".repeat(64),
  championId: "champion",
  championVersion: "v1",
  sourceCommitSha: "1".repeat(40),
  costModelVersion: "cost-v1",
  riskConfigHash: "2".repeat(64),
  evidenceReferences: Object.freeze(["paper-period:p1"]),
});

const advisory: QualifiedPaperChallengerArtifact["advisory"] = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date(1_000).toISOString(),
  policy: Object.freeze({
    maximumCandidateWeight: 1,
    minimumEvidenceBreadth: 1,
    maximumCandidateCount: 1,
    maximumFamilyWeight: 1,
  }),
  entries: Object.freeze([Object.freeze({
    id: "candidate-q",
    familyId: "sma",
    rank: 1,
    leagueScore: 1,
    evidenceBreadth: 1,
    researchWeight: 1,
    reasons: Object.freeze(["qualified"]),
    sourceDatasetIds: Object.freeze(["dataset-q"]),
  })]),
  excludedCandidateIds: Object.freeze([]),
  reasons: Object.freeze(["research-only allocation"]),
  provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-q"]) }),
});

function artifact(): QualifiedPaperChallengerArtifact {
  const researchDecisionReference = `closed-learning-replay:${REPLAY}:candidate-q`;
  return {
    schemaVersion: 1,
    candidateId: "candidate-q",
    candidateVersion: VERSION,
    market: "KRW-BTC",
    advisory,
    candidateProvenance: Object.freeze([{ candidateId: "candidate-q", datasetId: "dataset-q", datasetContentSha256: DATASET_HASH }]),
    candidateStrategy: Object.freeze({ candidateId: "candidate-q", familyId: "sma-crossover", lineageId: "sma-v1", specificationHash: VERSION, codeSha: "1".repeat(40), costModelVersion: "cost-v1", parameters: Object.freeze({ shortPeriod: 2, longPeriod: 3 }) }),
    researchDecisionReference,
    researchLineage: Object.freeze({
      schemaVersion: 1,
      candidateId: "candidate-q",
      candidateVersion: VERSION,
      originalRunFingerprintSha256: ORIGINAL,
      replayRunFingerprintSha256: REPLAY,
      researchDecisionReference,
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

function replayResult(deployment: ClosedLearningResearchReplayResult["deployment"]): ClosedLearningResearchReplayResult {
  const candidates = deployment.status === "DEPLOYABLE"
    ? Object.freeze([{ candidateId: "candidate-q", outcome: "QUALIFIED_FOR_LEAGUE" as const, reasons: Object.freeze(["PASS"]), summary: "qualified" }])
    : Object.freeze([
        { candidateId: "candidate-a", outcome: "QUALIFIED_FOR_LEAGUE" as const, reasons: Object.freeze(["PASS"]), summary: "qualified" },
        { candidateId: "candidate-b", outcome: "QUALIFIED_FOR_LEAGUE" as const, reasons: Object.freeze(["PASS"]), summary: "qualified" },
      ]);
  return Object.freeze({
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: ORIGINAL,
    replayRunFingerprintSha256: REPLAY,
    qualification: Object.freeze({
      schemaVersion: 1,
      candidates,
      coverage: Object.freeze({ candidateCount: candidates.length, qualifiedCount: candidates.length, insufficientCount: 0, rejectedCount: 0 }),
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
    deployment,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

const deployable = (): ClosedLearningResearchReplayResult["deployment"] => Object.freeze({
  schemaVersion: 1,
  status: "DEPLOYABLE",
  reasons: Object.freeze(["SINGLE_CANONICAL_LEAGUE_ALLOCATION"]),
  artifact: artifact() as QualifiedPaperChallengerArtifact & { readonly researchLineage: NonNullable<QualifiedPaperChallengerArtifact["researchLineage"]> },
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

const ambiguous = (): ClosedLearningResearchReplayResult["deployment"] => Object.freeze({
  schemaVersion: 1,
  status: "NOT_DEPLOYABLE",
  reasons: Object.freeze(["ALLOCATION_NOT_SINGLE_CANDIDATE"]),
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

describe("ClosedLearningProductionResearchAdapter", () => {
  it("persists the complete denominator before making a qualified artifact visible", () => {
    const order: string[] = [];
    const result = replayResult(deployable());
    const adapter = new ClosedLearningProductionResearchAdapter({
      replayInput: { resolve: () => ({ originalRunFingerprintSha256: ORIGINAL, paperEvidenceByCandidate: { "candidate-q": { paperPerformance: {} } } }) },
      worker: { replay: () => { order.push("worker"); return result; } },
      history: { persist: (value) => { order.push("history"); assert.equal(value, result); return { appended: 1, state: {} as never }; } },
      artifacts: { save: (value) => { order.push("artifact"); return value; } },
      now: () => 5_000,
    });

    const decision = adapter.evaluate(identity);
    assert.deepEqual(order, ["worker", "history", "artifact"]);
    assert.equal(decision.outcome, "QUALIFIED_FOR_LEAGUE");
    assert.equal(decision.candidateId, "candidate-q");
    assert.equal(decision.candidateVersion, VERSION);
    assert.equal(decision.decisionReference, artifact().researchDecisionReference);
  });

  it("keeps multiple qualified League candidates in the denominator but refuses arbitrary PAPER selection", () => {
    let artifacts = 0;
    const adapter = new ClosedLearningProductionResearchAdapter({
      replayInput: { resolve: () => ({ originalRunFingerprintSha256: ORIGINAL, paperEvidenceByCandidate: { "candidate-a": {}, "candidate-b": {} } }) },
      worker: { replay: () => replayResult(ambiguous()) },
      history: { persist: () => ({ appended: 2, state: {} as never }) },
      artifacts: { save: (value) => { artifacts += 1; return value; } },
      now: () => 5_000,
    });
    const decision = adapter.evaluate(identity);
    assert.equal(decision.outcome, "INSUFFICIENT");
    assert.equal(decision.candidateId, undefined);
    assert.equal(artifacts, 0);
    assert.ok(decision.reasons.includes("NO_UNAMBIGUOUS_PAPER_DEPLOYMENT"));
  });

  it("never exposes an artifact when denominator persistence fails", () => {
    let artifactWrites = 0;
    const adapter = new ClosedLearningProductionResearchAdapter({
      replayInput: { resolve: () => ({ originalRunFingerprintSha256: ORIGINAL, paperEvidenceByCandidate: { "candidate-q": {} } }) },
      worker: { replay: () => replayResult(deployable()) },
      history: { persist: () => { throw new Error("history unavailable"); } },
      artifacts: { save: (value) => { artifactWrites += 1; return value; } },
      now: () => 5_000,
    });
    assert.throws(() => adapter.evaluate(identity), /history unavailable/);
    assert.equal(artifactWrites, 0);
  });

  it("fails closed on invalid replay provenance or clock before producing a coordinator decision", () => {
    const invalid = Object.freeze({ ...replayResult(ambiguous()), originalRunFingerprintSha256: "9".repeat(64) });
    const adapter = new ClosedLearningProductionResearchAdapter({
      replayInput: { resolve: () => ({ originalRunFingerprintSha256: ORIGINAL, paperEvidenceByCandidate: { q: {} } }) },
      worker: { replay: () => invalid },
      history: { persist: () => ({ appended: 0, state: {} as never }) },
      artifacts: { save: (value) => value },
      now: () => 5_000,
    });
    assert.throws(() => adapter.evaluate(identity), /provenance conflict/);

    const badClock = new ClosedLearningProductionResearchAdapter({
      replayInput: { resolve: () => ({ originalRunFingerprintSha256: ORIGINAL, paperEvidenceByCandidate: { q: {} } }) },
      worker: { replay: () => replayResult(ambiguous()) },
      history: { persist: () => ({ appended: 0, state: {} as never }) },
      artifacts: { save: (value) => value },
      now: () => -1,
    });
    assert.throws(() => badClock.evaluate(identity), /clock/);
  });
});
