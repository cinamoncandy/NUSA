import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateResearchCandidateSpecification, type ResearchCandidateSpecification } from "../../desktop/src/cloud/researchCandidateSpecification";
import type { ResearchRunReplaySnapshotReader } from "../../desktop/src/cloud/researchRunReplaySnapshotStore";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PaperChallengerActivationReceipt } from "./paperChallengerBindingLedger";
import { ClosedLearningEvidenceIdentitySource } from "./closedLearningEvidenceIdentitySource";

const SOURCE = "b".repeat(40);
const DATASET_HASH = "c".repeat(64);
const ORIGINAL = "d".repeat(64);
const REPLAY = "e".repeat(64);
const RISK = "f".repeat(64);

function specification(candidateId = "candidate-a"): ResearchCandidateSpecification {
  return Object.freeze({
    schemaVersion: 1,
    candidateId,
    familyId: "family-a",
    lineageId: "lineage-a",
    parameters: Object.freeze({ lookback: 20 }),
    codeSha: SOURCE,
    datasetId: "dataset-a",
    datasetContentSha256: DATASET_HASH,
    costModelVersion: "paper-cost-v3",
    generatedAt: "2026-09-01T00:00:00.000Z",
    evaluationStartedAt: "2026-09-01T00:01:00.000Z",
    evaluationEndedAt: "2026-09-01T00:02:00.000Z",
  });
}

function activation(candidateId = "candidate-a", original = ORIGINAL): PaperChallengerActivationReceipt {
  const spec = specification(candidateId);
  const version = validateResearchCandidateSpecification(spec, Date.parse(spec.evaluationEndedAt)).specificationHash;
  return Object.freeze({
    schemaVersion: 1,
    status: "ACTIVE",
    market: "KRW-BTC",
    binding: Object.freeze({
      schemaVersion: 1,
      status: "BOUND_UNVERIFIED",
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      candidateId,
      datasetId: "dataset-a",
      datasetContentSha256: DATASET_HASH,
      advisoryGeneratedAt: 1,
      periodStartAt: 1,
      advisoryFingerprintSha256: "1".repeat(64),
      bindingFingerprintSha256: "2".repeat(64),
    }),
    activatedAt: 1,
    researchLineage: Object.freeze({
      schemaVersion: 1,
      candidateId,
      candidateVersion: version,
      originalRunFingerprintSha256: original,
      replayRunFingerprintSha256: REPLAY,
      researchDecisionReference: `research:${candidateId}`,
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function period(recordId: string, periodIndex: number, periodStartAt: number): PersistedPaperPeriodEnvelope {
  return Object.freeze({
    record: Object.freeze({
      recordId,
      periodIndex,
      market: "KRW-BTC",
      advisory: Object.freeze({ schemaVersion: 1 as const, generatedAt: "2026-09-01T00:00:00.000Z", policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }), entries: Object.freeze([]), excludedCandidateIds: Object.freeze([]), reasons: Object.freeze([]), provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }) }),
      periodStartAt,
      periodEndAt: periodStartAt + 10_000,
      realizedReturns: Object.freeze({ "candidate-a": 0.01 }),
      benchmarkReturn: 0.005,
      turnoverCostRate: 0.001,
      costEvidence: Object.freeze({ evidenceId: `cost-${recordId}`, source: "PAPER_EXECUTION_RECEIPT" as const, evidenceKind: "OBSERVED" as const, evidenceFingerprintSha256: "3".repeat(64), observedAt: periodStartAt + 10_000, feeRate: 0.0005, spreadRate: 0.0002, slippageRate: 0.0003 }),
      canonicalOutcomeReceiptFingerprint: "4".repeat(64),
      status: "COMPLETED" as const,
    }),
    candidateProvenance: Object.freeze([{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: DATASET_HASH }]),
  });
}

function snapshotReader(candidateId = "candidate-a"): ResearchRunReplaySnapshotReader {
  const spec = specification(candidateId);
  const snapshot = Object.freeze({
    schemaVersion: 1,
    sourceCommitSha: SOURCE,
    originalRunFingerprintSha256: ORIGINAL,
    candidates: Object.freeze([{ id: candidateId, candidateSpecification: spec }]),
    options: Object.freeze({}),
    snapshotSha256: "5".repeat(64),
  });
  return Object.freeze({
    read: (fingerprint: string) => fingerprint === ORIGINAL ? snapshot as never : undefined,
    list: () => Object.freeze([snapshot as never]),
  });
}

describe("ClosedLearningEvidenceIdentitySource", () => {
  it("builds a deterministic accumulated identity from same-lineage realized PAPER periods and immutable Research provenance", () => {
    const first = period("record-1", 1, 10_000);
    const second = period("record-2", 2, 20_000);
    const active = activation();
    const source = new ClosedLearningEvidenceIdentitySource({
      bindings: { current: () => active },
      replaySnapshots: snapshotReader(),
      readRiskConfigHash: () => RISK,
    });
    const left = source.build({ closedPeriod: second, realizedPeriods: [second, first] });
    const right = source.build({ closedPeriod: second, realizedPeriods: [first, second] });
    assert.deepEqual(left, right);
    assert.equal(left.championId, "candidate-a");
    assert.equal(left.championVersion, active.researchLineage!.candidateVersion);
    assert.equal(left.sourceCommitSha, SOURCE);
    assert.equal(left.costModelVersion, "paper-cost-v3");
    assert.equal(left.riskConfigHash, RISK);
    assert.deepEqual(left.evidenceReferences, ["paper-period:record-1", "paper-period:record-2"]);
    assert.match(left.evidenceFingerprintSha256, /^[a-f0-9]{64}$/);
    assert.equal(left.evidenceId, `closed-learning-paper:${left.evidenceFingerprintSha256}`);
  });

  it("excludes realized periods from a different Research lineage", () => {
    const first = period("record-1", 1, 10_000);
    const foreign = period("record-foreign", 0, 5_000);
    const second = period("record-2", 2, 20_000);
    const active = activation();
    const other = activation("candidate-a", "9".repeat(64));
    const source = new ClosedLearningEvidenceIdentitySource({
      bindings: { current: (_market, at) => at === foreign.record.periodStartAt ? other : active },
      replaySnapshots: snapshotReader(),
      readRiskConfigHash: () => RISK,
    });
    const result = source.build({ closedPeriod: second, realizedPeriods: [foreign, second, first] });
    assert.deepEqual(result.evidenceReferences, ["paper-period:record-1", "paper-period:record-2"]);
  });

  it("fails closed when Research candidate version conflicts with the active PAPER lineage", () => {
    const closed = period("record-2", 2, 20_000);
    const active = activation();
    const tampered = Object.freeze({ ...active, researchLineage: Object.freeze({ ...active.researchLineage!, candidateVersion: "8".repeat(64) }) });
    const source = new ClosedLearningEvidenceIdentitySource({ bindings: { current: () => tampered }, replaySnapshots: snapshotReader(), readRiskConfigHash: () => RISK });
    assert.throws(() => source.build({ closedPeriod: closed, realizedPeriods: [closed] }), /candidate version conflicts/);
  });

  it("fails closed when the production risk fingerprint is unavailable or malformed", () => {
    const closed = period("record-2", 2, 20_000);
    const source = new ClosedLearningEvidenceIdentitySource({ bindings: { current: () => activation() }, replaySnapshots: snapshotReader(), readRiskConfigHash: () => "unknown" });
    assert.throws(() => source.build({ closedPeriod: closed, realizedPeriods: [closed] }), /risk fingerprint is invalid/);
  });
});
